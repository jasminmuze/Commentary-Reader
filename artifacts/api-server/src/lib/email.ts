// Email delivery via the Resend connector (Replit-managed credentials).
// Verification emails are transactional; failures are surfaced to the caller
// so the API can report delivery errors instead of silently dropping them.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

// Resend sandbox sender — works without domain verification.
const FROM = "Shelfmates <onboarding@resend.dev>";

export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<void> {
  const res = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `${code} is your Shelfmates verification code`,
      html: [
        `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F9F6F0;border-radius:12px;">`,
        `<h2 style="color:#B85C38;margin:0 0 8px;">Shelfmates</h2>`,
        `<p style="color:#3E3A33;font-size:15px;">Enter this code to verify your email address:</p>`,
        `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#3E3A33;margin:16px 0;">${code}</p>`,
        `<p style="color:#8A8478;font-size:13px;">This code expires in 24 hours. If you didn't sign up for Shelfmates, you can ignore this email.</p>`,
        `</div>`,
      ].join(""),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: text.slice(0, 300) },
      "Resend email send failed",
    );
    throw new Error(`Email delivery failed (${res.status})`);
  }
}
