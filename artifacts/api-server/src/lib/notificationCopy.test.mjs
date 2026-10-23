import assert from "node:assert/strict";
import test from "node:test";
import {
  actorLabel,
  commentPushBody,
  friendAcceptPushCopy,
  friendRequestPushCopy,
  likePushCopy,
  mentionPushTitle,
  replyPushTitle,
  roomInvitePushCopy,
  SPOILER_PUSH_BODY,
} from "./notificationCopy.ts";

test("room invite, like, mention, and reply push titles use English system copy", () => {
  assert.deepEqual(roomInvitePushCopy("sora", "Night reading"), {
    title: "@sora invited you to a reading room",
    body: "Night reading",
  });
  assert.equal(
    likePushCopy("sora", "highlight_like", "A highlight").title,
    "@sora liked your highlight",
  );
  assert.equal(
    likePushCopy("sora", "comment_like", "A comment").title,
    "@sora liked your comment",
  );
  assert.equal(mentionPushTitle("sora"), "@sora mentioned you");
  assert.equal(replyPushTitle("sora"), "@sora replied to your comment");
});

test("friend request and acceptance push copy use English canned bodies", () => {
  assert.deepEqual(friendRequestPushCopy("sora"), {
    title: "@sora sent you a friend request",
    body: "You can accept or decline it from your notifications.",
  });
  assert.deepEqual(friendAcceptPushCopy("sora"), {
    title: "@sora accepted your friend request",
    body: "You can now see each other's friends-only posts.",
  });
});

test("missing actors use the English generic fallback", () => {
  assert.equal(actorLabel(null), "@Someone");
  assert.equal(
    roomInvitePushCopy(null, "Reading").title,
    "@Someone invited you to a reading room",
  );
  assert.equal(
    friendRequestPushCopy(undefined).title,
    "@Someone sent you a friend request",
  );
  assert.equal(
    friendAcceptPushCopy(undefined).title,
    "@Someone accepted your friend request",
  );
});

test("spoiler-marked mentions and replies use the spoiler-safe English body", () => {
  const spoilerText = "The ending reveals everything.";
  assert.equal(
    commentPushBody(spoilerText, true),
    "This comment contains a spoiler. Open the app to view it.",
  );
  assert.equal(SPOILER_PUSH_BODY, commentPushBody(spoilerText, true));
  assert.equal(commentPushBody(spoilerText, false), spoilerText);
  assert.equal(commentPushBody(spoilerText), spoilerText);
});

test("usernames and user-authored room and comment text are not translated", () => {
  const username = "한국어이름";
  const roomName = "한국어 방 이름";
  const comment = "사용자가 작성한 댓글";

  assert.deepEqual(roomInvitePushCopy(username, roomName), {
    title: `@${username} invited you to a reading room`,
    body: roomName,
  });
  assert.equal(
    likePushCopy(username, "comment_like", comment).body,
    comment,
  );
  assert.equal(commentPushBody(comment), comment);
});
