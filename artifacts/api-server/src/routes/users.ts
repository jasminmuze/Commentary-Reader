import { Router, type IRouter } from "express";
import { eq, and, or, isNull, lt, like, ilike, inArray, count, desc, max, asc, sql, gt } from "drizzle-orm";
import {
  db,
  usersTable,
  friendshipsTable,
  friendRequestsTable,
  commentsTable,
  commentLikesTable,
  commentSavesTable,
  highlightLikesTable,
  notificationsTable,
  quotesTable,
  userHighlightsTable,
  userLibraryTable,
  pushTokensTable,
  feedbackTable,
  accountDeletionFeedbackTable,
  booksTable,
  readingRoomsTable,
  roomMembersTable,
  roomInvitesTable,
  userObjectUploadsTable,
  accountObjectCleanupJobsTable,
} from "@workspace/db";
import {
  CreateUserBody,
  DeleteUserAccountParams,
  DeleteUserAccountBody,
  SendVerificationEmailParams,
  ConfirmEmailVerificationParams,
  ConfirmEmailVerificationBody,
  GetAvatarUploadUrlParams,
  SetAvatarParams,
  SetAvatarBody,
  RemoveAvatarParams,
  GetUserParams,
  GetFriendsParams,
  AddFriendParams,
  AddFriendBody,
  RemoveFriendParams,
  GetSavedCommentsParams,
  SearchUsersQueryParams,
  GetUserProfileParams,
  UpdateUserSettingsParams,
  UpdateUserSettingsBody,
  GetNotificationSettingsParams,
  UpdateNotificationSettingsParams,
  UpdateNotificationSettingsBody,
  GetUserRecordsParams,
  GetUserBookRecordsParams,
  GetUserHighlightsParams,
  GetUserRoomsParams,
  RequestPasswordResetBody,
  ConfirmPasswordResetBody,
} from "@workspace/api-zod";
import type { UserRecordsBook, UserHighlightItem } from "@workspace/api-zod";
import bcrypt from "bcryptjs";
import { createHash, randomInt } from "crypto";
import { LoginUserBody } from "@workspace/api-zod";
import { formatComment } from "../lib/queries";
import { getOwnedBookIds, truncateQuoteText } from "../lib/contentLimits";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email";
import {
  isGeneratedAvatarObjectPath,
  isGeneratedEpubObjectPath,
  ObjectStorageService,
} from "../lib/objectStorage";
import { processAccountObjectCleanupJob } from "../lib/accountObjectCleanup.js";
import { getRoomDeletionDisposition } from "../lib/roomDeletionPolicy.js";
import {
  acquireAccountRequestLocks,
  releaseAccountRequestLocksOnResponse,
} from "../lib/accountRequestLocks.js";
import {
  getViewer,
  isFollowing,
  visibilityPredicate,
} from "../lib/social";
import { createToken } from "../lib/auth.js";
import { authenticate } from "../middlewares/authenticate.js";

const AVATAR_COLORS = [
  "#E8A020", "#4A9EFF", "#FF6B6B", "#7CB9A8", "#C084FC",
  "#FB923C", "#34D399", "#F472B6", "#60A5FA", "#A78BFA",
];

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

// Pre-computed hash of a random value; used to equalize login timing on
// unknown usernames (see /users/login).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("timing-equalizer-dummy", 10);

const VERIFICATION_CODE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const VERIFICATION_RESEND_INTERVAL_MS = 60 * 1000; // 60s between sends

const RESET_CODE_TTL_MS = 60 * 60 * 1000; // 1h
const RESET_RESEND_INTERVAL_MS = 60 * 1000; // 60s between sends

function hashVerificationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

type DbUser = typeof usersTable.$inferSelect;

// Serializes a user row for API responses. Email + verification status are
// self-only (returned as null/false to other viewers).
function formatUser(user: DbUser, opts: { self: boolean; token?: string }) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname ?? null,
    avatarUrl: user.avatarUrl ?? null,
    email: opts.self ? (user.email ?? null) : null,
    emailVerified: opts.self ? user.emailVerifiedAt != null : false,
    avatarColor: user.avatarColor,
    defaultVisibility: user.defaultVisibility,
    createdAt: user.createdAt.toISOString(),
    ...(opts.token ? { token: opts.token } : {}),
  };
}

// Generates + stores a hashed verification code and emails it. The resend
// cooldown is enforced atomically in the UPDATE's WHERE clause so concurrent
// requests can't double-send. Returns "cooldown" if another send happened
// within the resend interval. Throws if the email send fails (caller decides
// how to surface it); on send failure the cooldown is rolled back so the user
// can retry immediately.
async function issueVerificationCode(
  user: DbUser,
  accountRequestLockHeld = false,
): Promise<"sent" | "cooldown"> {
  if (!user.email) throw new Error("No email on account");
  const releaseLocks = accountRequestLockHeld
    ? undefined
    : await acquireAccountRequestLocks(user.id, "shared");
  try {
    const code = generateVerificationCode();
    const cooldownCutoff = new Date(Date.now() - VERIFICATION_RESEND_INTERVAL_MS);
    const claimed = await db
      .update(usersTable)
      .set({
        emailVerificationCodeHash: hashVerificationCode(code),
        emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS),
        emailVerificationSentAt: new Date(),
      })
      .where(
        and(
          eq(usersTable.id, user.id),
          eq(usersTable.deletionPending, false),
          or(
            isNull(usersTable.emailVerificationSentAt),
            lt(usersTable.emailVerificationSentAt, cooldownCutoff),
          ),
        ),
      )
      .returning({ id: usersTable.id });
    if (claimed.length === 0) return "cooldown";
    try {
      await sendVerificationEmail(user.email, code);
    } catch (err) {
      // Roll back the cooldown so a failed send doesn't lock the user out of
      // retrying for the whole interval.
      try {
        await db
          .update(usersTable)
          .set({ emailVerificationSentAt: null })
          .where(eq(usersTable.id, user.id));
      } catch {
        // Best-effort rollback; the original send error is what matters.
      }
      throw err;
    }
    return "sent";
  } finally {
    await releaseLocks?.();
  }
}

const router: IRouter = Router();

router.post("/users", async (req, res): Promise<void> => {
  const body = CreateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const email = body.data.email.trim().toLowerCase();
  const existing = await db.select().from(usersTable).where(eq(usersTable.username, body.data.username));
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }
  const emailTaken = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (emailTaken.length > 0) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(body.data.password, 10);
  const nickname = body.data.nickname?.trim() || null;
  let user: DbUser | undefined;
  try {
    [user] = await db.insert(usersTable).values({
      username: body.data.username,
      email,
      nickname,
      passwordHash,
      avatarColor: randomAvatarColor(),
    }).returning();
  } catch (err: unknown) {
    // Unique-constraint race (username or email inserted concurrently).
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "Username or email already taken" });
      return;
    }
    throw err;
  }

  // Best-effort: kick off the verification email. Signup still succeeds if
  // delivery fails — the user can retry from the verification gate.
  issueVerificationCode(user!).catch((err) => {
    req.log.error({ err }, "Failed to send signup verification email");
  });

  res.json(formatUser(user!, { self: true, token: createToken(user!.id) }));
});

router.post("/users/login", async (req, res): Promise<void> => {
  const body = LoginUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Accept either username (exact) or email (case-insensitive).
  const identifier = body.data.identifier;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      or(
        eq(usersTable.username, identifier),
        eq(usersTable.email, identifier.toLowerCase()),
      ),
    );
  // Accounts without a password hash (legacy/seeded demo users) cannot log in.
  // Always run a bcrypt compare (against a dummy hash on miss) so response
  // timing doesn't reveal whether the username/email exists.
  const hashToCheck = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const compared = await bcrypt.compare(body.data.password, hashToCheck);
  const valid = user?.passwordHash != null && !user.deletionPending && compared;
  if (!user || !valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  let releaseLocks: (() => Promise<void>) | undefined;
  try {
    // Login is public rather than authenticated, so coordinate token issuance
    // explicitly with account deletion and re-read the row under the lock.
    releaseLocks = await acquireAccountRequestLocks(user.id, "shared");
  } catch (err) {
    req.log.error({ err, userId: user.id }, "Could not safely complete login");
    res.status(503).json({ error: "Login could not be safely completed" });
    return;
  }
  if (req.aborted) {
    await releaseLocks();
    return;
  }
  if (!releaseAccountRequestLocksOnResponse(res, releaseLocks, (err) => {
    req.log.error({ err, userId: user!.id }, "Failed to release login account lock");
  })) return;
  const [currentUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  if (!currentUser || currentUser.deletionPending || !currentUser.passwordHash) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const passwordStillMatches = await bcrypt.compare(body.data.password, currentUser.passwordHash);
  if (!passwordStillMatches) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  // Keep login successful if delivery is unavailable. The verification gate
  // remains active and the user can retry with the rate-limited resend action.
  if (!currentUser.emailVerifiedAt && currentUser.email) {
    try {
      await issueVerificationCode(currentUser, true);
    } catch (err) {
      req.log.error({ err, userId: currentUser.id }, "Failed to send login verification email");
    }
  }

  res.json(formatUser(currentUser, { self: true, token: createToken(currentUser.id) }));
});

// Request a password reset code. Unauthenticated — the user forgot their password.
// For security we always return 200 (whether or not the email exists/is verified)
// so callers cannot enumerate accounts. Rate-limiting is per-email.
router.post("/users/password-reset/request", async (req, res): Promise<void> => {
  const body = RequestPasswordResetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const email = body.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  // If the user doesn't exist or hasn't verified their email, silently succeed
  // — never reveal whether an account exists.
  if (!user || !user.emailVerifiedAt) {
    res.json({ ok: true });
    return;
  }

  let releaseLocks: (() => Promise<void>) | undefined;
  try {
    releaseLocks = await acquireAccountRequestLocks(user.id, "shared");
  } catch (err) {
    req.log.error({ err, userId: user.id }, "Could not safely process password-reset request");
    res.status(503).json({ error: "Password-reset request could not be safely processed" });
    return;
  }
  if (req.aborted) {
    await releaseLocks();
    return;
  }
  if (!releaseAccountRequestLocksOnResponse(res, releaseLocks, (err) => {
    req.log.error({ err, userId: user!.id }, "Failed to release password-reset request lock");
  })) return;
  const [currentUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  if (!currentUser || currentUser.deletionPending || !currentUser.emailVerifiedAt) {
    res.json({ ok: true });
    return;
  }

  // Rate-limit: enforce minimum interval between sends.
  if (
    currentUser.passwordResetSentAt &&
    Date.now() - currentUser.passwordResetSentAt.getTime() < RESET_RESEND_INTERVAL_MS
  ) {
    res.status(429).json({ error: "Reset email sent recently — try again in a minute" });
    return;
  }

  const code = generateVerificationCode();
  const cooldownCutoff = new Date(Date.now() - RESET_RESEND_INTERVAL_MS);
  const claimed = await db
    .update(usersTable)
    .set({
      passwordResetCodeHash: hashVerificationCode(code),
      passwordResetExpiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      passwordResetSentAt: new Date(),
    })
    .where(
      and(
        eq(usersTable.id, currentUser.id),
        eq(usersTable.deletionPending, false),
        or(
          isNull(usersTable.passwordResetSentAt),
          lt(usersTable.passwordResetSentAt, cooldownCutoff),
        ),
      ),
    )
    .returning({ id: usersTable.id });

  if (claimed.length === 0) {
    res.status(429).json({ error: "Reset email sent recently — try again in a minute" });
    return;
  }

  try {
    await sendPasswordResetEmail(currentUser.email!, code);
  } catch (err) {
    // Roll back the cooldown on delivery failure so the user can retry immediately.
    try {
      await db
        .update(usersTable)
        .set({ passwordResetSentAt: null })
        .where(eq(usersTable.id, currentUser.id));
    } catch {
      // Best-effort rollback.
    }
    req.log.error({ err }, "Password reset email send failed");
    res.status(502).json({ error: "Failed to send reset email" });
    return;
  }

  res.json({ ok: true });
});

// Confirm the reset code and set the new password. Unauthenticated.
router.post("/users/password-reset/confirm", async (req, res): Promise<void> => {
  const body = ConfirmPasswordResetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const email = body.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (
    !user ||
    !user.passwordResetCodeHash ||
    !user.passwordResetExpiresAt ||
    user.passwordResetExpiresAt.getTime() < Date.now()
  ) {
    res.status(400).json({ error: "Reset code is invalid or has expired" });
    return;
  }

  if (hashVerificationCode(body.data.code) !== user.passwordResetCodeHash) {
    res.status(400).json({ error: "Incorrect reset code" });
    return;
  }

  let releaseLocks: (() => Promise<void>) | undefined;
  try {
    releaseLocks = await acquireAccountRequestLocks(user.id, "shared");
  } catch (err) {
    req.log.error({ err, userId: user.id }, "Could not safely complete password reset");
    res.status(503).json({ error: "Password reset could not be safely completed" });
    return;
  }
  if (req.aborted) {
    await releaseLocks();
    return;
  }
  if (!releaseAccountRequestLocksOnResponse(res, releaseLocks, (err) => {
    req.log.error({ err, userId: user!.id }, "Failed to release password-reset account lock");
  })) return;
  const [currentUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  if (
    !currentUser ||
    currentUser.deletionPending ||
    !currentUser.passwordResetCodeHash ||
    !currentUser.passwordResetExpiresAt ||
    currentUser.passwordResetExpiresAt.getTime() < Date.now() ||
    hashVerificationCode(body.data.code) !== currentUser.passwordResetCodeHash
  ) {
    res.status(400).json({ error: "Reset code is invalid or has expired" });
    return;
  }

  const passwordHash = await bcrypt.hash(body.data.newPassword, 10);
  const [updated] = await db
    .update(usersTable)
    .set({
      passwordHash,
      passwordResetCodeHash: null,
      passwordResetExpiresAt: null,
      passwordResetSentAt: null,
    })
    .where(eq(usersTable.id, currentUser.id))
    .returning();

  res.json(formatUser(updated!, { self: true, token: createToken(updated!.id) }));
});

// Send (or resend) the email verification code. Self only, rate-limited.
router.post("/users/:userId/verify-email/send", authenticate, async (req, res): Promise<void> => {
  const params = SendVerificationEmailParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.email) {
    res.status(400).json({ error: "No email on this account" });
    return;
  }
  if (user.emailVerifiedAt) {
    res.status(400).json({ error: "Email already verified" });
    return;
  }
  if (
    user.emailVerificationSentAt &&
    Date.now() - user.emailVerificationSentAt.getTime() < VERIFICATION_RESEND_INTERVAL_MS
  ) {
    res.status(429).json({ error: "Verification email sent recently — try again in a minute" });
    return;
  }

  try {
    const outcome = await issueVerificationCode(user, true);
    if (outcome === "cooldown") {
      res.status(429).json({ error: "Verification email sent recently — try again in a minute" });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "Verification email send failed");
    res.status(502).json({ error: "Failed to send verification email" });
    return;
  }
  res.json({ ok: true });
});

// Confirm the 6-digit verification code. Self only.
router.post("/users/:userId/verify-email/confirm", authenticate, async (req, res): Promise<void> => {
  const params = ConfirmEmailVerificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = ConfirmEmailVerificationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.emailVerifiedAt) {
    res.json(formatUser(user, { self: true }));
    return;
  }
  if (
    !user.emailVerificationCodeHash ||
    !user.emailVerificationExpiresAt ||
    user.emailVerificationExpiresAt.getTime() < Date.now()
  ) {
    res.status(400).json({ error: "Code expired — request a new one" });
    return;
  }
  if (hashVerificationCode(body.data.code) !== user.emailVerificationCodeHash) {
    res.status(400).json({ error: "Incorrect code" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      emailVerifiedAt: new Date(),
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(formatUser(updated!, { self: true }));
});

// Presigned PUT URL for a new avatar image (public object dir). Self only.
router.post("/users/:userId/avatar/upload-url", authenticate, async (req, res): Promise<void> => {
  const params = GetAvatarUploadUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const svc = new ObjectStorageService();
  try {
    const { uploadURL, objectPath } = await svc.getAvatarUploadURL();
    const issued = await db.transaction(async (tx) => {
      const [activeAccount] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, req.userId),
            eq(usersTable.deletionPending, false),
          ),
        )
        .for("share");
      if (!activeAccount) return false;
      await tx.insert(userObjectUploadsTable).values({
        userId: req.userId,
        kind: "avatar",
        objectPath,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      return true;
    });
    if (!issued) {
      res.status(409).json({ error: "Account deletion is in progress" });
      return;
    }
    res.json({ uploadURL });
  } catch (err) {
    req.log.error({ err, userId: req.userId }, "Failed to issue owned avatar upload URL");
    res.status(500).json({ error: "Could not create an avatar upload" });
  }
});

// Set the avatar after the client uploaded it to the presigned URL. Self only.
router.put("/users/:userId/avatar", authenticate, async (req, res): Promise<void> => {
  const params = SetAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = SetAvatarBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const svc = new ObjectStorageService();
  const avatarUrl = svc.normalizeAvatarPath(body.data.uploadURL);
  if (!avatarUrl || !isGeneratedAvatarObjectPath(avatarUrl)) {
    res.status(400).json({ error: "Invalid avatar upload URL" });
    return;
  }

  const [ownershipProof] = await db
    .select({ id: userObjectUploadsTable.id })
    .from(userObjectUploadsTable)
    .where(
      and(
        eq(userObjectUploadsTable.userId, req.userId),
        eq(userObjectUploadsTable.kind, "avatar"),
        eq(userObjectUploadsTable.objectPath, avatarUrl),
        gt(userObjectUploadsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!ownershipProof) {
    res.status(403).json({ error: "Avatar must come from an upload URL issued to this account" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ avatarUrl })
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated, { self: true }));
});

// Remove the avatar (falls back to the colored initial). Self only.
router.delete("/users/:userId/avatar", authenticate, async (req, res): Promise<void> => {
  const params = RemoveAvatarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ avatarUrl: null })
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated, { self: true }));
});

router.get("/users/search", authenticate, async (req, res): Promise<void> => {
  const params = SearchUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q } = params.data;
  const userId = req.userId;

  // Match either username or display nickname, case-insensitively.
  const pattern = `%${q}%`;
  const users = await db
    .select()
    .from(usersTable)
    .where(or(ilike(usersTable.username, pattern), ilike(usersTable.nickname, pattern)))
    .limit(20);

  const candidates = users.filter((u) => u.id !== userId);
  const candidateIds = candidates.map((u) => u.id);

  // Batch relationship lookups: follows in both directions + pending requests.
  const followingSet = new Set<number>();
  const followsMeSet = new Set<number>();
  const requestedSet = new Set<number>();
  const incomingSet = new Set<number>();
  if (candidateIds.length > 0) {
    const [outEdges, inEdges, outReqs, inReqs] = await Promise.all([
      db
        .select({ friendId: friendshipsTable.friendId })
        .from(friendshipsTable)
        .where(and(eq(friendshipsTable.userId, userId), inArray(friendshipsTable.friendId, candidateIds))),
      db
        .select({ userId: friendshipsTable.userId })
        .from(friendshipsTable)
        .where(and(eq(friendshipsTable.friendId, userId), inArray(friendshipsTable.userId, candidateIds))),
      db
        .select({ recipientId: friendRequestsTable.recipientId })
        .from(friendRequestsTable)
        .where(and(eq(friendRequestsTable.requesterId, userId), inArray(friendRequestsTable.recipientId, candidateIds))),
      db
        .select({ requesterId: friendRequestsTable.requesterId })
        .from(friendRequestsTable)
        .where(and(eq(friendRequestsTable.recipientId, userId), inArray(friendRequestsTable.requesterId, candidateIds))),
    ]);
    for (const e of outEdges) followingSet.add(e.friendId);
    for (const e of inEdges) followsMeSet.add(e.userId);
    for (const r of outReqs) requestedSet.add(r.recipientId);
    for (const r of inReqs) incomingSet.add(r.requesterId);
  }

  const results = candidates.map((u) => {
    const isFollowing = followingSet.has(u.id);
    const mutual = isFollowing && followsMeSet.has(u.id);
    const friendStatus: "none" | "requested" | "incoming" | "friends" = mutual
      ? "friends"
      : requestedSet.has(u.id)
        ? "requested"
        : incomingSet.has(u.id)
          ? "incoming"
          : "none";
    return {
      id: u.id,
      username: u.username,
      nickname: u.nickname ?? null,
      avatarUrl: u.avatarUrl ?? null,
      avatarColor: u.avatarColor,
      createdAt: u.createdAt.toISOString(),
      isFriend: isFollowing,
      isFollowing,
      friendStatus,
    };
  });

  res.json(results);
});

router.get("/users/:userId", authenticate, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user, { self: req.userId === user.id }));
});

// Permanently delete the authenticated user's account and all account-owned
// data. Password confirmation is required even with a valid bearer token.
router.delete("/users/:userId", authenticate, async (req, res): Promise<void> => {
  const params = DeleteUserAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "You may only delete your own account" });
    return;
  }
  const body = DeleteUserAccountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  let user: DbUser | undefined;
  try {
    [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
  } catch (err) {
    req.log.error({ err, userId: req.userId }, "Failed to load account for deletion");
    res.status(500).json({ error: "Account could not be verified for deletion" });
    return;
  }
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.passwordHash) {
    res.status(400).json({ error: "This account has no password credential; set a password before deleting it" });
    return;
  }
  let passwordMatches: boolean;
  try {
    passwordMatches = await bcrypt.compare(body.data.password, user.passwordHash);
  } catch (err) {
    req.log.error({ err, userId: user.id }, "Failed to verify account password for deletion");
    res.status(500).json({ error: "Password could not be verified" });
    return;
  }
  if (!passwordMatches) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const restoreAccountAfterFailure = async (): Promise<void> => {
    try {
      await db
        .update(usersTable)
        .set({ deletionPending: false })
        .where(eq(usersTable.id, user!.id));
    } catch (err) {
      req.log.error({ err, userId: user!.id }, "Could not clear account deletion lock");
    }
  };

  try {
    if (!user.deletionPending) {
      const [pendingUser] = await db
        .update(usersTable)
        .set({ deletionPending: true })
        .where(
          and(
            eq(usersTable.id, user.id),
            eq(usersTable.deletionPending, false),
          ),
        )
        .returning({ id: usersTable.id });
      if (!pendingUser) {
        res.status(409).json({ error: "Account deletion is already in progress" });
        return;
      }
    }
  } catch (err) {
    req.log.error({ err, userId: user.id }, "Failed to freeze account before deletion");
    try {
      await db
        .update(usersTable)
        .set({ deletionPending: false })
        .where(eq(usersTable.id, user!.id));
    } catch (resetErr) {
      req.log.error({ err: resetErr, userId: user.id }, "Could not clear account deletion lock");
    }
    res.status(500).json({ error: "Account could not be prepared for deletion" });
    return;
  }

  let cleanupJobId: number | null = null;
  let sharedObjectsRetained = 0;
  try {
    await db.transaction(async (tx) => {
      // Room ownership changes lock their room rows before modifying membership.
      // This transaction locks owned rooms too, so membership reads below use
      // the latest committed state after any in-flight room mutation finishes.
      // The request-level exclusive advisory barrier has already drained all
      // shared-lock writes before this cleanup transaction begins.
      const ownedUploads = await tx
        .select({
          kind: userObjectUploadsTable.kind,
          objectPath: userObjectUploadsTable.objectPath,
        })
        .from(userObjectUploadsTable)
        .where(eq(userObjectUploadsTable.userId, user.id));
      const legacyLibraryEntries = await tx
        .select({ objectPath: userLibraryTable.epubObjectPath })
        .from(userLibraryTable)
        .where(eq(userLibraryTable.userId, user.id));
      const storage = new ObjectStorageService();
      const normalizeLegacyEpubPath = (rawPath: string): string => {
        try {
          return storage.normalizeObjectEntityPath(rawPath);
        } catch {
          return rawPath;
        }
      };
      const normalizeLegacyAvatarPath = (rawPath: string): string => {
        try {
          return storage.normalizeAvatarPath(rawPath) ?? rawPath;
        } catch {
          return rawPath;
        }
      };
      const objectCandidates = new Map<string, "epub" | "avatar">();
      for (const upload of ownedUploads) {
        if (
          (upload.kind === "epub" && isGeneratedEpubObjectPath(upload.objectPath)) ||
          (upload.kind === "avatar" && isGeneratedAvatarObjectPath(upload.objectPath))
        ) {
          objectCandidates.set(upload.objectPath, upload.kind);
        }
      }
      for (const entry of legacyLibraryEntries) {
        const objectPath = normalizeLegacyEpubPath(entry.objectPath);
        if (isGeneratedEpubObjectPath(objectPath)) {
          objectCandidates.set(objectPath, "epub");
        }
      }
      const legacyAvatarPath = user.avatarUrl
        ? normalizeLegacyAvatarPath(user.avatarUrl)
        : null;
      if (legacyAvatarPath && isGeneratedAvatarObjectPath(legacyAvatarPath)) {
        objectCandidates.set(legacyAvatarPath, "avatar");
      }
      const safeObjectPaths: string[] = [];
      for (const [objectPath, kind] of objectCandidates) {
        const [foreignReference] =
          kind === "epub"
            ? await tx
                .select({ id: userLibraryTable.id })
                .from(userLibraryTable)
                .where(
                  and(
                    or(
                      eq(userLibraryTable.epubObjectPath, objectPath),
                      like(userLibraryTable.epubObjectPath, `%/${objectPath.split("/").at(-1)}`),
                    ),
                    sql`${userLibraryTable.userId} <> ${user.id}`,
                  ),
                )
                .limit(1)
            : await tx
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(
                  and(
                    or(
                      eq(usersTable.avatarUrl, objectPath),
                      like(usersTable.avatarUrl, `%/avatars/${objectPath.split("/").at(-1)}`),
                    ),
                    sql`${usersTable.id} <> ${user.id}`,
                  ),
                )
                .limit(1);
        if (foreignReference) {
          sharedObjectsRetained += 1;
        } else {
          safeObjectPaths.push(objectPath);
        }
      }
      if (safeObjectPaths.length) {
        const [job] = await tx
          .insert(accountObjectCleanupJobsTable)
          .values({ objectPaths: safeObjectPaths })
          .returning({ id: accountObjectCleanupJobsTable.id });
        cleanupJobId = job?.id ?? null;
      }

      const authoredComments = await tx
        .select({ id: commentsTable.id, parentId: commentsTable.parentId })
        .from(commentsTable)
        .where(eq(commentsTable.userId, user.id));
      const authoredCommentIds = authoredComments.map((comment) => comment.id);
      const authoredParentIds = authoredComments
        .filter((comment) => comment.parentId === null)
        .map((comment) => comment.id);

      // Remove the user's comments and capture replies to their top-level
      // comments so replies from other people can be preserved below.
      const authoredThreadReplies = authoredParentIds.length
        ? await tx
            .select({
              id: commentsTable.id,
              userId: commentsTable.userId,
              roomId: commentsTable.roomId,
            })
            .from(commentsTable)
            .where(inArray(commentsTable.parentId, authoredParentIds))
        : [];

      const ownedHighlights = await tx
        .select({ id: userHighlightsTable.id })
        .from(userHighlightsTable)
        .where(eq(userHighlightsTable.userId, user.id));
      const highlightIds = new Set(ownedHighlights.map((highlight) => highlight.id));

      const ownedRooms = await tx
        .select({ id: readingRoomsTable.id })
        .from(readingRoomsTable)
        .where(eq(readingRoomsTable.ownerId, user.id))
        .for("update");
      const emptyRoomIds: number[] = [];
      const archivedRoomIds: number[] = [];

      for (const room of ownedRooms) {
        const otherMembers = await tx
          .select({ userId: roomMembersTable.userId })
          .from(roomMembersTable)
          .where(
            and(
              eq(roomMembersTable.roomId, room.id),
              // roomMembers normally contains the owner, but excluding the
              // deleting user also handles inconsistent legacy membership.
              sql`${roomMembersTable.userId} <> ${user.id}`,
            ),
          )
          .orderBy(asc(roomMembersTable.createdAt), asc(roomMembersTable.id));
        const nextOwner = otherMembers[0];
        if (nextOwner) {
          await tx
            .update(readingRoomsTable)
            .set({ ownerId: nextOwner.userId })
            .where(eq(readingRoomsTable.id, room.id));
          await tx
            .update(roomMembersTable)
            .set({ role: "member" })
            .where(eq(roomMembersTable.roomId, room.id));
          await tx
            .update(roomMembersTable)
            .set({ role: "owner" })
            .where(
              and(
                eq(roomMembersTable.roomId, room.id),
                eq(roomMembersTable.userId, nextOwner.userId),
              ),
            );
        } else {
          const roomComments = await tx
            .select({ id: commentsTable.id, parentId: commentsTable.parentId, userId: commentsTable.userId })
            .from(commentsTable)
            .where(eq(commentsTable.roomId, room.id));
          const roomParentIds = roomComments
            .filter((comment) => comment.parentId === null)
            .map((comment) => comment.id);
          const roomReplies = roomParentIds.length
            ? await tx
                .select({ userId: commentsTable.userId })
                .from(commentsTable)
                .where(inArray(commentsTable.parentId, roomParentIds))
            : [];
          const [foreignHighlight] = await tx
            .select({ id: userHighlightsTable.id })
            .from(userHighlightsTable)
            .where(
              and(
                eq(userHighlightsTable.roomId, room.id),
                sql`${userHighlightsTable.userId} <> ${user.id}`,
              ),
            )
            .limit(1);
          const disposition = getRoomDeletionDisposition({
            hasThirdPartyComments:
              roomComments.some((comment) => comment.userId !== user.id) ||
              roomReplies.some((reply) => reply.userId !== user.id),
            hasThirdPartyHighlights: Boolean(foreignHighlight),
          });
          if (disposition === "archive") {
            await tx
              .update(readingRoomsTable)
              .set({ ownerId: null })
              .where(eq(readingRoomsTable.id, room.id));
            archivedRoomIds.push(room.id);
          } else {
            emptyRoomIds.push(room.id);
          }
        }
      }

      const removedCommentIds = new Set<number>([
        ...authoredCommentIds,
        ...authoredThreadReplies
          .filter((reply) => reply.userId === user.id)
          .map((reply) => reply.id),
      ]);
      const removedHighlightIds = new Set<number>(highlightIds);

      if (emptyRoomIds.length) {
        const roomComments = await tx
          .select({ id: commentsTable.id, parentId: commentsTable.parentId })
          .from(commentsTable)
          .where(inArray(commentsTable.roomId, emptyRoomIds));
        for (const comment of roomComments) removedCommentIds.add(comment.id);
        const roomParentIds = roomComments
          .filter((comment) => comment.parentId === null)
          .map((comment) => comment.id);
        if (roomParentIds.length) {
          const roomReplies = await tx
            .select({ id: commentsTable.id })
            .from(commentsTable)
            .where(inArray(commentsTable.parentId, roomParentIds));
          for (const reply of roomReplies) removedCommentIds.add(reply.id);
        }
        const roomHighlights = await tx
          .select({ id: userHighlightsTable.id })
          .from(userHighlightsTable)
          .where(inArray(userHighlightsTable.roomId, emptyRoomIds));
        for (const highlight of roomHighlights) removedHighlightIds.add(highlight.id);
      }

      // Keep replies written by other people when their parent is deleted;
      // promote them to standalone comments rather than erasing their content
      // or leaving them attached to a missing parent.
      const preservedReplyIds = authoredThreadReplies
        .filter(
          (reply) =>
            reply.userId !== user.id &&
            !removedCommentIds.has(reply.id),
        )
        .map((reply) => reply.id);
      if (preservedReplyIds.length) {
        await tx
          .update(commentsTable)
          .set({ parentId: null })
          .where(inArray(commentsTable.id, preservedReplyIds));
      }

      const commentIds = [...removedCommentIds];
      const highlightIdList = [...removedHighlightIds];

      // Preserve the denormalized like counts on comments that remain.
      const survivingCommentLikes = await tx
        .select({ commentId: commentLikesTable.commentId })
        .from(commentLikesTable)
        .where(eq(commentLikesTable.userId, user.id));
      const likeCounts = new Map<number, number>();
      for (const like of survivingCommentLikes) {
        if (!removedCommentIds.has(like.commentId)) {
          likeCounts.set(like.commentId, (likeCounts.get(like.commentId) ?? 0) + 1);
        }
      }
      for (const [commentId, removedLikes] of likeCounts) {
        await tx
          .update(commentsTable)
          .set({
            likeCount: sql`GREATEST(0, ${commentsTable.likeCount} - ${removedLikes})`,
          })
          .where(eq(commentsTable.id, commentId));
      }

      await tx
        .delete(commentLikesTable)
        .where(
          or(
            eq(commentLikesTable.userId, user.id),
            ...(commentIds.length
              ? [inArray(commentLikesTable.commentId, commentIds)]
              : []),
          )!,
        );
      await tx
        .delete(commentSavesTable)
        .where(
          or(
            eq(commentSavesTable.userId, user.id),
            ...(commentIds.length
              ? [inArray(commentSavesTable.commentId, commentIds)]
              : []),
          )!,
        );
      await tx
        .delete(highlightLikesTable)
        .where(
          or(
            eq(highlightLikesTable.userId, user.id),
            ...(highlightIdList.length
              ? [inArray(highlightLikesTable.highlightId, highlightIdList)]
              : []),
          )!,
        );

      const notificationConditions = [
        eq(notificationsTable.userId, user.id),
        eq(notificationsTable.actorId, user.id),
        ...(commentIds.length
          ? [inArray(notificationsTable.commentId, commentIds)]
          : []),
        ...(highlightIdList.length
          ? [inArray(notificationsTable.highlightId, highlightIdList)]
          : []),
        ...(emptyRoomIds.length
          ? [inArray(notificationsTable.roomId, emptyRoomIds)]
          : []),
      ];
      await tx.delete(notificationsTable).where(or(...notificationConditions)!);

      if (commentIds.length) {
        await tx.delete(commentsTable).where(inArray(commentsTable.id, commentIds));
      }
      if (highlightIdList.length) {
        await tx
          .delete(userHighlightsTable)
          .where(inArray(userHighlightsTable.id, highlightIdList));
      }

      await tx.delete(userLibraryTable).where(eq(userLibraryTable.userId, user.id));
      await tx
        .delete(friendshipsTable)
        .where(
          or(
            eq(friendshipsTable.userId, user.id),
            eq(friendshipsTable.friendId, user.id),
          )!,
        );
      await tx
        .delete(friendRequestsTable)
        .where(
          or(
            eq(friendRequestsTable.requesterId, user.id),
            eq(friendRequestsTable.recipientId, user.id),
          )!,
        );
      await tx.delete(pushTokensTable).where(eq(pushTokensTable.userId, user.id));
      await tx.delete(feedbackTable).where(eq(feedbackTable.userId, user.id));

      const inviteConditions = [
        eq(roomInvitesTable.inviterId, user.id),
        eq(roomInvitesTable.inviteeId, user.id),
        ...([...emptyRoomIds, ...archivedRoomIds].length
          ? [inArray(roomInvitesTable.roomId, [...emptyRoomIds, ...archivedRoomIds])]
          : []),
      ];
      await tx.delete(roomInvitesTable).where(or(...inviteConditions)!);
      await tx.delete(roomMembersTable).where(eq(roomMembersTable.userId, user.id));
      if (emptyRoomIds.length) {
        await tx
          .delete(roomMembersTable)
          .where(inArray(roomMembersTable.roomId, emptyRoomIds));
        await tx
          .delete(readingRoomsTable)
          .where(inArray(readingRoomsTable.id, emptyRoomIds));
      }

      await tx
        .delete(userObjectUploadsTable)
        .where(eq(userObjectUploadsTable.userId, user.id));
      await tx.delete(usersTable).where(eq(usersTable.id, user.id));
      await tx.insert(accountDeletionFeedbackTable).values({
        reason: body.data.reason,
      });
    });
  } catch (err) {
    await restoreAccountAfterFailure();
    req.log.error({ err, userId: user.id }, "Account deletion transaction failed");
    res.status(500).json({ error: "Account data could not be deleted" });
    return;
  }

  let objectCleanupPending = false;
  if (cleanupJobId != null) {
    try {
      objectCleanupPending = await processAccountObjectCleanupJob(cleanupJobId);
    } catch (err) {
      objectCleanupPending = true;
      req.log.error(
        { err, jobId: cleanupJobId, userId: user.id },
        "Immediate account object cleanup attempt failed; retry remains queued",
      );
    }
  }
  if (sharedObjectsRetained) {
    req.log.warn(
      { count: sharedObjectsRetained, userId: user.id },
      "Retained account upload objects referenced by another account",
    );
  }
  res.json({
    ok: true,
    deleted: true,
    objectCleanupPending,
    sharedObjectsRetained,
  });
});

// Public profile with follower/following + activity counts and the viewer's
// relationship to this user. Counts are visibility-gated to the viewer.
router.get("/users/:userId/profile", authenticate, async (req, res): Promise<void> => {
  const params = GetUserProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const targetId = params.data.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const viewer = await getViewer(req.userId);
  const isMe = req.userId === targetId;

  const [followerRow] = await db
    .select({ c: count() })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.friendId, targetId));
  const [followingRow] = await db
    .select({ c: count() })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.userId, targetId));
  const [highlightRow] = await db
    .select({ c: count() })
    .from(userHighlightsTable)
    .where(
      and(
        eq(userHighlightsTable.userId, targetId),
        visibilityPredicate(
          userHighlightsTable.visibility,
          userHighlightsTable.userId,
          viewer,
          userHighlightsTable.roomId,
        ),
      ),
    );
  const [commentRow] = await db
    .select({ c: count() })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.userId, targetId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
          commentsTable.roomId,
        ),
      ),
    );

  const [recentComments, recentHighlights] = await Promise.all([
    db
      .select({
        id: commentsTable.id,
        quoteId: quotesTable.id,
        commentText: commentsTable.text,
        containsSpoilers: commentsTable.containsSpoilers,
        createdAt: commentsTable.createdAt,
        bookId: booksTable.id,
        bookTitle: booksTable.title,
        bookAuthor: booksTable.author,
        coverColor: booksTable.coverColor,
        quoteText: quotesTable.text,
      })
      .from(commentsTable)
      .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
      .innerJoin(booksTable, eq(quotesTable.canonicalBookId, booksTable.id))
      .where(
        and(
          eq(commentsTable.userId, targetId),
          eq(commentsTable.visibility, "public"),
          isNull(commentsTable.roomId),
          isNull(commentsTable.parentId),
        ),
      )
      .orderBy(desc(commentsTable.createdAt), desc(commentsTable.id))
      .limit(6),
    db
      .select({
        id: userHighlightsTable.id,
        quoteId: quotesTable.id,
        createdAt: userHighlightsTable.createdAt,
        bookId: booksTable.id,
        bookTitle: booksTable.title,
        bookAuthor: booksTable.author,
        coverColor: booksTable.coverColor,
        quoteText: quotesTable.text,
      })
      .from(userHighlightsTable)
      .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
      .innerJoin(booksTable, eq(quotesTable.canonicalBookId, booksTable.id))
      .where(
        and(
          eq(userHighlightsTable.userId, targetId),
          eq(userHighlightsTable.visibility, "public"),
          isNull(userHighlightsTable.roomId),
        ),
      )
      .orderBy(desc(userHighlightsTable.createdAt), desc(userHighlightsTable.id))
      .limit(6),
  ]);

  const activityBookIds = [
    ...new Set([
      ...recentComments.map((item) => item.bookId),
      ...recentHighlights.map((item) => item.bookId),
    ]),
  ];
  const ownedActivityBookIds = await getOwnedBookIds(req.userId, activityBookIds);
  const recentActivity = [
    ...recentComments.map((item) => ({ ...item, kind: "comment" as const })),
    ...recentHighlights.map((item) => ({ ...item, kind: "highlight" as const })),
  ]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id - a.id,
    )
    .slice(0, 6)
    .map((item) => {
      const quotePreview = ownedActivityBookIds.has(item.bookId)
        ? { text: item.quoteText, truncated: false }
        : truncateQuoteText(item.quoteText);
      return {
        kind: item.kind,
        id: item.id,
        quoteId: item.quoteId,
        bookId: item.bookId,
        bookTitle: item.bookTitle,
        bookAuthor: item.bookAuthor,
        coverColor: item.coverColor,
        quoteText: quotePreview.text,
        quoteTextTruncated: quotePreview.truncated,
        createdAt: item.createdAt.toISOString(),
        ...(item.kind === "comment"
          ? {
              commentText: item.commentText,
              containsSpoilers: item.containsSpoilers,
            }
          : {}),
      };
    });

  const isFollowedByMe = isMe ? false : await isFollowing(req.userId, targetId);
  const followsMe = isMe ? false : await isFollowing(targetId, req.userId);

  // Friend status: friends = mutual follow; otherwise check pending requests.
  let friendStatus: "none" | "requested" | "incoming" | "friends" = "none";
  if (!isMe) {
    if (isFollowedByMe && followsMe) {
      friendStatus = "friends";
    } else {
      const [outgoing] = await db
        .select({ id: friendRequestsTable.id })
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.requesterId, req.userId),
            eq(friendRequestsTable.recipientId, targetId),
          ),
        );
      if (outgoing) {
        friendStatus = "requested";
      } else {
        const [incoming] = await db
          .select({ id: friendRequestsTable.id })
          .from(friendRequestsTable)
          .where(
            and(
              eq(friendRequestsTable.requesterId, targetId),
              eq(friendRequestsTable.recipientId, req.userId),
            ),
          );
        if (incoming) friendStatus = "incoming";
      }
    }
  }

  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname ?? null,
    avatarUrl: user.avatarUrl ?? null,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt.toISOString(),
    followerCount: Number(followerRow?.c ?? 0),
    followingCount: Number(followingRow?.c ?? 0),
    highlightCount: Number(highlightRow?.c ?? 0),
    commentCount: Number(commentRow?.c ?? 0),
    recentActivity,
    isFollowedByMe,
    followsMe,
    isMe,
    friendStatus,
  });
});

// Update the current user's personal settings (self only).
router.patch("/users/:userId/settings", authenticate, async (req, res): Promise<void> => {
  const params = UpdateUserSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = UpdateUserSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (body.data.defaultVisibility !== undefined) {
    updates.defaultVisibility = body.data.defaultVisibility;
  }
  if (body.data.nickname !== undefined) {
    // null or empty/whitespace-only string clears the nickname.
    updates.nickname = body.data.nickname?.trim() || null;
  }
  if (Object.keys(updates).length === 0) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(formatUser(user, { self: true }));
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user, { self: true }));
});

// Get the current user's per-type notification settings (self only).
router.get("/users/:userId/notification-settings", authenticate, async (req, res): Promise<void> => {
  const params = GetNotificationSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [user] = await db
    .select({
      notifyLikes: usersTable.notifyLikes,
      notifyReplies: usersTable.notifyReplies,
      notifyMentions: usersTable.notifyMentions,
      notifyFriends: usersTable.notifyFriends,
      notifyRooms: usersTable.notifyRooms,
    })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    likes: user.notifyLikes,
    replies: user.notifyReplies,
    mentions: user.notifyMentions,
    friends: user.notifyFriends,
    rooms: user.notifyRooms,
  });
});

// Update the current user's per-type notification settings (self only).
// A disabled type skips BOTH in-app notification creation and push delivery.
router.put("/users/:userId/notification-settings", authenticate, async (req, res): Promise<void> => {
  const params = UpdateNotificationSettingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = UpdateNotificationSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({
      notifyLikes: body.data.likes,
      notifyReplies: body.data.replies,
      notifyMentions: body.data.mentions,
      notifyFriends: body.data.friends,
      notifyRooms: body.data.rooms,
    })
    .where(eq(usersTable.id, params.data.userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    likes: user.notifyLikes,
    replies: user.notifyReplies,
    mentions: user.notifyMentions,
    friends: user.notifyFriends,
    rooms: user.notifyRooms,
  });
});

router.get("/users/:userId/friends", authenticate, async (req, res): Promise<void> => {
  const params = GetFriendsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const friendships = await db.select({ friendId: friendshipsTable.friendId }).from(friendshipsTable).where(eq(friendshipsTable.userId, params.data.userId));
  if (friendships.length === 0) {
    res.json([]);
    return;
  }

  const friendIds = friendships.map((f) => f.friendId);
  const friends = await db.select().from(usersTable);
  const filtered = friends.filter((u) => friendIds.includes(u.id));
  res.json(filtered.map((u) => formatUser(u, { self: false })));
});

router.post("/users/:userId/friends", authenticate, async (req, res): Promise<void> => {
  const params = AddFriendParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = AddFriendBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { userId } = params.data;
  const { friendId } = body.data;

  if (userId === friendId) {
    res.status(400).json({ error: "Cannot follow yourself" });
    return;
  }

  const [friend] = await db.select().from(usersTable).where(eq(usersTable.id, friendId));
  if (!friend) {
    res.status(404).json({ error: "Friend not found" });
    return;
  }

  // Directional follow: a single row (userId follows friendId). No reverse row.
  // Validate the target exists first so we never persist an orphan follow edge.
  await db
    .insert(friendshipsTable)
    .values({ userId, friendId })
    .onConflictDoNothing();

  res.json(formatUser(friend, { self: false }));
});

router.delete("/users/:userId/friends/:friendId", authenticate, async (req, res): Promise<void> => {
  const params = RemoveFriendParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId, friendId } = params.data;
  // Directional unfollow: remove only the (userId -> friendId) row.
  await db.delete(friendshipsTable).where(and(eq(friendshipsTable.userId, userId), eq(friendshipsTable.friendId, friendId)));
  res.sendStatus(204);
});

router.get("/users/:userId/saved-comments", authenticate, async (req, res): Promise<void> => {
  const params = GetSavedCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId } = params.data;
  const saves = await db.select({ commentId: commentSavesTable.commentId }).from(commentSavesTable).where(eq(commentSavesTable.userId, userId));

  if (saves.length === 0) {
    res.json([]);
    return;
  }

  const commentIds = saves.map((s) => s.commentId);
  // Re-apply visibility on read: a comment saved while public may since have
  // turned private/friends-only, so never return text the viewer can't see.
  const viewer = await getViewer(userId);
  const comments = await db
    .select()
    .from(commentsTable)
    .where(
      and(
        inArray(commentsTable.id, commentIds),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
          commentsTable.roomId,
        ),
      ),
    );

  const quoteIds = [...new Set(comments.map((c) => c.quoteId))];
  const quotes = quoteIds.length
    ? await db.select().from(quotesTable).where(inArray(quotesTable.id, quoteIds))
    : [];
  const quoteTextById = new Map(quotes.map((q) => [q.id, q.text]));

  const result = await Promise.all(
    comments.map((c) =>
      formatComment(c, userId, quoteTextById.get(c.quoteId)),
    ),
  );

  res.json(result);
});

// My records grouped by book: my highlight/comment/saved counts per canonical
// book, ordered by most recent activity. Self-only.
router.get("/users/:userId/records", authenticate, async (req, res): Promise<void> => {
  const params = GetUserRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const userId = params.data.userId;

  const highlightRows = await db
    .select({
      bookId: quotesTable.canonicalBookId,
      c: count(),
      latest: max(userHighlightsTable.createdAt),
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .where(eq(userHighlightsTable.userId, userId))
    .groupBy(quotesTable.canonicalBookId);

  const commentRows = await db
    .select({
      bookId: quotesTable.canonicalBookId,
      c: count(),
      latest: max(commentsTable.createdAt),
    })
    .from(commentsTable)
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(eq(commentsTable.userId, userId))
    .groupBy(quotesTable.canonicalBookId);

  // Saved comments are other people's comments, so re-apply visibility on
  // read (mirrors /users/:userId/saved-comments): never count text the
  // viewer can no longer see.
  const viewer = await getViewer(userId);
  const savedRows = await db
    .select({
      bookId: quotesTable.canonicalBookId,
      c: count(),
      latest: max(commentSavesTable.createdAt),
    })
    .from(commentSavesTable)
    .innerJoin(commentsTable, eq(commentSavesTable.commentId, commentsTable.id))
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(commentSavesTable.userId, userId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
          commentsTable.roomId,
        ),
      ),
    )
    .groupBy(quotesTable.canonicalBookId);

  const agg = new Map<
    number,
    { highlightCount: number; commentCount: number; savedCount: number; latest: number }
  >();
  const bump = (
    bookId: number,
    key: "highlightCount" | "commentCount" | "savedCount",
    c: number,
    latest: Date | null,
  ) => {
    const cur =
      agg.get(bookId) ??
      { highlightCount: 0, commentCount: 0, savedCount: 0, latest: 0 };
    cur[key] += c;
    if (latest) cur.latest = Math.max(cur.latest, latest.getTime());
    agg.set(bookId, cur);
  };
  for (const r of highlightRows) bump(r.bookId, "highlightCount", Number(r.c), r.latest);
  for (const r of commentRows) bump(r.bookId, "commentCount", Number(r.c), r.latest);
  for (const r of savedRows) bump(r.bookId, "savedCount", Number(r.c), r.latest);

  const bookIds = [...agg.keys()];
  const books = bookIds.length
    ? await db.select().from(booksTable).where(inArray(booksTable.id, bookIds))
    : [];
  const bookById = new Map(books.map((b) => [b.id, b]));

  const result: UserRecordsBook[] = bookIds
    .filter((id) => bookById.has(id))
    .sort((a, b) => (agg.get(b)!.latest - agg.get(a)!.latest))
    .map((id) => {
      const book = bookById.get(id)!;
      const a = agg.get(id)!;
      return {
        bookId: id,
        title: book.title,
        author: book.author,
        coverColor: book.coverColor,
        highlightCount: a.highlightCount,
        commentCount: a.commentCount,
        savedCount: a.savedCount,
      };
    });

  res.json(result);
});

// My highlights / comments / saved comments for one book. Self-only.
router.get("/users/:userId/records/:bookId", authenticate, async (req, res): Promise<void> => {
  const params = GetUserBookRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { userId, bookId } = params.data;

  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, bookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const highlightRows = await db
    .select({
      id: userHighlightsTable.id,
      quoteId: userHighlightsTable.quoteId,
      quoteText: quotesTable.text,
      createdAt: userHighlightsTable.createdAt,
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(userHighlightsTable.userId, userId),
        eq(quotesTable.canonicalBookId, bookId),
      ),
    )
    .orderBy(desc(userHighlightsTable.createdAt));

  const highlights: UserHighlightItem[] = highlightRows.map((h) => ({
    id: h.id,
    quoteId: h.quoteId,
    bookId,
    bookTitle: book.title,
    bookAuthor: book.author,
    coverColor: book.coverColor,
    quoteText: h.quoteText,
    createdAt: h.createdAt,
  }));

  const myCommentRows = await db
    .select({ comment: commentsTable, quoteText: quotesTable.text })
    .from(commentsTable)
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(commentsTable.userId, userId),
        eq(quotesTable.canonicalBookId, bookId),
      ),
    )
    .orderBy(desc(commentsTable.createdAt));
  const comments = await Promise.all(
    myCommentRows.map((r) => formatComment(r.comment, userId, r.quoteText)),
  );

  // Saved comments: re-apply visibility on read (see saved-comments route).
  const viewer = await getViewer(userId);
  const savedCommentRows = await db
    .select({ comment: commentsTable, quoteText: quotesTable.text })
    .from(commentSavesTable)
    .innerJoin(commentsTable, eq(commentSavesTable.commentId, commentsTable.id))
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        eq(commentSavesTable.userId, userId),
        eq(quotesTable.canonicalBookId, bookId),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
          commentsTable.roomId,
        ),
      ),
    )
    .orderBy(desc(commentSavesTable.createdAt));
  const savedComments = await Promise.all(
    savedCommentRows.map((r) => formatComment(r.comment, userId, r.quoteText)),
  );

  res.json({
    book: {
      bookId,
      title: book.title,
      author: book.author,
      coverColor: book.coverColor,
      highlightCount: highlights.length,
      commentCount: comments.length,
      savedCount: savedComments.length,
    },
    highlights,
    comments,
    savedComments,
  });
});

// All my highlights across books, newest first. Self-only.
router.get("/users/:userId/highlights", authenticate, async (req, res): Promise<void> => {
  const params = GetUserHighlightsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({
      id: userHighlightsTable.id,
      quoteId: userHighlightsTable.quoteId,
      bookId: quotesTable.canonicalBookId,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      coverColor: booksTable.coverColor,
      quoteText: quotesTable.text,
      createdAt: userHighlightsTable.createdAt,
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .innerJoin(booksTable, eq(quotesTable.canonicalBookId, booksTable.id))
    .where(eq(userHighlightsTable.userId, params.data.userId))
    .orderBy(desc(userHighlightsTable.createdAt));

  const result: UserHighlightItem[] = rows.map((r) => ({
    id: r.id,
    quoteId: r.quoteId,
    bookId: r.bookId,
    bookTitle: r.bookTitle,
    bookAuthor: r.bookAuthor,
    coverColor: r.coverColor,
    quoteText: r.quoteText,
    createdAt: r.createdAt,
  }));

  res.json(result);
});

// Public rooms a user belongs to (public rooms only — no private room leakage).
router.get("/users/:userId/rooms", authenticate, async (req, res): Promise<void> => {
  const params = GetUserRoomsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid userId" }); return; }

  // Subquery: member count per room
  const memberCountSq = db
    .select({ roomId: roomMembersTable.roomId, n: count().as("n") })
    .from(roomMembersTable)
    .groupBy(roomMembersTable.roomId)
    .as("mc");

  const rows = await db
    .select({
      id: readingRoomsTable.id,
      canonicalBookId: readingRoomsTable.canonicalBookId,
      name: readingRoomsTable.name,
      description: readingRoomsTable.description,
      isPublic: readingRoomsTable.isPublic,
      ownerId: readingRoomsTable.ownerId,
      memberCount: memberCountSq.n,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      coverColor: booksTable.coverColor,
      createdAt: readingRoomsTable.createdAt,
    })
    .from(roomMembersTable)
    .innerJoin(readingRoomsTable, eq(roomMembersTable.roomId, readingRoomsTable.id))
    .innerJoin(booksTable, eq(readingRoomsTable.canonicalBookId, booksTable.id))
    .leftJoin(memberCountSq, eq(memberCountSq.roomId, readingRoomsTable.id))
    .where(
      and(
        eq(roomMembersTable.userId, params.data.userId),
        eq(readingRoomsTable.isPublic, true),
      ),
    )
    .orderBy(desc(readingRoomsTable.createdAt));

  const viewerId = req.userId;
  const roomIds = rows.map((r) => r.id);
  const memberRoomIds =
    roomIds.length > 0
      ? new Set(
          (
            await db
              .select({ roomId: roomMembersTable.roomId })
              .from(roomMembersTable)
              .where(
                and(
                  inArray(roomMembersTable.roomId, roomIds),
                  eq(roomMembersTable.userId, viewerId),
                ),
              )
          ).map((r) => r.roomId),
        )
      : new Set<number>();

  res.json(
    rows.map((r) => ({
      ...r,
      memberCount: r.memberCount ?? 0,
      isMember: memberRoomIds.has(r.id),
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

export default router;
