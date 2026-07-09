import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/store'

export default function PrivacyPolicy() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const handleBack = () => {
    if (user) {
      navigate('/dashboard')
    } else {
      navigate('/login')
    }
  }

  return (
    <div className="min-h-screen bg-base text-txt-primary flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl w-full bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-txt-primary">Privacy Policy</h1>
            <p className="text-txt-secondary text-xs mt-1">Last Updated: June 27, 2026</p>
          </div>
          <button 
            onClick={handleBack} 
            className="btn-ghost border border-border text-xs px-3 py-1.5 rounded-lg hover:bg-border transition-colors"
          >
            ← {user ? 'Dashboard' : 'Sign In'}
          </button>
        </div>

        <div className="space-y-4 text-sm text-txt-secondary leading-relaxed">
          <p>
            Welcome to the <strong>TableView Media Signage</strong> platform. Your privacy is critically important to us. This Privacy Policy details how we collect, protect, and use data through our signage management web dashboard and connected player displays.
          </p>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-teal pt-2">1. Information We Collect</h2>
          <p>
            We collect minimal information necessary to deliver the signage service effectively:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>User Account Details:</strong> Name, email address, and hashed passwords provided during organization onboarding.</li>
            <li><strong>Display Player Metrics:</strong> Hardware status, diagnostic logs (CPU/RAM/Disk metrics), display resolutions, and uptime logs transmitted by paired Raspberry Pi or browser-based players.</li>
            <li><strong>Broadcast Media Assets:</strong> Video and image files uploaded by authorized members of your organization to be deployed as digital signage playlists.</li>
          </ul>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-teal pt-2">2. How We Use Information</h2>
          <p>
            Your information is utilized solely to:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Authenticate accounts and enforce strict organization database boundaries.</li>
            <li>Maintain real-time WebSocket communication and coordinate playlist content delivery to displays.</li>
            <li>Enable administrators to perform hardware checks, request screen captures, and view terminal diagnostic logs.</li>
          </ul>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-teal pt-2">3. Storage & Security</h2>
          <p>
            All media content, diagnostic records, and account attributes are securely stored inside our database infrastructure. Password hashes are encrypted using strong bcrypt hashing algorithms. Account tokens are signed with cryptographic signatures. Access is strictly scoped to your specific organization.
          </p>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-teal pt-2">4. Third-Party Sharing</h2>
          <p>
            We do not sell, rent, or distribute any user metrics, files, or logs to third-party advertisers or aggregators. Data is shared only with internal services necessary for application hosting and email notifications (such as password reset services).
          </p>

          <h2 className="text-sm font-semibold uppercase tracking-wider text-teal pt-2">5. Updates to This Policy</h2>
          <p>
            We may revise this privacy statement occasionally. Any changes will be published here with an updated "Last Updated" date.
          </p>
        </div>

        <div className="border-t border-border pt-4 text-center">
          <p className="text-[11px] text-txt-muted">
            If you have questions regarding this policy, please reach out to support@your-domain.com.
          </p>
        </div>
      </div>
    </div>
  )
}
