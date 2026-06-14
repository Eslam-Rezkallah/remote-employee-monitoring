import nodemailer from "nodemailer";

// ── Email provider selection ───────────────────────────────────
// RESEND_API_KEY  → use Resend (HTTP API, works on Railway/Docker)
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
  if (process.env.RESEND_API_KEY) {
    // ── Resend (recommended for production on Railway) ─────────
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const fromAddr = process.env.RESEND_FROM || `REM <onboarding@resend.dev>`;
    const toArr    = to ? (Array.isArray(to) ? to : [to]) : [];

    const { error } = await resend.emails.send({
      from:    fromAddr,
      to:      toArr,
      cc:      cc || undefined,
      bcc:     bcc || undefined,
      subject,
      text:    text || undefined,
      html:    html || undefined,
    });

    if (error) throw new Error(error.message);
    return { messageId: "resend" };
  }

  // ── Nodemailer / Gmail fallback (local dev) ─────────────────
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
