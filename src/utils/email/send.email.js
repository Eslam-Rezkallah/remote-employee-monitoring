import nodemailer from "nodemailer";

// ── Email provider selection ───────────────────────────────────
// BREVO_API_KEY   → use Brevo HTTP API (works on Railway, no domain needed)
// RESEND_API_KEY  → use Resend HTTP API (requires verified domain)
// Fallback        → Gmail SMTP (works locally, blocked on Railway)

export const sendEmail = async ({
  to = "",
  cc = "",
  bcc = "",
  subject = "REM",
  text = "",
  html = "",
  attachments = [],
} = {}) => {

  if (process.env.BREVO_API_KEY) {
    // ── Brevo (HTTP API — no SMTP, no domain verification needed) ─
    const fromEmail = process.env.BREVO_FROM_EMAIL || process.env.EMAIL || "noreply@example.com";
    const fromName  = process.env.BREVO_FROM_NAME  || "REM";
    const toArr     = to ? (Array.isArray(to) ? to : [to]) : [];

    const body = {
      sender:      { name: fromName, email: fromEmail },
      to:          toArr.map((email) => ({ email })),
      subject,
      htmlContent: html  || undefined,
      textContent: text  || undefined,
    };
    if (cc)  body.cc  = (Array.isArray(cc)  ? cc  : [cc ]).map((e) => ({ email: e }));
    if (bcc) body.bcc = (Array.isArray(bcc) ? bcc : [bcc]).map((e) => ({ email: e }));

    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method:  "POST",
      headers: {
        "api-key":      process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `Brevo error ${resp.status}`);
    }
    return { messageId: "brevo" };
  }

  if (process.env.RESEND_API_KEY) {
    // ── Resend (requires a verified domain at resend.com/domains) ─
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const fromAddr = process.env.RESEND_FROM || `REM <onboarding@resend.dev>`;
    const toArr    = to ? (Array.isArray(to) ? to : [to]) : [];

    const { error } = await resend.emails.send({
      from:    fromAddr,
      to:      toArr,
      cc:      cc  || undefined,
      bcc:     bcc || undefined,
      subject,
      text:    text || undefined,
      html:    html || undefined,
    });

    if (error) throw new Error(error.message);
    return { messageId: "resend" };
  }

  // ── Nodemailer / Gmail fallback (local dev only) ─────────────
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const info = await transporter.sendMail({
    from: `"REM👻" <${process.env.EMAIL}>`,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    attachments,
  });

  return info;
};
