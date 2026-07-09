from __future__ import annotations
import logging
import os
import subprocess
import time
from pathlib import Path

from aiohttp import web

log = logging.getLogger('player')

def has_neon() -> bool:
    """Detect if CPU supports NEON / ASIMD extensions (required for modern Chromium)."""
    try:
        import platform
        if platform.machine() in ('aarch64', 'arm64'):
            return True
        with open('/proc/cpuinfo') as f:
            for line in f:
                if 'Features' in line and ('neon' in line or 'asimd' in line):
                    return True
    except Exception:
        pass
    return False

# ── Controller HTML ───────────────────────────────────────────────────────────
# Two layers crossfade so there's never a white/black flash between items.
# All content (local images AND remote URLs) is loaded from the same HTTP
# origin so Chrome security policy never blocks anything.

CONTROLLER_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
  #viewport { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  .layer {
    position: absolute; inset: 0;
    opacity: 0; transition: opacity 0.4s ease-in-out;
    display: flex; align-items: center; justify-content: center;
    background: #000;
  }
  .layer.on { opacity: 1; }
  .layer img    { max-width: 100%; max-height: 100%; }
  .layer iframe { width: 100%; height: 100%; border: none; display: block; }

  /* Widget Overlay Styles */
  .widget-overlay {
    position: absolute;
    z-index: 50;
    pointer-events: none;
    display: flex;
  }

  @keyframes local-marquee {
    0% { transform: translate3d(0, 0, 0); }
    100% { transform: translate3d(-100%, 0, 0); }
  }
</style>
</head>
<body>
<div id="viewport">
  <div id="A" class="layer"></div>
  <div id="B" class="layer"></div>
</div>
<script>
  let front = 'A', last = '';

  function fill(el, url, type, scale) {
    el.innerHTML = '';
    if (type === 'image') {
      const img = new Image();
      img.onload = () => { 
        el.innerHTML = ''; 
        img.style.objectFit = (scale === 'STRETCH') ? 'fill' : (scale === 'FILL') ? 'cover' : 'contain';
        img.style.width = '100%';
        img.style.height = '100%';
        el.appendChild(img); 
      };
      img.onerror = () => { el.innerHTML = ''; };
      img.src = url;
    } else {
      const f = document.createElement('iframe');
      f.src = url; f.allowFullscreen = true;
      el.appendChild(f);
    }
  }

  function updateViewport(orientation) {
    const vp = document.getElementById('viewport');
    if (!vp) return;

    const isViewportLandscape = window.innerWidth > window.innerHeight;
    let rotation = 0;
    let width = '100vw';
    let height = '100vh';

    if (orientation === 'PORTRAIT') {
      if (isViewportLandscape) {
        rotation = 90;
        width = '100vh';
        height = '100vw';
      }
    } else if (orientation === 'PORTRAIT_FLIPPED') {
      if (isViewportLandscape) {
        rotation = 270;
        width = '100vh';
        height = '100vw';
      } else {
        rotation = 180;
      }
    } else if (orientation === 'LANDSCAPE_FLIPPED') {
      if (isViewportLandscape) {
        rotation = 180;
      } else {
        rotation = 270;
        width = '100vh';
        height = '100vw';
      }
    } else { // LANDSCAPE
      if (!isViewportLandscape) {
        rotation = 90;
        width = '100vh';
        height = '100vw';
      }
    }

    vp.style.width = width;
    vp.style.height = height;
    if (rotation === 0) {
      vp.style.transform = '';
      vp.style.position = 'relative';
      vp.style.top = '';
      vp.style.left = '';
    } else {
      vp.style.position = 'absolute';
      vp.style.top = '50%';
      vp.style.left = '50%';
      vp.style.transform = 'translate(-50%, -50%) rotate(' + rotation + 'deg)';
    }
  }

  // ── Widgets Rendering Helpers ──
  function getWidgetStyle(position, settings) {
    const base = {
      position: 'absolute',
      zIndex: '50',
      pointerEvents: 'none',
      display: 'flex'
    };

    if (position === 'CUSTOM') {
      const top = settings.customTop !== undefined ? settings.customTop : 10;
      const left = settings.customLeft !== undefined ? settings.customLeft : 10;
      return Object.assign(base, {
        top: top + '%',
        left: left + '%',
        transform: 'translate(-50%, -50%)'
      });
    }

    switch (position) {
      case 'TOP_LEFT':
        return Object.assign(base, { top: '1.5rem', left: '1.5rem' });
      case 'TOP_RIGHT':
        return Object.assign(base, { top: '1.5rem', right: '1.5rem' });
      case 'BOTTOM_LEFT':
        return Object.assign(base, { bottom: '1.5rem', left: '1.5rem' });
      case 'BOTTOM_RIGHT':
        return Object.assign(base, { bottom: '1.5rem', right: '1.5rem' });
      case 'TOP_CENTER':
        return Object.assign(base, { top: '1.5rem', left: '50%', transform: 'translateX(-50%)' });
      case 'BOTTOM_CENTER':
        return Object.assign(base, { bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)' });
      case 'CENTER':
        return Object.assign(base, { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
      case 'TOP_BAR':
        return Object.assign(base, { top: '0', left: '0', width: '100%' });
      case 'BOTTOM_BAR':
        return Object.assign(base, { bottom: '0', left: '0', width: '100%' });
      case 'LEFT_BAR':
        return Object.assign(base, { top: '0', left: '0', height: '100%', flexDirection: 'column' });
      case 'RIGHT_BAR':
        return Object.assign(base, { top: '0', right: '0', height: '100%', flexDirection: 'column' });
      default:
        return base;
    }
  }

  function renderClock(container, settings) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px; border-radius: 16px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.1); color: ${settings.color || '#fff'}; font-size: ${settings.fontSize || '1.4rem'}; box-shadow: 0 10px 25px rgba(0,0,0,0.3); font-family: sans-serif;" class="clock-widget" data-timezone="${settings.timezone || ''}" data-format="${settings.format || '12h'}">
        <div class="clock-time" style="font-weight: bold; font-family: monospace; tracking-tight; line-height: 1; white-space: nowrap;">--:-- --</div>
        <div class="clock-date" style="font-size: 0.55em; margin-top: 4px; opacity: 0.75; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap;">Loading date...</div>
      </div>
    `;
  }

  function renderWeather(container, settings) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-radius: 16px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.1); color: ${settings.color || '#fff'}; font-size: ${settings.fontSize || '1.2rem'}; box-shadow: 0 10px 25px rgba(0,0,0,0.3); font-family: sans-serif;">
        <span class="weather-icon" style="font-size: 1.5em; line-height: 1;">🌤️</span>
        <div style="display: flex; flex-direction: column; justify-content: center;">
          <span class="weather-temp" style="font-weight: bold; font-family: monospace; line-height: 1;">--</span>
          <span style="font-size: 0.55em; margin-top: 2px; opacity: 0.75; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1; white-space: nowrap;">${settings.city || 'Atlanta'}</span>
        </div>
      </div>
    `;

    const city = settings.city || 'Atlanta';
    const unit = settings.unit === 'C' ? '°C' : '°F';

    async function fetchWeather() {
      try {
        const geoRes = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=en&format=json');
        const geoData = await geoRes.json();
        if (geoData.results && geoData.results[0]) {
          const { latitude, longitude } = geoData.results[0];
          const weatherRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude + '&current_weather=true');
          const weatherData = await weatherRes.json();
          if (weatherData.current_weather) {
            let tempVal = Math.round(weatherData.current_weather.temperature);
            if (settings.unit !== 'C') {
              tempVal = Math.round((tempVal * 9/5) + 32);
            }
            container.querySelector('.weather-temp').textContent = tempVal + unit;
          }
        }
      } catch(e) {}
    }
    fetchWeather();
    setInterval(fetchWeather, 30 * 60 * 1000);
  }

  function renderTicker(container, settings) {
    container.innerHTML = `
      <div style="width: 100%; overflow: hidden; white-space: nowrap; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); background: ${settings.bg || 'rgba(0,0,0,0.55)'}; color: ${settings.color || '#fff'}; font-size: ${settings.fontSize || '1.1rem'}; font-family: sans-serif;">
        <div style="display: inline-block; padding-left: 100%; animation: local-marquee ${settings.speed || 15}s linear infinite;">
          ${settings.text || 'Welcome to Open Source Signage'}
        </div>
      </div>
    `;
  }

  function updateWidgets(widgets) {
    const wHash = JSON.stringify(widgets);
    if (wHash === window.lastWidgetsHash) return;
    window.lastWidgetsHash = wHash;

    document.querySelectorAll('.widget-overlay').forEach(el => el.remove());

    const vp = document.getElementById('viewport');
    widgets.forEach(w => {
      const el = document.createElement('div');
      el.className = 'widget-overlay';
      
      const style = getWidgetStyle(w.position, w.settings);
      Object.assign(el.style, style);

      if (w.type === 'CLOCK') {
        renderClock(el, w.settings);
      } else if (w.type === 'WEATHER') {
        renderWeather(el, w.settings);
      } else if (w.type === 'TICKER') {
        renderTicker(el, w.settings);
      }

      vp.appendChild(el);
    });
  }

  // Global Clock ticking interval
  setInterval(() => {
    document.querySelectorAll('.clock-widget').forEach(el => {
      const timezone = el.dataset.timezone;
      const format24h = el.dataset.format === '24h';
      const now = new Date();
      
      const timeStr = now.toLocaleTimeString([], {
        timeZone: timezone || undefined,
        hour: '2-digit',
        minute: '2-digit',
        hour12: !format24h
      });
      const dateStr = now.toLocaleDateString([], {
        timeZone: timezone || undefined,
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      
      el.querySelector('.clock-time').textContent = timeStr;
      el.querySelector('.clock-date').textContent = dateStr;
    });
  }, 1000);

  async function poll() {
    try {
      const r = await fetch('/content?t=' + Date.now(), { cache: 'no-store' });
      const d = await r.json();
      if (d.orientation) {
        updateViewport(d.orientation);
      }
      if (d.widgets) {
        updateWidgets(d.widgets);
      }
      if (d.url && d.url !== last) {
        last = d.url;
        const back = front === 'A' ? 'B' : 'A';
        const backEl  = document.getElementById(back);
        const frontEl = document.getElementById(front);
        fill(backEl, d.url, d.type, d.scale);
        const swap = () => {
          backEl.classList.add('on');
          frontEl.classList.remove('on');
          front = back;
        };
        if (d.crossfade === false) {
          backEl.style.transition  = 'none';
          frontEl.style.transition = 'none';
          swap();
          setTimeout(() => { backEl.style.transition = ''; frontEl.style.transition = ''; }, 50);
        } else {
          setTimeout(swap, d.type === 'image' ? 150 : 350);
        }
      }
    } catch(_) {}
    setTimeout(poll, 500);
  }
  poll();
</script>
</body>
</html>"""


# ── Display server ────────────────────────────────────────────────────────────

class DisplayServer:
    PORT = 8888

    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self._content: dict = {'url': '', 'type': 'image', 'crossfade': True, 'scale': 'FIT', 'orientation': 'LANDSCAPE', 'widgets': []}
        self._runner = None

    async def start(self):
        app = web.Application()
        app.router.add_get('/', self._index)
        app.router.add_get('/content', self._get_content)
        app.router.add_get('/custom-splash.png', self._serve_custom_splash)
        # Serve the cache directory over HTTP so Chromium can load local files
        # without hitting file:// same-origin restrictions
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        app.router.add_static('/cache', str(self.cache_dir), show_index=False)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, '127.0.0.1', self.PORT)
        await site.start()
        log.info(f'Display server on http://127.0.0.1:{self.PORT}')
        log.info(f'Cache served at http://127.0.0.1:{self.PORT}/cache/')

    async def _index(self, _req: web.Request) -> web.Response:
        return web.Response(text=CONTROLLER_HTML, content_type='text/html')

    async def _get_content(self, _req: web.Request) -> web.Response:
        return web.json_response(self._content)

    async def _serve_custom_splash(self, _req: web.Request) -> web.Response:
        splash_file = Path.home() / 'signage/custom-splash.png'
        if splash_file.exists():
            return web.FileResponse(splash_file)
        default_splash = Path('/usr/share/plymouth/themes/signage/splash.png')
        if default_splash.exists():
            return web.FileResponse(default_splash)
        return web.HTTPNotFound()

    def set(self, url: str, ctype: str, crossfade: bool = True, scale: str = 'FIT') -> None:
        self._content.update({'url': url, 'type': ctype, 'crossfade': crossfade, 'scale': scale})
        log.info(f'Display → {ctype}: {url[:80]} (crossfade={crossfade}, scale={scale})')

    def set_orientation(self, orientation: str) -> None:
        self._content['orientation'] = orientation
        log.info(f'Display server orientation set to: {orientation}')

    def set_widgets(self, widgets: list) -> None:
        self._content['widgets'] = widgets
        log.info(f'Display server widgets updated ({len(widgets)} widgets)')

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()
            log.info('Display server stopped')


# ── Player ────────────────────────────────────────────────────────────────────

class Player:
    def __init__(self, display: DisplayServer):
        self.display   = display
        self._chromium: subprocess.Popen | None = None
        self._vlc_instance = None
        self._vlc_player   = None
        self._feh_process: subprocess.Popen | None = None
        self.use_lightweight = not has_neon()
        self._current_scale: str | None = None
        # Read display env once at startup
        self._display_env = os.environ.get('DISPLAY', ':0')
        self._xauth       = os.environ.get(
            'XAUTHORITY', str(Path.home() / '.Xauthority')
        )
        if self.use_lightweight:
            log.info("Lightweight display mode active (no NEON support detected)")

    # ── Public ────────────────────────────────────────────────────────────────

    def set_orientation(self, orientation: str) -> None:
        self.display.set_orientation(orientation)

    def set_widgets(self, widgets: list) -> None:
        self.display.set_widgets(widgets)

    def ensure_chromium(self) -> None:
        """Launch Chromium if not already running."""
        if self.use_lightweight:
            return
        if self._chromium and self._chromium.poll() is None:
            return
        log.info('Launching Chromium → http://127.0.0.1:8888')
        import shutil
        chrome_bin = 'chromium-browser' if shutil.which('chromium-browser') else 'chromium'
        self._chromium = subprocess.Popen(
            [
                chrome_bin,
                '--kiosk',
                '--noerrdialogs',
                '--disable-infobars',
                '--no-first-run',
                '--no-sandbox',
                '--disable-features=Translate',
                '--disable-session-crashed-bubble',
                '--disable-restore-session-state',
                '--autoplay-policy=no-user-gesture-required',
                '--check-for-update-interval=31536000',
                'http://127.0.0.1:8888',
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={
                **os.environ,
                'DISPLAY':    self._display_env,
                'XAUTHORITY': self._xauth,
            },
        )
        log.info(f'Chromium PID {self._chromium.pid}')

    def play_item(self, item: dict) -> None:
        content   = item['content']
        ctype     = content['type']
        crossfade = content.get('crossfade', True)

        if self.use_lightweight:
            if ctype == 'VIDEO':
                self._kill_feh()
                self._play_vlc(content)
                return

            if ctype == 'IMAGE':
                self._kill_vlc()
                local = content.get('localPath')
                if local and Path(local).exists():
                    self._play_feh(content)
                else:
                    log.error(f'Local image missing: {local}')
                return

            log.warning(f'Web content "{content.get("name")}" not supported in lightweight mode')
            return

        if ctype == 'VIDEO':
            # VLC takes the display directly — Chromium must not be running
            self._kill_chromium()
            self._play_vlc(content)
            return

        if ctype == 'IMAGE':
            local = content.get('localPath')
            if local:
                # Serve via the display server's /cache/ route so Chrome
                # stays on the same HTTP origin — no file:// restrictions
                filename = Path(local).name
                url = f'http://127.0.0.1:{DisplayServer.PORT}/cache/{filename}'
            else:
                url = content.get('fileUrl', '')
            self.display.set(url, 'image', crossfade, content.get('scale', 'FIT'))
        else:
            # SLIDES_URL, WEB_URL, CANVA_URL
            url = content.get('url', '')
            self.display.set(url, 'url', crossfade)

        self.ensure_chromium()

    def show_splash(self) -> None:
        """Display the custom or default boot splash image if it exists, otherwise clear screen."""
        splash_file = Path.home() / 'signage/custom-splash.png'
        default_file = Path('/usr/share/plymouth/themes/signage/splash.png')
        
        target_file = splash_file if splash_file.exists() else (default_file if default_file.exists() else None)
        
        if target_file:
            log.info(f'Displaying startup splash image: {target_file}')
            if self.use_lightweight:
                self._kill_vlc()
                self._play_feh({'localPath': str(target_file), 'scale': 'FILL'})
            else:
                self.display.set(
                    f'http://127.0.0.1:{DisplayServer.PORT}/custom-splash.png',
                    'image',
                    False,
                    'FILL'
                )
                self.ensure_chromium()
        else:
            log.info('No splash image found, displaying default black/clear screen')
            if self.use_lightweight:
                self._kill_feh()
                self._kill_vlc()
            else:
                self.display.set('', 'image', False)
                self.ensure_chromium()

    def stop(self) -> None:
        self._kill_chromium()
        self._kill_vlc()
        self._kill_feh()

    # ── Internal ──────────────────────────────────────────────────────────────

    def _play_feh(self, content: dict) -> None:
        local = content.get('localPath')
        if not local or not os.path.exists(local): return
        scale = content.get('scale', 'FIT')
        target_path = '/tmp/signage-current.png'

        needs_restart = (
            not self._feh_process or 
            self._feh_process.poll() is not None or 
            self._current_scale != scale
        )

        if needs_restart:
            self._kill_feh()
            self._current_scale = scale
            
            import shutil
            try:
                shutil.copy2(local, target_path)
            except Exception as e:
                log.error(f"Failed to copy image to tmp: {e}")
                return
                
            zoom_flag = '-^' if scale in ('FILL', 'STRETCH') else '-Z'
            log.info(f'Launching feh: {local} (scale={scale})')
            self._feh_process = subprocess.Popen(
                ['feh', '-F', '-Y', zoom_flag, '-x', '-q', target_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env={
                    **os.environ,
                    'DISPLAY':    self._display_env,
                    'XAUTHORITY': self._xauth,
                }
            )
        else:
            import shutil
            try:
                shutil.copy2(local, target_path)
            except Exception as e:
                log.error(f"Failed to copy image to tmp: {e}")
                return
                
            log.info(f'Reloading feh: {local} (scale={scale})')
            subprocess.run(
                ['xdotool', 'search', '--class', 'feh', 'key', 'r'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env={
                    **os.environ,
                    'DISPLAY':    self._display_env,
                    'XAUTHORITY': self._xauth,
                }
            )

    def _kill_feh(self) -> None:
        if self._feh_process and self._feh_process.poll() is None:
            self._feh_process.kill()
            try:
                self._feh_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
        self._feh_process = None
        self._current_scale = None
        subprocess.run(['pkill', '-x', 'feh'], capture_output=True)
        try:
            os.unlink('/tmp/signage-current.png')
        except Exception:
            pass


    def _kill_chromium(self) -> None:
        if self._chromium and self._chromium.poll() is None:
            self._chromium.kill()
            try:
                self._chromium.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
        self._chromium = None
        subprocess.run(['pkill', '-f', 'chromium'], capture_output=True)
        time.sleep(0.3)

    def _kill_vlc(self) -> None:
        if self._vlc_player:
            try:
                self._vlc_player.stop()
                self._vlc_player.release()
            except Exception:
                pass
        self._vlc_player = None
        subprocess.run(['pkill', '-x', 'vlc'], capture_output=True)

    def _play_vlc(self, content: dict) -> None:
        path = content.get('localPath') or content.get('fileUrl', '')
        if not path:
            log.error(f'No path for video {content["id"]}')
            return
        is_muted = content.get('muted', True)
        try:
            import vlc  # type: ignore
            if not self._vlc_instance:
                self._vlc_instance = vlc.Instance(
                    '--fullscreen', '--no-osd', '--no-video-title-show'
                )
            media = self._vlc_instance.media_new(path)
            self._vlc_player = self._vlc_instance.media_player_new()
            self._vlc_player.set_media(media)
            if is_muted:
                self._vlc_player.audio_set_mute(True)
            self._vlc_player.play()
        except ImportError:
            vlc_args = ['vlc', '--fullscreen', '--no-osd']
            if is_muted:
                vlc_args.append('--no-audio')
            vlc_args.append(path)
            subprocess.Popen(
                vlc_args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env={**os.environ, 'DISPLAY': self._display_env},
            )
