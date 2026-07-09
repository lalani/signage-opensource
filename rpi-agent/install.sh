#!/usr/bin/env bash
# Signage RPi Agent — one-shot installer
# Usage: sudo bash install.sh --server https://your-domain.com --key YOUR_REGISTRATION_KEY
set -euo pipefail

SERVER_URL=""
REG_KEY=""
AGENT_DIR="/opt/signage-agent"

# Detect the real user (the one who invoked sudo, not root)
if [[ -n "${SUDO_USER:-}" ]]; then
    SVC_USER="$SUDO_USER"
else
    SVC_USER="$(logname 2>/dev/null || whoami)"
fi
SVC_HOME=$(getent passwd "$SVC_USER" | cut -d: -f6)

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --server) SERVER_URL="$2"; shift 2 ;;
        --key)    REG_KEY="$2";    shift 2 ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

[[ -z "$SERVER_URL" ]] && { echo "ERROR: --server required"; exit 1; }
[[ -z "$REG_KEY"    ]] && { echo "ERROR: --key required";    exit 1; }

echo "==> Installing for user: $SVC_USER (home: $SVC_HOME)"

echo "==> Installing system packages"
apt-get update -q
apt-get install -y -q \
    python3 python3-pip python3-venv \
    chromium vlc libvlc-dev \
    scrot unclutter xdotool \
    xserver-xorg-core xserver-xorg xinit \
    x11-xserver-utils matchbox-window-manager \
    plymouth plymouth-themes python3-pil feh

echo "==> Deploying agent to $AGENT_DIR"
mkdir -p "$AGENT_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/agent.py" && -f "$SCRIPT_DIR/player.py" ]]; then
    echo "  Using local agent files"
    cp "$SCRIPT_DIR"/*.py "$AGENT_DIR/"
else
    echo "  Downloading agent files from server: $SERVER_URL"
    for file in agent.py player.py config.py cache.py screen.py; do
        curl -sSL -f "$SERVER_URL/api/install/$file" -o "$AGENT_DIR/$file"
    done
fi

# Write corrected requirements.txt (fixed VLC version pin)
cat > "$AGENT_DIR/requirements.txt" << 'EOF'
python-socketio>=5.11.2
python-engineio>=4.8.0
aiohttp>=3.10.0
requests>=2.31.0
python-vlc>=3.0.20123
psutil>=5.9.0
EOF

echo "==> Creating virtualenv"
python3 -m venv "$AGENT_DIR/venv"
"$AGENT_DIR/venv/bin/pip" install --quiet --no-cache-dir -r "$AGENT_DIR/requirements.txt"

echo "==> Writing config"
mkdir -p /etc/signage
cat > /etc/signage/config.json << EOF
{
  "server_url": "$SERVER_URL",
  "registration_key": "$REG_KEY"
}
EOF
# Readable by the service user
chown "$SVC_USER:$SVC_USER" /etc/signage/config.json
chmod 640 /etc/signage/config.json

echo "==> Creating cache and log directories"
mkdir -p "$SVC_HOME/signage/cache"
chown -R "$SVC_USER:$SVC_USER" "$SVC_HOME/signage"

# config.py and cache.py now use Path.home() dynamically, no patching needed

echo "==> Patching player.py for correct chromium binary name"
# Raspberry Pi OS uses 'chromium-browser', Debian Trixie uses 'chromium'
if command -v chromium &>/dev/null; then
    sed -i 's/chromium-browser/chromium/g' "$AGENT_DIR/player.py"
fi

echo "==> Disabling screen blanking"
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-noblank.conf << 'EOF'
Section "ServerFlags"
    Option "BlankTime"   "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime"     "0"
EndSection
EOF

echo "==> Setting up X auto-start on tty1"
mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $SVC_USER --noclear %I \$TERM
EOF

cat > "$SVC_HOME/.bash_profile" << 'EOF'
[[ -z "$DISPLAY" && "$(tty)" == "/dev/tty1" ]] && exec startx -- vt1 -nocursor
EOF
chown "$SVC_USER:$SVC_USER" "$SVC_HOME/.bash_profile"

cat > "$SVC_HOME/.xinitrc" << EOF
# Transition Plymouth → X cleanly
plymouth quit --retain-splash 2>/dev/null || true
sleep 0.5
xset s off
xset s noblank
xset -dpms
unclutter -idle 1 &
matchbox-window-manager -use_titlebar no
EOF
chown "$SVC_USER:$SVC_USER" "$SVC_HOME/.xinitrc"

echo "==> Configuring boot splash screen"
THEME_DIR="/usr/share/plymouth/themes/signage"
CMDLINE="/boot/firmware/cmdline.txt"
CONFIG="/boot/firmware/config.txt"

mkdir -p "$THEME_DIR"

# Generate default splash image matching dashboard
python3 << 'PYEOF'
import struct, zlib
try:
    from PIL import Image, ImageDraw
    W, H = 1920, 1080
    img = Image.new('RGB', (W, H), (8, 11, 20))          # #080B14 — dashboard bg
    draw = ImageDraw.Draw(img)

    # Teal square badge (the "S" logo from the dashboard)
    cx, cy = W // 2, H // 2 - 40
    size = 80
    r = 16
    draw.rectangle([cx - size//2 + r, cy - size//2,
                    cx + size//2 - r, cy + size//2], fill=(26, 228, 200))
    draw.rectangle([cx - size//2, cy - size//2 + r,
                    cx + size//2, cy + size//2 - r], fill=(26, 228, 200))
    for ox, oy in [(-1,-1),(1,-1),(-1,1),(1,1)]:
        draw.ellipse([cx + ox*(size//2 - r) - r, cy + oy*(size//2 - r) - r,
                      cx + ox*(size//2 - r) + r, cy + oy*(size//2 - r) + r],
                     fill=(26, 228, 200))

    # "S" letter
    draw.text((cx, cy), "S", fill=(8, 11, 20), anchor="mm")

    # "Signage" text below
    draw.text((cx, cy + size//2 + 32), "Signage",
              fill=(232, 234, 240), anchor="mm")

    img.save('/usr/share/plymouth/themes/signage/splash.png')
    print("  PIL splash generated")
except Exception as e:
    # Fallback: solid dark PNG (no PIL available)
    def solid_png(w, h, r, g, b):
        def chunk(tag, data):
            c = zlib.crc32(tag + data) & 0xFFFFFFFF
            return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)
        row = struct.pack('B', 0) + bytes([r, g, b] * w)
        raw = zlib.compress(row * h, 9)
        hdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', hdr) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')
    with open('/usr/share/plymouth/themes/signage/splash.png', 'wb') as f:
        f.write(solid_png(1920, 1080, 8, 11, 20))
    print(f"  Fallback solid dark PNG generated: {e}")
PYEOF

cat > "$THEME_DIR/signage.plymouth" << 'EOF'
[Plymouth Theme]
Name=Signage
Description=Signage kiosk boot splash
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/signage
ScriptFile=/usr/share/plymouth/themes/signage/signage.script
EOF

cat > "$THEME_DIR/signage.script" << 'EOF'
// Dark background matching the dashboard
Window.SetBackgroundTopColor(0.031, 0.043, 0.078);
Window.SetBackgroundBottomColor(0.031, 0.043, 0.078);

// Centre the splash image
logo.image  = Image("splash.png");
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetWidth()  / 2 - logo.image.GetWidth()  / 2);
logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2);
logo.sprite.SetOpacity(1);
EOF

if command -v plymouth-set-default-theme &>/dev/null; then
    plymouth-set-default-theme signage
    echo "==> Rebuilding initramfs (this takes a minute on the Pi)"
    update-initramfs -u || true
fi

# Hide kernel boot text and console on tty1
if [[ -f "$CMDLINE" ]]; then
    # Keep console=tty1 at the start so Plymouth graphical splash works
    if ! grep -q "console=tty1" "$CMDLINE"; then
        sed -i 's/^/console=tty1 /' "$CMDLINE"
    fi
    for flag in quiet "loglevel=0" "vt.global_cursor_default=0" "logo.nologo" "splash" "plymouth.enable=1"; do
        grep -q "$flag" "$CMDLINE" || sed -i "s/$/ $flag/" "$CMDLINE"
    done
    sed -i 's/  */ /g; s/^ //; s/ $//' "$CMDLINE"
fi

# Disable GPU rainbow square
if [[ -f "$CONFIG" ]]; then
    grep -q 'disable_splash' "$CONFIG" || echo 'disable_splash=1' >> "$CONFIG"
fi

# Silence systemd status output
mkdir -p /etc/systemd/system.conf.d/
cat > /etc/systemd/system.conf.d/nosplash.conf << 'EOF'
[Manager]
ShowStatus=no
StatusUnitFormat=name
EOF

cat > /etc/systemd/system/signage.service << EOF
[Unit]
Description=Signage Display Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$SVC_HOME/.Xauthority
WorkingDirectory=$AGENT_DIR
ExecStartPre=/bin/sleep 12
ExecStart=$AGENT_DIR/venv/bin/python agent.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Deploy update-splash.sh
echo "==> Deploying splash screen update helper"
cat > "$AGENT_DIR/update-splash.sh" << EOF
#!/bin/bash
set -e
THEME_DIR="/usr/share/plymouth/themes/signage"
BACKUP="\$THEME_DIR/splash-default.png"
SPLASH="\$THEME_DIR/splash.png"
CUSTOM="$SVC_HOME/signage/custom-splash.png"

if [ ! -f "\$BACKUP" ] && [ -f "\$SPLASH" ]; then
    cp "\$SPLASH" "\$BACKUP"
fi

if [ -f "\$CUSTOM" ]; then
    cp -f "\$CUSTOM" "\$SPLASH"
else
    if [ -f "\$BACKUP" ]; then
        cp -f "\$BACKUP" "\$SPLASH"
    fi
fi

if command -v update-initramfs &>/dev/null; then
    update-initramfs -u
fi
EOF
chmod 755 "$AGENT_DIR/update-splash.sh"
chown root:root "$AGENT_DIR/update-splash.sh"

echo "==> Configuring sudo for reboot/shutdown and splash updates"
cat > /etc/sudoers.d/signage << EOF
$SVC_USER ALL=(ALL) NOPASSWD: /sbin/reboot, /sbin/shutdown, /opt/signage-agent/update-splash.sh
EOF
chmod 440 /etc/sudoers.d/signage

systemctl daemon-reload
systemctl enable signage.service
systemctl restart signage.service

echo ""
echo "✓ Agent installed for user: $SVC_USER"
echo "  Status : systemctl status signage"
echo "  Logs   : journalctl -fu signage"
echo "  Config : /etc/signage/config.json"
echo "  Cache  : $SVC_HOME/signage/cache"
