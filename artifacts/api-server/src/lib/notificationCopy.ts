/** System-authored copy used by push notifications. User content is passed through unchanged. */
export const SPOILER_PUSH_BODY =
  "This comment contains a spoiler. Open the app to view it.";

export function actorLabel(username?: string | null): string {
  return `@${username ?? "Someone"}`;
}

export function roomInvitePushCopy(
  username: string | null | undefined,
  roomName: string,
): { title: string; body: string } {
  return {
    title: `${actorLabel(username)} invited you to a reading room`,
    body: roomName,
  };
}

export function likePushCopy(
  username: string | null | undefined,
  type: "highlight_like" | "comment_like",
  previewText: string,
): { title: string; body: string } {
  return {
    title:
      type === "highlight_like"
        ? `${actorLabel(username)} liked your highlight`
        : `${actorLabel(username)} liked your comment`,
    body: previewText,
  };
}

export function mentionPushTitle(username?: string | null): string {
  return `${actorLabel(username)} mentioned you`;
}

export function replyPushTitle(username?: string | null): string {
  return `${actorLabel(username)} replied to your comment`;
}

export function friendRequestPushCopy(username?: string | null): {
  title: string;
  body: string;
} {
  return {
    title: `${actorLabel(username)} sent you a friend request`,
    body: "You can accept or decline it from your notifications.",
  };
}

export function friendAcceptPushCopy(username?: string | null): {
  title: string;
  body: string;
} {
  return {
    title: `${actorLabel(username)} accepted your friend request`,
    body: "You can now see each other's friends-only posts.",
  };
}

export function commentPushBody(
  text: string,
  containsSpoilers?: boolean,
): string {
  return containsSpoilers ? SPOILER_PUSH_BODY : text;
}
