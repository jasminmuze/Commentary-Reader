// Email delivery via the Resend API using a Replit Secret.
// Verification emails are transactional; failures are surfaced to the caller
// so the API can report delivery errors instead of silently dropping them.
import { Resend } from "resend";
import { logger } from "./logger";

// The sender must belong to a domain verified in the connected Resend account.
// Do not fall back to the Resend sandbox address: it cannot reach ordinary users.
function getFromAddress(): string {
  const email = process.env.RESEND_FROM_EMAIL?.trim();
  if (!email || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) || email.toLowerCase().endsWith("@resend.dev")) {
    throw new Error("RESEND_FROM_EMAIL must be an address on a verified Resend sending domain");
  }
  return `Shelfmates <${email}>`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  failureMessage: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: getFromAddress(),
    to,
    subject,
    html,
  });
  if (error) {
    logger.error(
      { statusCode: error.statusCode, name: error.name, message: error.message },
      failureMessage,
    );
    throw new Error(`Email delivery failed (${error.statusCode ?? "unknown"})`);
  }
}

export async function sendPasswordResetEmail(
  to: string,
  code: string,
): Promise<void> {
  await sendEmail(
    to,
    `${code} is your Shelfmates password reset code`,
    [
      `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F9F6F0;border-radius:12px;">`,
      `<h2 style="color:#B85C38;margin:0 0 8px;">Shelfmates</h2>`,
      `<p style="color:#3E3A33;font-size:15px;">Enter this code to reset your password:</p>`,
      `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#3E3A33;margin:16px 0;">${code}</p>`,
      `<p style="color:#8A8478;font-size:13px;">This code expires in 1 hour. If you didn't request a password reset, you can ignore this email — your password has not been changed.</p>`,
      `</div>`,
    ].join(""),
    "Resend password reset email send failed",
  );
}

export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<void> {
  await sendEmail(
    to,
    `${code} is your Shelfmates verification code`,
    [
      `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F9F6F0;border-radius:12px;">`,
      `<h2 style="color:#B85C38;margin:0 0 8px;">Shelfmates</h2>`,
      `<p style="color:#3E3A33;font-size:15px;">Enter this code to verify your email address:</p>`,
      `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#3E3A33;margin:16px 0;">${code}</p>`,
      `<p style="color:#8A8478;font-size:13px;">This code expires in 24 hours. If you didn't sign up for Shelfmates, you can ignore this email.</p>`,
      `</div>`,
    ].join(""),
    "Resend verification email send failed",
  );
}
