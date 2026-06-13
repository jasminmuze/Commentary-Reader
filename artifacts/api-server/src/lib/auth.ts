import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-in-prod";

/**
 * Create a short-lived HMAC-signed bearer token encoding the userId.
 * Format (base64url): base64url(`${userId}.${timestamp}.${hmac}`)
 */
export function createToken(userId: number): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

/**
 * Verify a token produced by createToken.
 * Returns the userId on success, null on failure.
 */
export function verifyToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot < 0) return null;
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(payload)
      .digest("hex");
    if (sig.length !== expected.length) return null;
    if (
      !crypto.timingSafeEqual(
        Buffer.from(sig, "hex"),
        Buffer.from(expected, "hex"),
      )
    )
      return null;
    const userId = parseInt(payload.split(".")[0] ?? "", 10);
    return Number.isNaN(userId) ? null : userId;
  } catch {
    return null;
  }
}
