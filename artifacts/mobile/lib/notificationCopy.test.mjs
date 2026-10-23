import assert from "node:assert/strict";
import test from "node:test";
import { getNotificationCopy } from "./notificationCopy.ts";

test("in-app notification actions use English system-authored copy", () => {
  const expectedActions = {
    reply: " replied to your comment",
    mention: " mentioned you",
    friend_request: " sent you a friend request",
    friend_accept: " accepted your friend request",
    highlight_like: " liked your highlight",
    comment_like: " liked your comment",
    room_invite: " invited you to a reading room",
  };

  for (const [type, action] of Object.entries(expectedActions)) {
    assert.equal(getNotificationCopy(type, "sora").action, action);
  }
});

test("in-app notification copy preserves the actor's display name", () => {
  const actorName = "한국어 닉네임";
  assert.deepEqual(getNotificationCopy("mention", actorName), {
    actorName,
    action: " mentioned you",
  });
});
