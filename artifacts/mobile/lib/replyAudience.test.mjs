import assert from "node:assert/strict";
import test from "node:test";
import { getReplyAudience } from "./replyAudience.ts";

test("ordinary comments opened from a room keep a valid unscoped reply audience", () => {
  // The viewing room is intentionally NOT an input to the reply policy.
  for (const defaultVisibility of ["public", "friends", "private"]) {
    const audience = getReplyAudience(null, defaultVisibility);
    assert.deepEqual(audience, { roomId: null, visibility: defaultVisibility });
    // Match the reply endpoint's room-scoped-thread guard.
    assert.equal(audience.visibility === "room" && audience.roomId == null, false);
  }
  assert.deepEqual(getReplyAudience(undefined), { roomId: null, visibility: "public" });
});

test("explicit room threads keep members-only reply defaults", () => {
  assert.deepEqual(getReplyAudience(42, "friends"), { roomId: 42, visibility: "room" });
});
