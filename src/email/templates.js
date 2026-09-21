// src/email/templates.js — HTML email templates

const APP_URL = process.env.APP_URL || "http://localhost:5173";

function welcomeEmail({ orgName, adminEmail, tempPassword, role }) {
  const subject = `Your ${orgName} workspace is ready — ChiefXAI`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:linear-gradient(135deg,#f59e0b,#d97706);padding:36px 40px;text-align:center}
    .logo{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;background:rgba(255,255,255,.2);border-radius:14px;margin-bottom:12px}
    .header h1{margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.3px}
    .header p{margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px}
    .body{padding:36px 40px}
    .body p{margin:0 0 16px;color:#374151;font-size:14px;line-height:1.7}
    .creds-box{background:#fafafa;border:1.5px solid #e5e7eb;border-radius:14px;overflow:hidden;margin:24px 0}
    .creds-header{background:#f3f4f6;padding:10px 20px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.8px}
    .cred-row{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid #e5e7eb}
    .cred-label{font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.4px;min-width:80px}
    .cred-value{font-size:14px;color:#111827;font-weight:600;font-family:'Courier New',monospace;background:#f3f4f6;padding:4px 10px;border-radius:6px;word-break:break-all}
    .divider{display:flex;align-items:center;gap:12px;margin:28px 0;color:#9ca3af;font-size:12px}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:#e5e7eb}
    .btn-primary{display:block;text-align:center;background:#f59e0b;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:15px 28px;border-radius:12px;letter-spacing:.1px}
    .btn-secondary{display:block;text-align:center;background:#fff;color:#374151;text-decoration:none;font-weight:600;font-size:13px;padding:13px 28px;border-radius:12px;border:1.5px solid #e5e7eb;margin-top:10px}
    .note{margin-top:20px;padding:14px 18px;background:#fefce8;border:1px solid #fde68a;border-radius:10px;font-size:12px;color:#92400e;line-height:1.6}
    .footer{padding:20px 40px;text-align:center;font-size:11px;color:#9ca3af;border-top:1px solid #f1f5f9;line-height:1.6}
  </style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,.3)"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <h1>ChiefXAI</h1>
    <p>Your account for <strong>${orgName}</strong> is ready</p>
  </div>

  <div class="body">
    <p>Hi there,</p>
    <p>Your ${role ? `<strong>${role}</strong> account` : 'account'} has been created on <strong>ChiefXAI</strong>. Below are your login credentials — keep them safe.</p>

    <div class="creds-box">
      <div class="creds-header">Your Login Credentials</div>
      <div class="cred-row">
        <span class="cred-label">Email</span>
        <span class="cred-value">${adminEmail}</span>
      </div>
      <div class="cred-row">
        <span class="cred-label">Password</span>
        <span class="cred-value">${tempPassword}</span>
      </div>
    </div>

    <a href="${APP_URL}" class="btn-primary">Sign In to ChiefXAI →</a>

    <div class="note">
      🔐 Use the credentials above to sign in. You will be prompted to change your password after your first login.
    </div>
  </div>

  <div class="footer">
    ChiefXAI &nbsp;·&nbsp; You received this because an admin created an account for this email address.<br/>
    If you didn't expect this, you can safely ignore it.
  </div>
</div>
</body>
</html>`;

  const text = `Your account for ${orgName} is ready on ChiefXAI.\n\nEmail: ${adminEmail}\nPassword: ${tempPassword}${role ? `\nRole: ${role}` : ''}\n\nSign in at: ${APP_URL}\n\nChange your password after first login.`;

  return { subject, html, text };
}

// Keep backward-compatible alias
function welcomeOrganization(opts) {
  return welcomeEmail({ ...opts, role: 'Organization Admin' });
}

module.exports = { welcomeEmail, welcomeOrganization };
