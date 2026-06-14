import nodemailer from "nodemailer";
export const sendEmail = async ({
  to = "",
  cc = "",
  bcc = "",
  subject = "REM",
  text = "",
  html = "",
  attachments = [],
} = {}) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,          // SSL — avoids the port-587 block on Railway
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
