import crypto from "node:crypto";

const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret) {
  throw new Error(
    "SESSION_SECRET environment variable must be set. " +
    "Generate a strong random value and add it as a secret before starting the server."
  );
}
const SECRET = rawSecret;

/** Tokens expire after 30 days; the client re-logs-in when it gets a 401. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Create an HMAC-signed bearer token encoding the userId and issue time.
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
    const [idPart, tsPart] = payload.split(".");
    const issuedAt = parseInt(tsPart ?? "", 10);
    if (Number.isNaN(issuedAt) || Date.now() - issuedAt > TOKEN_TTL_MS) {
      return null;
    }
    const userId = parseInt(idPart ?? "", 10);
    return Number.isNaN(userId) ? null : userId;
  } catch {
    return null;
  }
}

/**
 * A stable room-share token. The row ID is public, while the HMAC makes the
 * token unforgeable; deleting the row revokes every copy of the link.
 */
export function createRoomShareToken(linkId: number, roomId: number): string {
  const payload = `${linkId}.${roomId}`;
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`room-share-link:${payload}`)
    .digest("base64url");
  return `${linkId}.${signature}`;
}

export function verifyRoomShareToken(
  token: string,
  linkId: number,
  roomId: number,
): boolean {
  try {
    const [tokenId, signature, extra] = token.split(".");
    if (extra !== undefined || Number(tokenId) !== linkId || !signature) {
      return false;
    }
    const provided = Buffer.from(signature, "base64url");
    if (provided.length !== 32) return false;
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(`room-share-link:${linkId}.${roomId}`)
      .digest();
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}
