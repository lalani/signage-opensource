import { useAuth } from '../lib/store'

interface WalkthroughStep {
  title: string
  steps: string[]
  tip?: string
}

interface RoleGuideContent {
  roleName: string
  description: string
  features: { name: string; desc: string; icon: string }[]
  walkthroughs: WalkthroughStep[]
  examples: { scenario: string; setup: string }[]
}

const GUIDES_BY_ROLE: Record<string, RoleGuideContent> = {
  SUPER_ADMIN: {
    roleName: 'Super Admin',
    description: 'You have full global control over all organizations, teams, limits, and system settings.',
    features: [
      { name: 'Organization Management', desc: 'Create new teams/organizations and monitor their resource utilization.', icon: '🏢' },
      { name: 'Device Quota Control', desc: 'Set the maximum number of registered screens allowed per team.', icon: '📊' },
      { name: 'Global Settings', desc: 'Access all screens, playlists, content, and users across every team.', icon: '⚙️' }
    ],
    walkthroughs: [
      {
        title: 'Adjusting Device Quotas for an Organization',
        steps: [
          'Navigate to the Settings page in the sidebar.',
          'Under the Organizations section, locate the target team.',
          'Double-click or click the edit icon in the "Max Devices" column.',
          'Enter the new limit (e.g., 5) and click Save or press Enter.',
          'The team will now be restricted to this new quota when pairing displays.'
        ],
        tip: 'By default, newly created organizations are limited to 1 device.'
      },
      {
        title: 'Reassigning a Display to a Different Team',
        steps: [
          'Go to the Devices page.',
          'Locate the display card you want to move.',
          'In the metadata line, click the Org: dropdown (only visible to Super Admins).',
          'Select the new target organization from the list.',
          'Confirm the action. Note: This will clear the screen\'s current schedules, playlists, and viewer restrictions.'
        ],
        tip: 'Moving a device is useful when re-provisioning hardware for a different client.'
      }
    ],
    examples: [
      {
        scenario: 'Onboarding a new franchise partner',
        setup: 'Create a new Team under Settings, set their device quota to 3, create a Team Admin account for the franchisee, and hand off the login credentials.'
      }
    ]
  },
  TEAM_ADMIN: {
    roleName: 'Team Admin',
    description: 'You manage your organization\'s screens, users, weekly schedules, and multi-screen video walls.',
    features: [
      { name: 'Device Management', desc: 'Pair new Raspberry Pi players, monitor health, and trigger remote commands.', icon: '🖥️' },
      { name: 'Schedules', desc: 'Set up time-of-day or day-of-week rules to automatically change playlists.', icon: '📅' },
      { name: 'User Management', desc: 'Invite team members and assign them roles (Content Creator, Viewer).', icon: '👤' },
      { name: 'Screen Grids', desc: 'Group multiple screens together to form synchronized video walls.', icon: '🧱' }
    ],
    walkthroughs: [
      {
        title: 'Pairing and Registering a New Screen',
        steps: [
          'Assemble your Raspberry Pi and connect it to a display.',
          'Run the installation command from the Kiosk Setup page on the Pi.',
          'Once the Pi boots up, it will display a 4-character pairing code (e.g., "AB12").',
          'In your dashboard, go to the Devices page and click "+ Add Screen".',
          'Select "Web Pairing Code", enter a name, location, and the code shown on the screen.',
          'Click Pair & Register. The screen will immediately pair and show your organization\'s splash screen.'
        ],
        tip: 'Make sure the Raspberry Pi is connected to the internet before attempting to pair.'
      },
      {
        title: 'Creating a Synchronized Menu Board Grid',
        steps: [
          'Go to the Grids page in the sidebar and click "Create Grid".',
          'Name the grid (e.g., "Main Menu Board") and set the layout (e.g., 1 row, 3 columns).',
          'Assign your registered screens to the grid positions: Col 1 (Left), Col 2 (Middle), Col 3 (Right).',
          'Go to the Devices page, click the "Groups" tab, and select a playlist to deploy to the entire grid at once.'
        ],
        tip: 'Grids are perfect for coffee shops and fast-food restaurants with adjacent menu displays.'
      },
      {
        title: 'Scheduling a Lunch Menu Playlist',
        steps: [
          'Go to the Schedules page and click "Add Schedule".',
          'Select your "Lunch Menu" playlist.',
          'Set the Start Time to 11:00 AM and End Time to 3:00 PM.',
          'Select the days of the week (e.g., Monday through Friday).',
          'Choose the target screens or screen groups, and click Save.',
          'The screens will automatically transition to the Lunch Menu at 11:00 AM and revert to the default playlist at 3:00 PM.'
        ],
        tip: 'Set a higher priority on holiday or special event schedules so they override daily schedules automatically.'
      }
    ],
    examples: [
      {
        scenario: 'Adding a new menu designer to the team',
        setup: 'Go to the Users page, click Invite User, enter their email, and set their role to Content Creator so they can build playlists without having access to delete screens.'
      }
    ]
  },
  CONTENT_CREATOR: {
    roleName: 'Content Creator',
    description: 'You are responsible for uploading media assets, managing Canva/Google Slides links, building playlists, and deploying overlay widgets.',
    features: [
      { name: 'Content Library', desc: 'Upload images, videos, and register external Canva/Google Slides presentations.', icon: '📁' },
      { name: 'Playlist Builder', desc: 'Create content loops, arrange item order, and set slide durations.', icon: '🎞️' },
      { name: 'Overlay Widgets', desc: 'Configure digital clocks, weather cards, and scrolling tickers on top of playlists.', icon: '✨' }
    ],
    walkthroughs: [
      {
        title: 'Adding a Canva or Google Slides Presentation',
        steps: [
          'In Canva or Google Slides, click "Share" -> "Publish to Web" (or Embed).',
          'Copy the public link/URL.',
          'Go to the Content page in your dashboard and click "Add Canva / Google Slides".',
          'Enter a name and paste the URL. Click Save.',
          'Now, add this item to any playlist. Any changes you make in Canva or Google Slides will automatically sync to your screens without needing a manual re-upload.'
        ],
        tip: 'Ensure the Canva or Google Slides link is set to public so the media players can access it.'
      },
      {
        title: 'Deploying a Scrolling Announcement Ticker',
        steps: [
          'Go to the Widgets page in the sidebar.',
          'Click "+ Create Widget".',
          'Set the type to "Text Ticker" and position to "Bottom Bar (Full Width)".',
          'Enter your message (e.g., "Welcome to TableView! Check out our new winter specials.").',
          'Customize the background color (e.g., semi-transparent black `rgba(0,0,0,0.6)`), font size, and text color.',
          'On the right panel, check the boxes for all the screens you want this ticker to appear on.',
          'Click Create Widget. The ticker will immediately begin scrolling across the bottom of the selected screens.'
        ],
        tip: 'Set the scroll speed between 12 and 18 seconds for optimal readability.'
      },
      {
        title: 'Building and Arranging a Playlist Loop',
        steps: [
          'Go to the Playlists page and click "+ New Playlist".',
          'Name the playlist and click "Add Items".',
          'Select assets from your Content Library.',
          'Drag and drop the items in the list to change their playback order.',
          'Double-click the duration field of any image or web item to change its display time (in seconds).',
          'Click Save. Screens playing this playlist will update instantly.'
        ],
        tip: 'Videos will always play to completion before moving to the next item; their duration is set automatically.'
      }
    ],
    examples: [
      {
        scenario: 'Announcing a store-wide sale',
        setup: 'Create a "Text Ticker" widget with the sale details, set the position to Bottom Bar, and select all screens. The announcement will overlay on top of your existing playlists instantly.'
      }
    ]
  },
  VIEWER: {
    roleName: 'Viewer',
    description: 'You have read-only access to monitor displays, view screenshots, and check screen performance.',
    features: [
      { name: 'Live Monitoring', desc: 'Inspect screen status, uptime, network status, and hardware vitals.', icon: '📈' },
      { name: 'Screenshot Captures', desc: 'Request and view live screenshots from active Raspberry Pi players.', icon: '📷' },
      { name: 'Playlists & Schedules View', desc: 'Browse active playlists and weekly schedules.', icon: '🔍' }
    ],
    walkthroughs: [
      {
        title: 'Checking if a Display is Online and Healthy',
        steps: [
          'Go to the Dashboard page to see an overview of all screens.',
          'Online screens will show a green dot next to their name; offline screens will show a red dot.',
          'Click "Detailed View" at the top of the page to reveal CPU usage, memory usage, disk space, and CPU temperature graphs.',
          'If a screen is running hot (above 75°C) or has high memory usage, notify your Team Administrator.'
        ],
        tip: 'The dashboard metrics refresh automatically every 15 seconds.'
      },
      {
        title: 'Verifying What is Displaying on a Physical Screen',
        steps: [
          'Go to the Devices page.',
          'Locate the target display card.',
          'Click the "📷 Screenshot" button. The server will request the Raspberry Pi to capture its current frame.',
          'Within a few seconds, the thumbnail on the card will update to show the live display capture.',
          'Click the thumbnail to enlarge the screenshot and verify the content.'
        ],
        tip: 'Screenshots can be captured even if the device is currently playing an external Canva or Google Slides presentation.'
      }
    ],
    examples: [
      {
        scenario: 'Troubleshooting a blank display',
        setup: 'Check the dashboard to see if the device is Online. If online, click "Screenshot" to see if the player is rendering content. If the screenshot is correct but the TV is blank, the issue is likely the HDMI cable or TV power.'
      }
    ]
  }
}

export default function Guide() {
  const { user } = useAuth()
  const role = user?.role || 'VIEWER'
  const guide = GUIDES_BY_ROLE[role] || GUIDES_BY_ROLE.VIEWER

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-txt-primary">{guide.roleName} User Guide</h1>
          <p className="text-xs text-txt-secondary mt-1">{guide.description}</p>
        </div>
        <div className="bg-base border border-border px-4 py-2.5 rounded-xl flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-teal animate-pulse" />
          <div className="text-xs">
            <span className="text-txt-muted">Logged in as: </span>
            <span className="font-semibold text-txt-primary">{guide.roleName}</span>
          </div>
        </div>
      </div>

      {/* Grid of Key Features */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-txt-primary uppercase tracking-wider">Key Features Available To You</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {guide.features.map((f, i) => (
            <div key={i} className="card p-4 space-y-2.5 hover:border-border-hover transition-colors">
              <span className="text-2xl block">{f.icon}</span>
              <h3 className="font-semibold text-sm text-txt-primary">{f.name}</h3>
              <p className="text-xs text-txt-secondary leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Walkthroughs Section */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-txt-primary uppercase tracking-wider">Step-by-Step Walkthroughs</h2>
        <div className="space-y-4">
          {guide.walkthroughs.map((w, i) => (
            <div key={i} className="card p-6 space-y-4">
              <h3 className="font-semibold text-sm text-txt-primary flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-teal/10 border border-teal/20 text-teal flex items-center justify-center text-xs font-mono">{i + 1}</span>
                {w.title}
              </h3>
              <ol className="space-y-2.5 pl-7 list-decimal text-xs text-txt-secondary leading-relaxed">
                {w.steps.map((step, idx) => (
                  <li key={idx} className="pl-1">{step}</li>
                ))}
              </ol>
              {w.tip && (
                <div className="mt-3 p-3 bg-teal-glow/5 border border-teal/10 rounded-xl flex items-start gap-2.5">
                  <span className="text-xs">💡</span>
                  <p className="text-[11px] text-txt-secondary leading-normal"><span className="font-semibold text-teal">Tip:</span> {w.tip}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Real-world Examples */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-txt-primary uppercase tracking-wider font-sans">Common Workflows</h2>
        <div className="space-y-3">
          {guide.examples.map((ex, i) => (
            <div key={i} className="card p-5 space-y-2.5 bg-surface/30">
              <span className="text-xs font-semibold text-teal uppercase tracking-wide">Scenario: {ex.scenario}</span>
              <p className="text-xs text-txt-secondary leading-relaxed">{ex.setup}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
