import type { NotificationItemType } from "@workspace/api-client-react";

const notificationActionCopy: Record<NotificationItemType, string> = {
  reply: " replied to your comment",
  mention: " mentioned you",
  friend_request: " sent you a friend request",
  friend_accept: " accepted your friend request",
  highlight_like: " liked your highlight",
  comment_like: " liked your comment",
  room_invite: " invited you to a reading room",
};

/**
 * Returns the system-authored English action and the actor's display name
 * separately so the notification card can style the name without changing it.
 */
export function getNotificationCopy(
  type: NotificationItemType,
  actorName: string,
): { actorName: string; action: string } {
  return { actorName, action: notificationActionCopy[type] };
}
