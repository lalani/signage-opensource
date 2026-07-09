import nodemailer from 'nodemailer'

function getTransporter() {
  const host = process.env.SMTP_HOST
  if (!host) return null
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

export async function sendPasswordReset(to: string, name: string, resetUrl: string) {
  const transporter = getTransporter()
  if (!transporter) {
    // Log the reset URL if email isn't configured (useful for dev/testing)
    console.log(`[email] Password reset for ${to}: ${resetUrl}`)
    return
  }

  const from = process.env.SMTP_FROM || 'Signage <noreply@signage.local>'
  await transporter.sendMail({
    from,
    to,
    subject: 'Reset your Signage password',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:sans-serif;background:#080B14;color:#E8EAF0;padding:40px;margin:0">
        <div style="max-width:480px;margin:0 auto;background:#0F1525;border:1px solid #1E2940;border-radius:16px;padding:32px">
          <div style="margin-bottom:24px">
            <span style="background:#26E4C820;border:1px solid #26E4C830;color:#26E4C8;font-family:monospace;font-size:18px;font-weight:700;padding:8px 14px;border-radius:8px">S</span>
            <span style="font-size:18px;font-weight:600;margin-left:12px">Signage</span>
          </div>
          <h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
          <p style="color:#6B7A99;margin:0 0 24px;line-height:1.6">Hi ${name}, we received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#26E4C8;color:#080B14;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;margin-bottom:24px">Reset password</a>
          <p style="color:#3A4560;font-size:12px;margin:0">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
          <hr style="border:none;border-top:1px solid #1E2940;margin:24px 0"/>
          <p style="color:#3A4560;font-size:11px;margin:0">Or paste this URL: <span style="word-break:break-all;color:#6B7A99">${resetUrl}</span></p>
        </div>
      </body>
      </html>
    `,
  })
}
