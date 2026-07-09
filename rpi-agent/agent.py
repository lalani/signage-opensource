#!/usr/bin/env python3
"""
Signage RPi Agent — connects to the management server, plays content,
falls back to cache when offline, handles remote commands.
"""
import asyncio, base64, logging, os, subprocess, sys, threading, time
from pathlib import Path
import socketio
import psutil
import pty, select, struct, fcntl, termios
import cache, config, screen
from player import Player, DisplayServer


def setup_logging(log_path: Path):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(name)-8s] %(levelname)s %(message)s',
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(log_path)],
    )

log = logging.getLogger('agent')


class TerminalSession:
    def __init__(self, sio, session_id, main_loop):
        self.sio = sio
        self.session_id = session_id
        self.main_loop = main_loop
        self.fd = None
        self.pid = None
        self.thread = None
        self.running = False

    def start(self):
        self.running = True
        try:
            self.pid, self.fd = pty.fork()
        except Exception as e:
            log.error(f"Failed to pty.fork() terminal: {e}")
            self.running = False
            return
        
        if self.pid == 0:
            # Child process: run bash
            try:
                os.environ['TERM'] = 'xterm-256color'
                os.environ['HOME'] = os.path.expanduser('~')
                shell = '/bin/bash' if os.path.exists('/bin/bash') else '/bin/sh'
                os.execv(shell, [shell])
            except Exception:
                pass
            os._exit(1)
        else:
            # Parent process: read loop
            self.thread = threading.Thread(target=self._read_loop, daemon=True)
            self.thread.start()

    def _read_loop(self):
        while self.running:
            try:
                r, _, _ = select.select([self.fd], [], [], 0.1)
                if self.fd in r:
                    data = os.read(self.fd, 4096)
                    if not data:
                        break
                    
                    asyncio.run_coroutine_threadsafe(
                        self.sio.emit('device:terminal_output', {
                            'sessionId': self.session_id,
                            'data': data.decode('utf-8', errors='ignore')
                        }),
                        self.main_loop
                    )
            except Exception as e:
                log.error(f"Terminal read exception on session {self.session_id}: {e}")
                break
        self.stop()

    def write(self, data):
        if self.fd and self.running:
            try:
                os.write(self.fd, data.encode('utf-8'))
            except Exception:
                pass

    def resize(self, cols, rows):
        if self.fd and self.running:
            try:
                size = struct.pack('HHHH', rows, cols, 0, 0)
                fcntl.ioctl(self.fd, termios.TIOCSWINSZ, size)
            except Exception:
                pass

    def stop(self):
        if not self.running:
            return
        self.running = False
        if self.fd:
            try:
                os.close(self.fd)
            except Exception:
                pass
            self.fd = None
        if self.pid:
            try:
                os.kill(self.pid, 9)
                os.waitpid(self.pid, 0)
            except Exception:
                pass
            self.pid = None


class SignageAgent:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.sio = socketio.AsyncClient(
            reconnection=True, reconnection_delay=5,
            reconnection_delay_max=60, logger=False, engineio_logger=False,
        )
        self.display = DisplayServer(cfg['cache_dir'])
        self.player  = Player(self.display)
        self.current_playlist: dict | None = None
        self.terminal_sessions = {}
        self.loop = None
        self._stop_playback = threading.Event()
        self._play_thread: threading.Thread | None = None
        self._register_handlers()

    def _register_handlers(self):
        sio = self.sio

        @sio.on('connect')
        async def on_connect():
            log.info('Connected to server')
            await sio.emit('device:hello', {
                'registrationKey': self.cfg['registration_key'],
                'version': self.cfg['agent_version'],
            })

        @sio.on('cmd:get_info')
        async def on_get_info(*args):
            w, h = screen.get_resolution()
            ip = _local_ip()
            log.info(f'Screen {w}x{h}  ip {ip}')
            await sio.emit('device:info', {'screenWidth': w, 'screenHeight': h, 'ipAddress': ip})

        @sio.on('cmd:settings')
        async def on_settings(data: dict, *args):
            log.info(f'Received settings update: {data}')
            orientation = data.get('orientation', 'LANDSCAPE')
            self.player.set_orientation(orientation)
            widgets = data.get('widgets', [])
            self.player.set_widgets(widgets)
            splash_url = data.get('splashUrl')
            loop = asyncio.get_event_loop()
            updated = await loop.run_in_executor(
                None, lambda: cache.sync_splash(splash_url)
            )
            if updated:
                log.info('Splash screen changed, updating system splash theme...')
                try:
                    subprocess.Popen(['sudo', '/opt/signage-agent/update-splash.sh'])
                except Exception as e:
                    log.error(f'Failed to run update-splash.sh: {e}')
                
                if not self.current_playlist:
                    self.player.show_splash()

        @sio.on('cmd:play')
        async def on_play(data: dict, *args):
            log.info(f'Playlist "{data["name"]}" ({len(data["items"])} items)')
            loop = asyncio.get_event_loop()
            playlist = await loop.run_in_executor(
                None, lambda: cache.sync_playlist(data, self.cfg['cache_dir'])
            )
            self._start_playlist(playlist)

        @sio.on('cmd:restart')
        async def on_restart(*args):
            log.info('Restarting agent')
            try:
                server_url = self.cfg.get('server_url')
                if server_url:
                    log.info(f'Checking for agent updates from {server_url}/api/install/ ...')
                    import urllib.request
                    
                    files = ['agent.py', 'player.py', 'config.py', 'cache.py', 'screen.py']
                    temp_dir = Path('/tmp/signage-update')
                    temp_dir.mkdir(parents=True, exist_ok=True)
                    
                    downloaded = []
                    for f in files:
                        url = f"{server_url.rstrip('/')}/api/install/{f}"
                        dest = temp_dir / f
                        req = urllib.request.Request(url, headers={'User-Agent': 'SignageAgent-Updater'})
                        with urllib.request.urlopen(req, timeout=10) as response:
                            dest.write_bytes(response.read())
                        downloaded.append(f)
                    
                    local_dir = Path(__file__).parent.absolute()
                    for f in downloaded:
                        src = temp_dir / f
                        dst = local_dir / f
                        import shutil
                        shutil.copy2(src, dst)
                    log.info('Agent self-update completed successfully!')
            except Exception as e:
                log.error(f'Agent self-update failed: {e}')

            self.player.stop()
            await self.display.stop()
            os.execv(sys.executable, [sys.executable] + sys.argv)

        @sio.on('cmd:reboot')
        async def on_reboot(*args):
            log.info('System reboot')
            self.player.stop()
            subprocess.run(['sudo', 'reboot'])

        @sio.on('cmd:shutdown')
        async def on_shutdown(*args):
            log.info('System shutdown')
            self.player.stop()
            subprocess.run(['sudo', 'shutdown', 'now'])

        @sio.on('cmd:get_logs')
        async def on_get_logs(*args):
            try:
                lines = self.cfg['log_path'].read_text().splitlines()[-200:]
            except Exception as e:
                lines = [str(e)]
            await sio.emit('device:logs', {'lines': lines})

        @sio.on('cmd:screenshot')
        async def on_screenshot(*args):
            try:
                Path('/tmp/ss.png').unlink(missing_ok=True)
                xauth = os.environ.get('XAUTHORITY', str(Path.home() / '.Xauthority'))
                loop = asyncio.get_event_loop()
                ret = await loop.run_in_executor(
                    None,
                    lambda: os.system(f"DISPLAY=:0 XAUTHORITY='{xauth}' scrot -z /tmp/ss.png")
                )
                if ret == 0 and Path('/tmp/ss.png').exists():
                    data = base64.b64encode(Path('/tmp/ss.png').read_bytes()).decode()
                    await sio.emit('device:screenshot', {'data': data, 'mime': 'image/png'})
                else:
                    log.error(f'Screenshot failed: scrot returned {ret}')
            except Exception as e:
                log.error(f'Screenshot: {e}')

        @sio.on('cmd:clear')
        async def on_clear(*args):
            log.info('Clearing display (black screen)')
            self._stop_playlist()
            self.display.set('', 'image', False)

        @sio.on('cmd:terminal_start')
        async def on_terminal_start(data: dict, *args):
            session_id = data.get('sessionId')
            if not session_id: return
            log.info(f'Starting remote terminal session: {session_id}')
            if session_id in self.terminal_sessions:
                self.terminal_sessions[session_id].stop()
            
            session = TerminalSession(sio, session_id, self.loop)
            self.terminal_sessions[session_id] = session
            session.start()

        @sio.on('cmd:terminal_input')
        async def on_terminal_input(data: dict, *args):
            session_id = data.get('sessionId')
            val = data.get('data', '')
            session = self.terminal_sessions.get(session_id)
            if session:
                session.write(val)

        @sio.on('cmd:terminal_resize')
        async def on_terminal_resize(data: dict, *args):
            session_id = data.get('sessionId')
            cols = data.get('cols', 80)
            rows = data.get('rows', 24)
            session = self.terminal_sessions.get(session_id)
            if session:
                session.resize(cols, rows)

        @sio.on('cmd:terminal_stop')
        async def on_terminal_stop(data: dict, *args):
            session_id = data.get('sessionId')
            log.info(f'Stopping remote terminal session: {session_id}')
            session = self.terminal_sessions.pop(session_id, None)
            if session:
                session.stop()

        @sio.on('disconnect')
        async def on_disconnect():
            log.warning('Disconnected — cached playlist continues')
            for session in list(self.terminal_sessions.values()):
                session.stop()
            self.terminal_sessions.clear()

    def _stop_playlist(self):
        self._stop_playback.set()
        if self._play_thread and self._play_thread.is_alive():
            self._play_thread.join(timeout=6)
        self.current_playlist = None
        self.player.stop()

    def _start_playlist(self, playlist: dict):
        self._stop_playlist()
        self._stop_playback.clear()
        self.current_playlist = playlist
        self._play_thread = threading.Thread(
            target=self._playback_loop, args=(playlist,), daemon=True, name='playback'
        )
        self._play_thread.start()

    def _is_item_valid(self, item: dict) -> bool:
        content = item.get('content', {})
        valid_from_str = content.get('validFrom')
        valid_until_str = content.get('validUntil')
        
        if not valid_from_str and not valid_until_str:
            return True
            
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        
        def parse_iso(dt_str):
            if not dt_str:
                return None
            if dt_str.endswith('Z'):
                dt_str = dt_str[:-1] + '+00:00'
            try:
                return datetime.fromisoformat(dt_str)
            except Exception as e:
                log.error(f'Error parsing date {dt_str}: {e}')
                return None
                
        if valid_from_str:
            v_from = parse_iso(valid_from_str)
            if v_from and now < v_from:
                return False
                
        if valid_until_str:
            v_until = parse_iso(valid_until_str)
            if v_until and now > v_until:
                return False
                
        return True

    def _playback_loop(self, playlist: dict):
        items = playlist.get('items', [])
        if not items:
            log.warning('Empty playlist'); return
        log.info(f'Playing: {playlist["name"]}')
        while not self._stop_playback.is_set():
            played_any = False
            for item in items:
                if self._stop_playback.is_set(): break
                
                if not self._is_item_valid(item):
                    log.info(f'  -> Skipping {item["content"]["name"]} (outside validity period)')
                    continue
                
                played_any = True
                log.info(f'  -> {item["content"]["name"]}  ({item["durationSec"]}s)')
                self.player.play_item(item)
                deadline = time.monotonic() + item['durationSec']
                while time.monotonic() < deadline:
                    if self._stop_playback.is_set(): break
                    time.sleep(0.4)
                    
            if not played_any and not self._stop_playback.is_set():
                self.player.show_splash()
                time.sleep(5)

    async def _heartbeat_loop(self):
        while True:
            await asyncio.sleep(30)
            if self.sio.connected:
                try:
                    pl = (self.current_playlist or {}).get('name')
                    stats = _get_hardware_stats()
                    await self.sio.emit('device:heartbeat', {
                        'currentPlaylist': pl,
                        **stats
                    })
                except Exception:
                    pass

    async def run(self):
        self.loop = asyncio.get_running_loop()
        # Start the local display server first
        await self.display.start()

        # Show splash screen immediately on startup
        self.player.show_splash()

        # Boot with cached playlist if available (after a short delay to let the splash render)
        cached = cache.load_cached_playlist()
        if cached:
            log.info(f'Boot: cached playlist "{cached["name"]}"')
            await asyncio.sleep(5)
            self._start_playlist(cached)
        else:
            log.info('No cached playlist — keeping splash screen active')

        asyncio.create_task(self._heartbeat_loop())
        log.info(f'Connecting to {self.cfg["server_url"]}')
        while True:
            try:
                await self.sio.connect(self.cfg['server_url'], transports=['websocket'])
                await self.sio.wait()
            except Exception as e:
                log.warning(f'Connection failed: {e} — retry in 10s')
            await asyncio.sleep(10)


def _local_ip() -> str:
    try:
        return subprocess.check_output(['hostname', '-I'], timeout=3).decode().strip().split()[0]
    except Exception:
        return ''


def _get_hardware_stats() -> dict:
    try:
        # CPU temp
        temp = None
        temp_paths = [
            Path('/sys/class/thermal/thermal_zone0/temp'),
            Path('/sys/class/class/thermal/thermal_zone0/temp')
        ]
        for p in temp_paths:
            if p.exists():
                try:
                    temp = float(p.read_text().strip()) / 1000.0
                    break
                except Exception:
                    pass

        if temp is None and hasattr(psutil, 'sensors_temperatures'):
            try:
                temps = psutil.sensors_temperatures()
                if 'cpu_thermal' in temps:
                    temp = temps['cpu_thermal'][0].current
                elif 'coretemp' in temps:
                    temp = temps['coretemp'][0].current
            except Exception:
                pass

        uptime = int(time.time() - psutil.boot_time())

        return {
            'cpuUsage': psutil.cpu_percent(),
            'cpuTemp': temp,
            'memUsage': psutil.virtual_memory().percent,
            'diskUsage': psutil.disk_usage('/').percent,
            'uptime': uptime
        }
    except Exception as e:
        log.error(f"Failed to get hardware stats: {e}")
        return {}


if __name__ == '__main__':
    cfg = config.load()
    setup_logging(cfg['log_path'])
    if not cfg['server_url'] or not cfg['registration_key']:
        print('ERROR: set server_url and registration_key in /etc/signage/config.json')
        sys.exit(1)
    log.info(f'Agent v{cfg["agent_version"]} starting')
    cache.ensure_dir(cfg['cache_dir'])
    asyncio.run(SignageAgent(cfg).run())
