import nodemailer, { Transporter } from "nodemailer";

/**
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE ("true"|"false"), SMTP_USER, SMTP_PASS, MAIL_FROM
 * Optional:
 *   MAIL_REPLY_TO
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("[mailer] Missing SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS env vars");
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === "true", // true -> 465, false -> 587 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
}

export async function verifyMailer(): Promise<void> {
  await getTransporter().verify();
  console.log("[mailer] SMTP connection verified.");
}

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const from = process.env.MAIL_FROM;
  if (!from) {
    console.error("[mailer] MAIL_FROM env var is not set.");
    return false;
  }
  try {
    const info = await getTransporter().sendMail({
      from,
      to,
      replyTo: process.env.MAIL_REPLY_TO,
      subject,
      html,
      text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    });
    console.log(`[mailer] Sent "${subject}" to ${to} (${info.messageId})`);
    return true;
  } catch (error) {
    console.error(`[mailer] Failed to send "${subject}" to ${to}:`, error);
    return false;
  }
}