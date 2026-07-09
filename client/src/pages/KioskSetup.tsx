import { useState } from 'react'
import toast from 'react-hot-toast'

export default function KioskSetup() {
  const [deviceTab, setDeviceTab] = useState<'rpi' | 'brightsign'>('rpi')
  const [osTab, setOsTab] = useState<'mac' | 'windows'>('mac')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const serverUrl = window.location.origin
  const playerUrl = `${serverUrl}/player`

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('Copied to clipboard!')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const sshGenMac = 'ssh-keygen -t ed25519 -C "your_email@example.com"'
  const sshReadMac = 'cat ~/.ssh/id_ed25519.pub'
  const sshGenWin = 'ssh-keygen -t ed25519 -C "your_email@example.com"'
  const sshReadWin = 'Get-Content ~\\.ssh\\id_ed25519.pub'

  const installCmd = `curl -sSL ${serverUrl}/api/install/install.sh | sudo bash -s -- \\
  --server ${serverUrl} \\
  --key YOUR_REGISTRATION_KEY`

  const brightsignAutorun = `' Open Source Signage BrightSign Autorun Script
Sub Main()
    ' Enable Javascript and Local Storage
    reg = CreateObject("roRegistrySection", "html")
    reg.Write("enable_javascript", "1")
    reg.Write("enable_local_storage", "1")
    
    ' Set screen resolution
    mode = CreateObject("roVideoMode")
    mode.SetMode("1920x1080x60p")
    
    ' Configure HTML5 Widget
    rect = CreateObject("roRectangle", 0, 0, 1920, 1080)
    config = CreateObject("roAssociativeArray")
    config.url = "${playerUrl}"
    config.javascript_enabled = true
    config.storage_path = "SD:"
    config.storage_quota = 1073741824 ' Allocate 1GB for offline caching
    config.security_params = { local_access_only: false, websecurity: false }
    
    ' Launch browser
    html = CreateObject("roHtmlWidget", rect, config)
    html.Show()
    
    ' Main message loop
    port = CreateObject("roMessagePort")
    html.SetPort(port)
    
    while true
        msg = wait(0, port)
    end while
End Sub`

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-txt-primary">Media Player Setup</h1>
          <p className="text-txt-secondary text-sm mt-0.5">
            Configure and connect your hardware displays to the Open Source Signage network.
          </p>
        </div>

        {/* Player Type Switcher */}
        <div className="flex bg-card border border-border/80 p-1 rounded-xl self-start sm:self-center">
          <button
            onClick={() => setDeviceTab('rpi')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              deviceTab === 'rpi'
                ? 'bg-teal text-white shadow-sm'
                : 'text-txt-secondary hover:text-txt-primary'
            }`}
          >
            🍓 Raspberry Pi
          </button>
          <button
            onClick={() => setDeviceTab('brightsign')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              deviceTab === 'brightsign'
                ? 'bg-teal text-white shadow-sm'
                : 'text-txt-secondary hover:text-txt-primary'
            }`}
          >
            ⚡ BrightSign
          </button>
        </div>
      </div>

      {/* ────────────────── RASPBERRY PI SETUP GUIDE ────────────────── */}
      {deviceTab === 'rpi' && (
        <>
          {/* Hardware Matrix Card */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-txt-primary">Supported Pi Models & Features</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-txt-secondary font-medium">
                    <th className="py-2 pr-4">Pi Model</th>
                    <th className="py-2 px-4">Architecture</th>
                    <th className="py-2 px-4 text-center">Chromium Web Pages</th>
                    <th className="py-2 px-4 text-center">VLC Videos</th>
                    <th className="py-2 pl-4">Graphics Engine</th>
                  </tr>
                </thead>
                <tbody className="text-txt-secondary divide-y divide-border/30">
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Pi Zero W</td>
                    <td className="py-2.5 px-4 font-mono">ARMv6 (32-bit)</td>
                    <td className="py-2.5 px-4 text-center text-coral">✗ Not Supported</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full Hardware</td>
                    <td className="py-2.5 pl-4">Lightweight FB (`feh` images only)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Pi Zero 2 W</td>
                    <td className="py-2.5 px-4 font-mono">ARMv7 (32-bit)</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Supported</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full Hardware</td>
                    <td className="py-2.5 pl-4">Full X11 + Matchbox WM</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Pi 3B / 3B+</td>
                    <td className="py-2.5 px-4 font-mono">ARMv7/8 (32/64-bit)</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Supported</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full Hardware</td>
                    <td className="py-2.5 pl-4">Full X11 + Matchbox WM</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Pi 4 / 5</td>
                    <td className="py-2.5 px-4 font-mono">ARM64 (64-bit)</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Supported</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full Hardware</td>
                    <td className="py-2.5 pl-4">Full X11 + Matchbox WM (Best perf)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Main Steps */}
          <div className="space-y-6">
            {/* Prerequisite: SSH and WiFi Key */}
            <div className="card space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">0</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary">Prerequisite: Setup SSH & WiFi credentials</h3>
                  <p className="text-txt-secondary text-xs">
                    Before writing the OS to the SD card, you need an SSH keypair on your computer to secure the connection to the Pi.
                  </p>
                </div>
              </div>

              {/* OS Switcher Tabs */}
              <div className="flex border-b border-border">
                <button
                  onClick={() => setOsTab('mac')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                    osTab === 'mac' ? 'border-teal text-teal' : 'border-transparent text-txt-secondary hover:text-txt-primary'
                  }`}
                >
                  macOS / Linux
                </button>
                <button
                  onClick={() => setOsTab('windows')}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                    osTab === 'windows' ? 'border-teal text-teal' : 'border-transparent text-txt-secondary hover:text-txt-primary'
                  }`}
                >
                  Windows
                </button>
              </div>

              {osTab === 'mac' ? (
                <div className="space-y-3 text-xs">
                  <p className="text-txt-secondary">
                    1. Open the <strong>Terminal</strong> app on your Mac and generate an SSH key:
                  </p>
                  <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                    <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">{sshGenMac}</span>
                    <button onClick={() => copy(sshGenMac, 'sshgenmac')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                      {copiedId === 'sshgenmac' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-txt-secondary">
                    2. Display and copy your public SSH key:
                  </p>
                  <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                    <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">{sshReadMac}</span>
                    <button onClick={() => copy(sshReadMac, 'sshreadmac')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                      {copiedId === 'sshreadmac' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <p className="text-txt-secondary">
                    1. Open <strong>PowerShell</strong> or <strong>Command Prompt</strong> and generate an SSH key:
                  </p>
                  <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                    <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">{sshGenWin}</span>
                    <button onClick={() => copy(sshGenWin, 'sshgenwin')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                      {copiedId === 'sshgenwin' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-txt-secondary">
                    2. Display and copy your public SSH key:
                  </p>
                  <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                    <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">{sshReadWin}</span>
                    <button onClick={() => copy(sshReadWin, 'sshreadwin')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                      {copiedId === 'sshreadwin' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              <div className="text-[11px] text-txt-secondary border-t border-border/30 pt-3 space-y-1">
                <p className="font-semibold text-txt-primary">Wi-Fi Notes:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><strong>Raspberry Pi Zero W</strong> only supports 2.4GHz Wi-Fi networks. Make sure you don't connect it to a 5GHz network.</li>
                  <li>Make sure your computer and the Pi are on networks that can communicate with each other if you plan to SSH locally.</li>
                </ul>
              </div>
            </div>

            {/* Step 1: Flash */}
            <div className="card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">1</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary">Flash Raspberry Pi OS</h3>
                  <p className="text-txt-secondary text-xs">
                    Download and open the **Raspberry Pi Imager** on your computer.
                  </p>
                </div>
              </div>
              <div className="pl-9 text-xs text-txt-secondary space-y-2">
                <p>
                  1. **Select Device**: Choose your Raspberry Pi model.
                </p>
                <p>
                  2. **Select OS**: Under *Raspberry Pi OS (other)*, choose:
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    <li><strong>Pi Zero W</strong>: Raspberry Pi OS Lite (Legacy, 32-bit) — Bullseye</li>
                    <li><strong>Other models</strong>: Raspberry Pi OS Lite (32-bit or 64-bit) — Bookworm</li>
                  </ul>
                </p>
                <p>
                  3. **OS Customization (Gear Icon ⚙️)**: Before clicking *Write*:
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    <li>Check **Enable SSH** and select *Allow public-key authentication only*.</li>
                    <li>Paste the public key you generated in **Step 0**.</li>
                    <li>Set a username (e.g., `alykhan`) and password.</li>
                    <li>Configure your wireless LAN SSID and password.</li>
                  </ul>
                </p>
              </div>
            </div>

            {/* Step 2: Add Device */}
            <div className="card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">2</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary">Register the Device in Dashboard</h3>
                  <p className="text-txt-secondary text-xs">
                    Get a registration token to link your physical player to your account.
                  </p>
                </div>
              </div>
              <div className="pl-9 text-xs text-txt-secondary">
                <p>
                  Go to the **Devices** page in this dashboard, click **Add device**, enter a name and location, and copy the generated registration key (e.g., <code className="text-teal font-mono">cmqpia57p...</code>).
                </p>
              </div>
            </div>

            {/* Step 3: Installer */}
            <div className="card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">3</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary">Run the Installer on the Pi</h3>
                  <p className="text-txt-secondary text-xs">
                    Connect to the Pi and run the automated installation script.
                  </p>
                </div>
              </div>
              <div className="pl-9 text-xs text-txt-secondary space-y-3">
                <p>
                  1. **Connect via SSH**: Open Terminal/PowerShell and connect to your Pi (replace `alykhan` and `signage-lobby.local` with your settings):
                </p>
                <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                  <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">ssh alykhan@signage-lobby.local</span>
                  <button onClick={() => copy('ssh alykhan@signage-lobby.local', 'sshconnect')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                    {copiedId === 'sshconnect' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p>
                  2. **Run Installer Command**: Once logged in to the Pi, copy, paste, and run this command (replace <code className="text-teal font-mono">YOUR_REGISTRATION_KEY</code> with the key from Step 2):
                </p>
                <div className="flex items-start justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary gap-4">
                  <pre className="overflow-x-auto scrollbar-thin select-all text-left text-txt-primary flex-1">{installCmd}</pre>
                  <button onClick={() => copy(installCmd, 'installcmd')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0 self-center">
                    {copiedId === 'installcmd' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 4: Verify */}
            <div className="card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">4</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary">Verify Installation</h3>
                  <p className="text-txt-secondary text-xs">
                    Ensure the signage daemon is running and reports no errors.
                  </p>
                </div>
              </div>
              <div className="pl-9 text-xs text-txt-secondary space-y-3">
                <p>
                  Check the service status to verify it's running:
                </p>
                <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                  <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">systemctl status signage</span>
                  <button onClick={() => copy('systemctl status signage', 'statuscmd')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                    {copiedId === 'statuscmd' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p>
                  Or stream logs in real-time:
                </p>
                <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                  <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">journalctl -fu signage</span>
                  <button onClick={() => copy('journalctl -fu signage', 'logscmd')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                    {copiedId === 'logscmd' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p>
                  Within 30 seconds, the device will show up as <strong className="text-teal">Online</strong> on the **Devices** page.
                </p>
              </div>
            </div>

            {/* Troubleshooting Section */}
            <div className="card space-y-4 border-coral/30 bg-coral-glow/5">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-coral flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h2 className="text-sm font-semibold text-txt-primary">Troubleshooting (Raspberry Pi)</h2>
              </div>

              <div className="space-y-4 text-xs text-txt-secondary">
                <div className="space-y-1">
                  <h4 className="font-semibold text-txt-primary">📺 Screen remains black after booting (No signal)</h4>
                  <p>
                    First check physical HDMI inputs, power, and cables. Micro-HDMI cables can sit loosely; make sure they are pushed in completely.
                  </p>
                  <p className="mt-1">
                    If the dashboard shows screenshots but the TV itself is black, it's usually an HDMI resolution/handshake issue. Connect to the Pi via SSH and run:
                  </p>
                  <pre className="bg-surface border border-border rounded-lg p-2.5 font-mono text-[11px] text-txt-primary mt-1">
                    sudo nano /boot/firmware/config.txt
                  </pre>
                  <p className="mt-1">
                    Make the following adjustments:
                  </p>
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>Change full KMS (<code className="font-mono text-coral bg-coral-glow/30 px-1 rounded text-[10px]">dtoverlay=vc4-kms-v3d</code>) to Fake KMS (<code className="font-mono text-teal bg-teal-glow/30 px-1 rounded text-[10px]">dtoverlay=vc4-fkms-v3d</code>) for better compatibility on older/low-spec TVs.</li>
                    <li>Add <code className="font-mono text-txt-primary">hdmi_force_hotplug=1</code> and <code className="font-mono text-txt-primary">hdmi_drive=2</code> to force HDMI transmission.</li>
                    <li>Comment out <code className="font-mono text-txt-primary">#disable_fw_kms_setup=1</code> to let firmware manage handshake.</li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <h4 className="font-semibold text-txt-primary">🔌 Cannot connect to the Pi via SSH (Host not found)</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Windows does not always support local hostname resolution (<code className="font-mono">.local</code>) out of the box. Ensure iTunes/Bonjour is installed, or use the Pi's exact IP address directly (e.g., <code className="font-mono">ssh alykhan@192.168.1.140</code>).</li>
                    <li>To find the Pi's IP address: check your router's connected client/DHCP table, or use a tool like <strong>Advanced IP Scanner</strong> or <strong>Angry IP Scanner</strong> to search the network for devices named similar to your hostname.</li>
                    <li>Double check that the Pi is actually turned on, wireless LAN details were typed correctly in Imager, and the Wi-Fi network uses 2.4GHz if using a Pi Zero W.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ────────────────── BRIGHTSIGN SETUP GUIDE ────────────────── */}
      {deviceTab === 'brightsign' && (
        <>
          {/* Hardware Matrix Card */}
          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-txt-primary">Supported BrightSign Models & Features</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-txt-secondary font-medium">
                    <th className="py-2 pr-4">BrightSign Series</th>
                    <th className="py-2 px-4">Compatible Models</th>
                    <th className="py-2 px-4 text-center">HTML5 WebGL</th>
                    <th className="py-2 px-4 text-center">Hardware H.265</th>
                    <th className="py-2 pl-4">Local Storage Caching</th>
                  </tr>
                </thead>
                <tbody className="text-txt-secondary divide-y divide-border/30">
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Series 5</td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">XC2003, XC4003, XT1145, XD235, HD225, LS425</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full (Chromium 87+)</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Dual 4K Decoding</td>
                    <td className="py-2.5 pl-4 text-teal">✓ Supported (SD/Class 10)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Series 4</td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">XT1144, XD234, HD224, LS424</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Supported</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full Hardware</td>
                    <td className="py-2.5 pl-4 text-teal">✓ Supported (SD/Class 10)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-txt-primary">Series 3 (Legacy)</td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">XT1143, XD233, HD223</td>
                    <td className="py-2.5 px-4 text-center text-amber">✓ Limited (Chromium 44)</td>
                    <td className="py-2.5 px-4 text-center text-teal">✓ Full Hardware</td>
                    <td className="py-2.5 pl-4 text-teal">✓ Supported (SD/Class 10)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-6">
            {/* Method 1: SD Card Boot */}
            <div className="card space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">1</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary font-sans">Method A: Standalone SD Card Boot (Fastest)</h3>
                  <p className="text-txt-secondary text-xs leading-relaxed">
                    Set up the player using an SD card. It will automatically load the player, enable caching, and display the pairing code on boot.
                  </p>
                </div>
              </div>

              <div className="pl-9 text-xs text-txt-secondary space-y-3.5">
                <p>
                  1. Format a high-speed MicroSD card (Class 10 recommended) as <strong>FAT32</strong> or <strong>exFAT</strong>.
                </p>
                <p>
                  2. Create a new text file on the root of the SD card and name it precisely: <code className="text-txt-primary font-mono bg-border/40 px-1.5 py-0.5 rounded border border-border">autorun.brs</code>.
                </p>
                <p>
                  3. Copy and paste the pre-configured script below into your <code className="font-mono text-txt-primary">autorun.brs</code> file (this script is already configured with your server's player URL):
                </p>

                <div className="flex items-start justify-between bg-surface border border-border rounded-xl p-4 font-mono text-txt-primary gap-4">
                  <pre className="overflow-x-auto scrollbar-thin select-all text-left text-[11px] leading-normal flex-1 max-h-80">{brightsignAutorun}</pre>
                  <button onClick={() => copy(brightsignAutorun, 'bsautorun')} className="text-xs text-teal hover:underline font-semibold flex-shrink-0 self-start mt-1">
                    {copiedId === 'bsautorun' ? 'Copied!' : 'Copy Script'}
                  </button>
                </div>

                <p>
                  4. Insert the SD card into the BrightSign player, connect it to your TV and network, and power it on.
                </p>
                <p>
                  5. Within a few seconds, the screen will display a **Pairing Code** (e.g., <code className="text-teal font-mono">D8A9</code>). Go to the **Devices** page in this dashboard, click **+ Add Screen**, and pair it!
                </p>
              </div>
            </div>

            {/* Method 2: BrightAuthor:connected */}
            <div className="card space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-glow border border-teal/20 text-teal flex items-center justify-center font-mono text-xs font-semibold">2</span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-txt-primary font-sans">Method B: Deploy via BrightAuthor:connected</h3>
                  <p className="text-txt-secondary text-xs leading-relaxed">
                    Deploy the player as an HTML5 widget within a managed presentation.
                  </p>
                </div>
              </div>

              <div className="pl-9 text-xs text-txt-secondary space-y-3">
                <p>
                  1. Open <strong>BrightAuthor:connected</strong> and create a new presentation. Set the resolution to match your screen (e.g., 1920x1080) and choose Landscape or Portrait.
                </p>
                <p>
                  2. Drag an <strong>HTML5 Site</strong> widget from the widgets panel into your presentation zone.
                </p>
                <p>
                  3. In the widget properties panel, set the URL to:
                </p>
                <div className="flex items-center justify-between bg-surface border border-border rounded-lg p-3 font-mono text-txt-primary">
                  <span className="overflow-x-auto whitespace-nowrap scrollbar-thin select-all pr-4">{playerUrl}</span>
                  <button onClick={() => copy(playerUrl, 'bsurl')} className="text-txt-secondary hover:text-teal transition-colors flex-shrink-0">
                    {copiedId === 'bsurl' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p>
                  4. <strong>Critical Settings</strong>: In the HTML5 properties, ensure the following are checked:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Enable JavaScript</strong>: Checked</li>
                  <li><strong>Enable Local Storage</strong> / <strong>Web Databases</strong>: Checked (required to persist the pairing key).</li>
                  <li><strong>Storage Path</strong>: Set to <code className="font-mono text-txt-primary">SD:</code></li>
                  <li><strong>Storage Quota</strong>: Set to at least <code className="font-mono text-txt-primary">1024 MB</code> (1 GB) to support offline caching.</li>
                </ul>
                <p className="mt-1 text-txt-muted">
                  5. Publish the presentation to your player via local network, SD Card, or BrightSign BSN.cloud.
                </p>
              </div>
            </div>

            {/* Troubleshooting Section */}
            <div className="card space-y-4 border-coral/30 bg-coral-glow/5">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-coral flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h2 className="text-sm font-semibold text-txt-primary">Troubleshooting (BrightSign)</h2>
              </div>

              <div className="space-y-4 text-xs text-txt-secondary">
                <div className="space-y-1">
                  <h4 className="font-semibold text-txt-primary">🔑 The screen shows a new pairing code every time it reboots</h4>
                  <p>
                    This happens because the player cannot save the registration key to the SD card.
                  </p>
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>Verify the SD card is not write-protected (check the physical lock switch on the side of the card).</li>
                    <li>Ensure <strong>Enable Local Storage</strong> is checked in your HTML5 site properties in BrightAuthor, and the storage path is set to <code className="font-mono text-txt-primary">SD:</code>. If using the <code className="font-mono">autorun.brs</code> method, verify that the card has not been formatted to NTFS (use FAT32 or exFAT).</li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <h4 className="font-semibold text-txt-primary">⚪ Screen is blank or shows a white screen</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Verify the player is connected to the internet. Check the Ethernet link light or Wi-Fi status on the player.</li>
                    <li>Ensure the URL is spelled correctly and starts with <code className="font-mono text-txt-primary">http://</code> or <code className="font-mono text-txt-primary">https://</code>.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
