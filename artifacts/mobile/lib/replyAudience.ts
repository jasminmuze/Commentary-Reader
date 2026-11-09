/**
 * A room used to VIEW a conversation does not change the parent's scope.
 * Only an explicitly room-scoped parent supports members-only replies.
 */
export function getReplyAudience(
  parentRoomId: number | null | undefined,
  defaultVisibility: "public" | "friends" | "private" = "public",
): { roomId: number | null; visibility: "public" | "friends" | "private" | "room" } {
  const roomId = parentRoomId ?? null;
  return { roomId, visibility: roomId !== null ? "room" : defaultVisibility };
}
