# Open Source Signage

Self-hosted digital signage platform. Manage content playlists across multiple
Raspberry Pi displays from a single web dashboard. Schedule by time and day,
remote-control devices, preview screenshots, and cache content locally so
playback continues if the server goes offline.

---

## Stack

| Layer     | Tech                                              |
|-----------|---------------------------------------------------|
| Backend   | Node.js · Express · Socket.IO · Prisma            |
| Database  | PostgreSQL 16                                     |
| Frontend  | React · TypeScript · Tailwind · TanStack Query    |
| RPi agent | Python 3.11+ · python-socketio · Chromium · VLC  |
| Infra     | Docker Compose · Nginx · Let's Encrypt            |

---

## Server Setup (Oracle Cloud ARM / any Ubuntu VPS)

### 1 — Prerequisites

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu && newgrp docker

# Open OS-level firewall (Oracle Cloud requires this in addition to the Security List)
sudo apt-get install -y iptables-persistent
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Also open ports 80 and 443 in the **OCI Security List**:
Networking → Virtual Cloud Networks → your VCN → Security Lists → Default →
Add Ingress Rules: TCP 80 and TCP 443 from `0.0.0.0/0`.

### 2 — Get the code onto the server

```bash
scp signage.zip ubuntu@YOUR_SERVER_IP:~
ssh ubuntu@YOUR_SERVER_IP
unzip signage.zip
mv signage ~/signage
cd ~/signage
```

### 3 — SSL certificate

```bash
sudo snap install certbot --classic

# Stop anything on port 80 first, then:
sudo certbot certonly \
  --standalone \
  -d your-domain.com \
  --non-interactive \
  --agree-tos \
  --email support@your-domain.com

# Fix permissions so the nginx container can read the certs
sudo chmod 755 /etc/letsencrypt/live
sudo chmod 755 /etc/letsencrypt/live/your-domain.com
sudo chmod 644 /etc/letsencrypt/live/your-domain.com/*.pem
sudo chmod 755 /etc/letsencrypt/archive
sudo chmod 755 /etc/letsencrypt/archive/your-domain.com
sudo chmod 644 /etc/letsencrypt/archive/your-domain.com/*.pem

# Auto-reload nginx after cert renewal
sudo bash -c 'cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << "HOOK"
#!/bin/bash
chmod 755 /etc/letsencrypt/live
chmod 755 /etc/letsencrypt/live/your-domain.com
chmod 644 /etc/letsencrypt/live/your-domain.com/*.pem
chmod 755 /etc/letsencrypt/archive
chmod 755 /etc/letsencrypt/archive/your-domain.com
chmod 644 /etc/letsencrypt/archive/your-domain.com/*.pem
docker exec signage-nginx-1 nginx -s reload
HOOK'
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

### 4 — Configure

```bash
cp .env.example .env
nano .env
```

Fill in:

```
DB_PASSWORD=strong_random_password
JWT_SECRET=64_char_random_hex        # openssl rand -hex 32
REFRESH_SECRET=different_64_char_hex  # openssl rand -hex 32
PUBLIC_URL=https://your-domain.com

# Optional — enables password reset emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=support@your-domain.com
SMTP_PASS=your-gmail-app-password    # needs a Gmail App Password, not your regular password
SMTP_FROM=Open Source Signage <support@your-domain.com>
```

Update nginx.conf with your domain:

```bash
sed -i 's/your-domain.com/your-domain.com/g' nginx/nginx.conf
```

Update docker-compose.yml to use a host bind mount for certs:

```bash
sed -i 's|- certbot_conf:/etc/letsencrypt:ro|- /etc/letsencrypt:/etc/letsencrypt:ro|' docker-compose.yml
sed -i '/^  certbot_conf:/d' docker-compose.yml
```

### 5 — Launch

```bash
docker compose up --build -d
docker compose logs -f server   # wait for "Server running on :3001"
```

### 6 — Create your admin account

This endpoint only works once — when the users table is empty:

```bash
curl -X POST https://your-domain.com/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"name":"Alykhan","email":"support@your-domain.com","password":"yourpassword"}'
```

Open https://your-domain.com and sign in.

### Updating the server after code changes

```bash
cd ~/signage
# Copy new files into place, then:
docker compose up --build -d server client
```

**Never run `prisma migrate dev` on the server** — it resets the database.
For schema changes, add columns directly:

```bash
docker compose exec postgres psql -U signage -d signage -c \
  "ALTER TABLE \"TableName\" ADD COLUMN IF NOT EXISTS col_name TYPE DEFAULT val;"
```

---

## Raspberry Pi Setup

### Supported hardware

| Model        | Architecture | Chromium | VLC | Notes                        |
|--------------|-------------|----------|-----|------------------------------|
| Pi Zero W    | ARMv6       | ✗        | ✓   | Images via framebuffer only  |
| Pi Zero 2W   | ARMv7       | ✓        | ✓   | Full display support         |
| Pi 3B / 3B+  | ARMv7/8     | ✓        | ✓   | Recommended minimum          |
| Pi 4 / 5     | ARM64       | ✓        | ✓   | Best performance             |

### 1 — Flash the OS

Use **Raspberry Pi Imager** (raspberrypi.com/software):

- **Pi Zero W**: Raspberry Pi OS Lite (Legacy, 32-bit) — Bullseye
- **Pi Zero 2W / Pi 3B+ / Pi 4+**: Raspberry Pi OS Lite (32-bit or 64-bit) — Bookworm or Trixie

In the Imager gear icon ⚙️ before writing:
- Enable SSH ✓
- Set username (e.g. `alykhan`) and password
- Configure your WiFi SSID and password
- Set hostname (e.g. `signage-lobby`)
- Paste your SSH public key (`~/.ssh/id_ed25519.pub` or `id_rsa.pub`)

### 2 — First boot

```bash
ssh alykhan@signage-lobby.local
# or use the IP from your router's DHCP table
```

Update the system:

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

### 3 — Add a device in the dashboard

Go to **Devices → Add device**, enter a name and location, and copy the
registration key — it looks like `clx8a3f2j0000...`.

### 4 — Run the installer

You can install the agent directly with a single command on your Pi using the curl installer hosted by your server:

```bash
curl -sSL https://your-domain.com/api/install/install.sh | sudo bash -s -- \
  --server https://your-domain.com \
  --key YOUR_REGISTRATION_KEY_FROM_DASHBOARD
```

*Note: Alternatively, if you want to use files from a local clone of the repository, you can transfer them to the Pi and run the installer locally:*

```bash
# From your local machine, transfer the agent folder
cd ~/signage
tar czf - rpi-agent/ | ssh alykhan@signage-lobby.local 'mkdir -p ~/agent && tar xzf - -C ~/agent --strip-components=1'

# Then run locally on the Pi
sudo bash ~/agent/install.sh \
  --server https://your-domain.com \
  --key YOUR_REGISTRATION_KEY_FROM_DASHBOARD
```

The installer:
- Detects your username automatically (no hardcoded `pi`)
- Installs Chromium, VLC, X server, Plymouth boot splash, PIL, and Python dependencies
- Configures a clean visual kiosk boot (suppresses kernel/systemd text, configures dark dashboard-themed boot splash)
- Writes `/etc/signage/config.json`
- Sets up auto-login on tty1 → auto-starts X → launches the agent
- Creates a systemd service that auto-restarts on crash
- Gives `sudo reboot` / `sudo shutdown` rights for remote commands

### 5 — Verify

```bash
systemctl status signage
journalctl -fu signage
```

The device should appear as **Online** in the dashboard within 30 seconds.

### Pi Zero W special notes

The Pi Zero W (ARMv6) cannot run Chromium — it lacks NEON SIMD support.
The agent automatically falls back to lightweight mode using `feh` (under X11) to display local images, while skipping browser-based content types.

If the physical monitor shows a black screen but the virtual screen (screenshots) works:
1. Revert from full KMS (`vc4-kms-v3d`) to fake KMS (`vc4-fkms-v3d`) in `/boot/firmware/config.txt`.
2. Enable HDMI forced hotplug (`hdmi_force_hotplug=1`) and force HDMI audio/video drive mode (`hdmi_drive=2`).
3. Comment out `disable_fw_kms_setup=1` to allow the firmware to configure display outputs for the kernel.


---

## Content types

| Type          | How to add              | How it plays                                  |
|---------------|------------------------|-----------------------------------------------|
| Image         | Upload file (drag/drop) | Chromium CSS scaled · or `fbi` on Pi Zero W  |
| Video         | Upload file             | VLC fullscreen                                |
| Google Slides | Paste share URL         | Auto-converted to embed URL · Chromium kiosk |
| Canva         | Paste Smart Embed Link  | Chromium kiosk (Share → Embed in Canva)      |
| Web URL       | Paste URL               | Chromium kiosk                                |

Max upload size: **512 MB** per file.

Google Slides — in Canva: Share → See all → Embed → Smart Embed Link.
The system also accepts regular share/edit URLs and converts them automatically.

---

## Scheduling

Schedules let a device automatically switch playlists at a given time.
Use the **Schedules** page in the dashboard or the API directly:

```bash
POST /api/schedules
{
  "deviceId":   "clx...",
  "playlistId": "clx...",
  "startTime":  "08:00",
  "endTime":    "18:00",
  "daysOfWeek": [1,2,3,4,5],   # 0=Sun 1=Mon … 6=Sat
  "priority":   0               # higher number wins on overlap
}
```

The scheduler evaluates rules every minute and pushes changes to online devices
automatically. Midnight-spanning windows (e.g. `22:00 → 06:00`) are supported.

---

## Remote control

From the dashboard device cards or API:

| Command          | Effect                                      |
|------------------|---------------------------------------------|
| `cmd:screenshot` | Capture current screen, save to server      |
| `cmd:get_logs`   | Stream last 200 log lines                   |
| `cmd:restart`    | Restart the Python agent process            |
| `cmd:reboot`     | Reboot the Raspberry Pi                     |
| `cmd:shutdown`   | Shutdown the Raspberry Pi                   |

```bash
POST /api/devices/:id/cmd
{ "command": "cmd:screenshot" }
```

---

## Roles

| Role              | Can do                                              |
|-------------------|-----------------------------------------------------|
| `SUPER_ADMIN`     | Everything across all teams                         |
| `TEAM_ADMIN`      | Manage team devices, users, playlists, schedules    |
| `CONTENT_CREATOR` | Upload content, create and edit playlists           |
| `VIEWER`          | Read-only dashboard                                 |

---

## Password reset

Users can request a reset link from the login page (Forgot password?).
Requires SMTP configured in `.env`. Without SMTP, the reset URL is printed
to `docker compose logs server` for manual sharing.

For Gmail, generate an **App Password**:
Google Account → Security → 2-Step Verification → App passwords

---

## Offline behaviour

When the server is unreachable each Pi:
- Continues playing the last-known playlist from its local cache
- Reconnects automatically when the server comes back
- Re-downloads any changed files on reconnect (SHA-256 checksums skip unchanged files)

Google Slides and web URLs require internet — they are skipped if offline.

---

## Project structure

```
signage/
├── docker-compose.yml
├── .env.example
├── nginx/nginx.conf
│
├── server/
│   ├── Dockerfile                      # node:20-slim + openssl
│   ├── prisma/schema.prisma            # full data model
│   └── src/
│       ├── index.ts                    # Express + Socket.IO entry
│       ├── socket.ts                   # device connection manager + screenshot handler
│       ├── middleware/
│       │   ├── auth.ts                 # JWT verification
│       │   └── rbac.ts                 # role-based access
│       ├── routes/
│       │   ├── auth.ts                 # login, refresh, setup, forgot/reset password
│       │   ├── devices.ts              # device CRUD + remote commands
│       │   ├── playlists.ts            # playlist CRUD + deploy + duplicate
│       │   ├── content.ts              # file upload (+ thumbnail), URL, delete
│       │   ├── schedules.ts            # schedule CRUD
│       │   └── users.ts               # user management
│       └── services/
│           ├── scheduler.ts            # cron: evaluates time rules every minute
│           └── email.ts                # nodemailer password reset emails
│
├── client/
│   └── src/
│       ├── App.tsx                     # router + auth init + loading gate
│       ├── lib/
│       │   ├── api.ts                  # axios + JWT auto-refresh
│       │   └── store.ts                # zustand auth store with loading state
│       ├── components/
│       │   ├── Layout.tsx              # sidebar (desktop) + bottom tabs (mobile)
│       │   └── PlaylistBuilder.tsx     # DnD editor with thumbnails + deploy
│       └── pages/
│           ├── Login.tsx               # sign in + forgot password link
│           ├── ForgotPassword.tsx      # request reset email
│           ├── ResetPassword.tsx       # set new password via token
│           ├── Dashboard.tsx           # live device grid + screenshots
│           ├── Devices.tsx             # device management + remote control
│           ├── Playlists.tsx           # playlist list + duplicate
│           ├── Content.tsx             # library + drag-drop upload + thumbnails + preview
│           ├── Schedules.tsx           # weekly timeline + schedule modal
│           └── Users.tsx               # user management + role grants table
│
└── rpi-agent/
    ├── install.sh      # one-shot installer — auto-detects username and home dir
    ├── agent.py        # Socket.IO client · playlist loop · command handler
    ├── player.py       # DisplayServer (aiohttp) + Chromium kiosk + VLC
    ├── cache.py        # file download · checksum verification · local persistence
    ├── screen.py       # xrandr resolution detection
    └── config.py       # reads /etc/signage/config.json + env vars
```

---

## Backup & Failover

The platform supports automated backups of the PostgreSQL database and `/media` files. For instructions on automated backups and setting up high-availability backup servers using DNS Failover, see [BACKUP_FAILOVER_GUIDE.md](file:///Users/alykhanlalani/Documents/code/signage/BACKUP_FAILOVER_GUIDE.md).

---

## Common issues

**502 Bad Gateway** — server container crashed. Check:
```bash
docker compose logs server --tail=30
```

**Prisma P3009 / failed migration** — mark it resolved without touching data:
```bash
docker compose exec postgres psql -U signage -d signage -c \
  "UPDATE \"_prisma_migrations\" SET finished_at=now(), applied_steps_count=1
   WHERE migration_name='20260612000000_add_crossfade';"
docker compose restart server
```

**Login works but redirects to /login on refresh** — `store.ts` is an old
version without the `loading` field. Re-copy `client/src/lib/store.ts` and
rebuild the client.

**Cert not found by nginx** — permissions issue:
```bash
sudo chmod 755 /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod 755 /etc/letsencrypt/live/your-domain.com
sudo chmod 755 /etc/letsencrypt/archive/your-domain.com
sudo chmod 644 /etc/letsencrypt/live/your-domain.com/*.pem
sudo chmod 644 /etc/letsencrypt/archive/your-domain.com/*.pem
docker compose restart nginx
```

**Pi not showing on dashboard** — check the agent:
```bash
journalctl -fu signage
# Look for "Connected to server" — if missing, check network and registration key
cat /etc/signage/config.json
```

**Chromium defunct on Pi 3B** — X is not running when the agent starts.
The service waits 8 seconds at boot but X may take longer on first run.
Increase the delay:
```bash
sudo sed -i 's/ExecStartPre=\/bin\/sleep 5/ExecStartPre=\/bin\/sleep 12/' \
  /etc/systemd/system/signage.service
sudo systemctl daemon-reload && sudo systemctl restart signage
```

**Pi Zero W — images not displaying** — check if `feh` is installed and running:
```bash
which feh
DISPLAY=:0 feh -F -Y -Z -x /path/to/image.jpg  # test directly
journalctl -u signage
```

