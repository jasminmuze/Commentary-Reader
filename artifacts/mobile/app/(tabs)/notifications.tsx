import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetNotifications,
  useMarkNotificationsRead,
  useMarkNotificationRead,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useAcceptRoomInvite,
  useDeclineRoomInvite,
  getGetNotificationsQueryKey,
  getGetUserProfileQueryKey,
  getGetFriendsQueryKey,
  getGetRoomQueryKey,
  getGetMyRoomsQueryKey,
  getComment,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { CommentSheet } from "@/components/CommentSheet";
import { canUseNativeReader, navigateToQuote } from "@/lib/quoteNavigation";
import { getNotificationCopy } from "@/lib/notificationCopy";
import type { Comment, NotificationItem } from "@workspace/api-client-react";

function timeAgo(dateStr: string | Date): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function NotificationCard({
  item,
  onPress,
  onAccept,
  onDecline,
  onViewInBook,
  friendActionPending,
}: {
  item: NotificationItem;
  onPress: (item: NotificationItem) => void;
  onAccept: (item: NotificationItem) => void;
  onDecline: (item: NotificationItem) => void;
  onViewInBook?: (item: NotificationItem) => void;
  friendActionPending: boolean;
}) {
  const colors = useColors();
  const isFriendRequest = item.type === "friend_request";
  const isFriendAccept = item.type === "friend_accept";
  const isRoomInvite = item.type === "room_invite";
  const notificationCopy = getNotificationCopy(
    item.type,
    item.actorNickname?.trim() || item.actorUsername,
  );
  const showViewInBook =
    !!onViewInBook && !isFriendRequest && !isFriendAccept && !isRoomInvite && !!item.quoteId;

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: item.read ? colors.background : colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.cardRow}>
        <View style={styles.avatarWrap}>
          <UserAvatar
            username={item.actorUsername}
            nickname={item.actorNickname}
            avatarUrl={item.actorAvatarUrl}
            avatarColor={item.actorAvatarColor}
            size={36}
          />
          {!item.read ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>

        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            <Text style={styles.bold}>{notificationCopy.actorName}</Text>
            {notificationCopy.action}
          </Text>

          {item.commentText ? (
            item.commentContainsSpoilers ? (
              // Server sets this only when the viewer isn't the comment author.
              // Tapping the notification opens the comment sheet, where the
              // spoiler can be revealed explicitly.
              <View style={[styles.preview, { borderLeftColor: colors.primary }]}>
                <View style={styles.spoilerRow}>
                  <Feather name="eye-off" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.spoilerText, { color: colors.mutedForeground }]}>
                    Spoiler
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.preview, { borderLeftColor: colors.primary }]}>
                <Text
                  style={[styles.previewText, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {item.commentText}
                </Text>
              </View>
            )
          ) : null}

          {item.quoteText ? (
            <Text
              style={[styles.quoteLabel, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              on "{item.quoteText}"
            </Text>
          ) : null}

          {isRoomInvite && item.roomName ? (
            <View style={[styles.preview, { borderLeftColor: colors.primary }]}>
              <Text
                style={[styles.previewText, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {item.roomName}
              </Text>
            </View>
          ) : null}

          {showViewInBook ? (
            <Pressable
              onPress={() => onViewInBook!(item)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.viewInBookBtn,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="book-open" size={13} color={colors.primary} />
              <Text style={[styles.viewInBookText, { color: colors.primary }]}>
                View in book
              </Text>
            </Pressable>
          ) : null}

          {(isFriendRequest || isRoomInvite) && !item.read ? (
            <View style={styles.friendActions}>
              <Pressable
                onPress={() => onAccept(item)}
                disabled={friendActionPending}
                style={({ pressed }) => [
                  styles.friendBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed || friendActionPending ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.friendBtnText, { color: colors.primaryForeground }]}>
                  Accept
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onDecline(item)}
                disabled={friendActionPending}
                style={({ pressed }) => [
                  styles.friendBtn,
                  {
                    backgroundColor: colors.muted,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed || friendActionPending ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.friendBtnText, { color: colors.mutedForeground }]}>
                  Decline
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {timeAgo(item.createdAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const userId = user?.id ?? 0;

  const { data, isLoading, refetch, isRefetching } = useGetNotifications(
    userId,
    {
      query: {
        enabled: !!userId,
        queryKey: getGetNotificationsQueryKey(userId),
      },
    },
  );

  const markRead = useMarkNotificationsRead();
  const markOneRead = useMarkNotificationRead();
  const acceptFriendRequest = useAcceptFriendRequest();
  const declineFriendRequest = useDeclineFriendRequest();
  const acceptRoomInvite = useAcceptRoomInvite();
  const declineRoomInvite = useDeclineRoomInvite();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetQuote, setSheetQuote] = useState<{ id: number; text: string } | null>(null);
  const [sheetThread, setSheetThread] = useState<Comment | null>(null);

  const markItemRead = useCallback(
    (item: NotificationItem) => {
      if (item.read) return;
      markOneRead.mutate(
        { notificationId: item.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetNotificationsQueryKey(userId),
            });
          },
        },
      );
    },
    [markOneRead, queryClient, userId],
  );

  // Default behavior: open the comment sheet for the quote the notification points to.
  const openCommentSheetFor = useCallback(async (item: NotificationItem) => {
    // The referenced comment was deleted — nothing to navigate to.
    if (!item.quoteId) {
      Alert.alert("Can't open this", "The original comment was deleted.");
      return;
    }

    // Reply/thread notifications open the parent comment's reply thread.
    if (item.parentCommentId) {
      try {
        const parent = await getComment(item.parentCommentId);
        setSheetThread(parent);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          Alert.alert("Can't open this", "This comment was deleted or isn't available.");
        } else {
          Alert.alert("Can't open this", "Couldn't load the comment. Please try again in a moment.");
        }
        return;
      }
    } else {
      setSheetThread(null);
    }

    setSheetQuote({ id: item.quoteId, text: item.quoteText ?? "" });
    setSheetVisible(true);
  }, []);

  const handleNotificationPress = useCallback(
    async (item: NotificationItem) => {
      // Room invites navigate to the room page WITHOUT marking the
      // notification read — the card stays actionable until the invite is
      // actually accepted/declined (the server resolves it then). The room
      // page itself also offers accept/decline as a fallback.
      if (item.type === "room_invite") {
        if (item.roomId) router.push(`/room/${item.roomId}`);
        return;
      }

      // Mark this notification as read (best-effort).
      markItemRead(item);

      // Friend notifications navigate to the actor's profile.
      if (item.type === "friend_request" || item.type === "friend_accept") {
        router.push(`/user/${item.actorId}`);
        return;
      }

      await openCommentSheetFor(item);
    },
    [markItemRead, openCommentSheetFor],
  );

  // "View in book": if the book is in the library, open the reader deep-linked to the
  // passage; if it isn't in the library or the attempt fails, fall back to the comment sheet.
  const handleViewInBook = useCallback(
    (item: NotificationItem) => {
      markItemRead(item);
      if (!item.quoteId) {
        Alert.alert("Can't open this", "The original comment was deleted.");
        return;
      }
      navigateToQuote(item.quoteId, {
        onFallback: () => {
          void openCommentSheetFor(item);
        },
      }).catch(() => {
        void openCommentSheetFor(item);
      });
    },
    [markItemRead, openCommentSheetFor],
  );

  const invalidateNotifications = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getGetNotificationsQueryKey(userId),
    });
  }, [queryClient, userId]);

  // Accept/decline also changes the requester's profile status and (on
  // accept) the friends list — refresh those caches too.
  const invalidateFriendState = useCallback(
    (actorId: number) => {
      invalidateNotifications();
      queryClient.invalidateQueries({
        queryKey: getGetUserProfileQueryKey(actorId),
      });
      if (userId) {
        queryClient.invalidateQueries({
          queryKey: getGetFriendsQueryKey(userId),
        });
      }
    },
    [invalidateNotifications, queryClient, userId],
  );

  // Accept/decline a room invite; refresh room caches on top of notifications.
  const invalidateRoomState = useCallback(
    (roomId: number) => {
      invalidateNotifications();
      queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getGetMyRoomsQueryKey() });
    },
    [invalidateNotifications, queryClient],
  );

  const handleAcceptRoomInvite = useCallback(
    (item: NotificationItem) => {
      if (!item.roomId) return;
      const roomId = item.roomId;
      acceptRoomInvite.mutate(
        { roomId },
        {
          onSuccess: () => {
            invalidateRoomState(roomId);
            router.push(`/room/${roomId}`);
          },
          onError: (err) => {
            if (err instanceof ApiError && err.status === 404) {
              Alert.alert("Invite unavailable", "This invite was withdrawn or the room no longer exists.");
            } else {
              Alert.alert("Error", "Couldn't accept the invite. Please try again in a moment.");
            }
            invalidateRoomState(roomId);
          },
        },
      );
    },
    [acceptRoomInvite, invalidateRoomState],
  );

  const handleDeclineRoomInvite = useCallback(
    (item: NotificationItem) => {
      if (!item.roomId) return;
      const roomId = item.roomId;
      declineRoomInvite.mutate(
        { roomId },
        {
          onSuccess: () => invalidateRoomState(roomId),
          onError: (err) => {
            if (err instanceof ApiError && err.status === 404) {
              Alert.alert("Invite unavailable", "This invite was withdrawn or the room no longer exists.");
            } else {
              Alert.alert("Error", "Couldn't decline the invite. Please try again in a moment.");
            }
            invalidateRoomState(roomId);
          },
        },
      );
    },
    [declineRoomInvite, invalidateRoomState],
  );

  const handleAcceptFriendRequest = useCallback(
    (item: NotificationItem) => {
      acceptFriendRequest.mutate(
        { requesterId: item.actorId },
        {
          onSuccess: () => invalidateFriendState(item.actorId),
          onError: (err) => {
            if (err instanceof ApiError && err.status === 404) {
              Alert.alert("Request already handled", "This request was canceled or has already been handled.");
            } else {
              Alert.alert("Error", "Couldn't accept the request. Please try again in a moment.");
            }
            invalidateFriendState(item.actorId);
          },
        },
      );
    },
    [acceptFriendRequest, invalidateFriendState],
  );

  const handleDeclineFriendRequest = useCallback(
    (item: NotificationItem) => {
      declineFriendRequest.mutate(
        { requesterId: item.actorId },
        {
          onSuccess: () => invalidateFriendState(item.actorId),
          onError: (err) => {
            if (err instanceof ApiError && err.status === 404) {
              Alert.alert("Request already handled", "This request was canceled or has already been handled.");
            } else {
              Alert.alert("Error", "Couldn't decline the request. Please try again in a moment.");
            }
            invalidateFriendState(item.actorId);
          },
        },
      );
    },
    [declineFriendRequest, invalidateFriendState],
  );

  const handleMarkAllRead = useCallback(() => {
    if (!userId) return;
    markRead.mutate(
      { userId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetNotificationsQueryKey(userId),
          });
        },
      },
    );
  }, [userId, markRead, queryClient]);

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Notifications
          {unreadCount > 0 ? (
            <Text style={[styles.badge, { color: colors.primary }]}>
              {" "}
              {unreadCount}
            </Text>
          ) : null}
        </Text>
        {unreadCount > 0 ? (
          <Pressable
            onPress={handleMarkAllRead}
            style={({ pressed }) => [styles.markBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="check-circle" size={16} color={colors.primary} />
            <Text style={[styles.markBtnText, { color: colors.primary }]}>
              Mark all read
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={{ gap: 12, padding: 16 }}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={{ gap: 8 }}>
              <LoadingShimmer width="70%" height={14} />
              <LoadingShimmer width="100%" height={14} />
              <LoadingShimmer width="50%" height={11} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList<NotificationItem>
          data={notifications}
          keyExtractor={(item, index) => String(item.id ?? index)}
          renderItem={({ item }) => (
            <NotificationCard
              item={item}
              onPress={handleNotificationPress}
              onAccept={
                item.type === "room_invite" ? handleAcceptRoomInvite : handleAcceptFriendRequest
              }
              onDecline={
                item.type === "room_invite" ? handleDeclineRoomInvite : handleDeclineFriendRequest
              }
              onViewInBook={canUseNativeReader() ? handleViewInBook : undefined}
              friendActionPending={
                acceptFriendRequest.isPending ||
                declineFriendRequest.isPending ||
                acceptRoomInvite.isPending ||
                declineRoomInvite.isPending
              }
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            paddingBottom: insets.bottom + 80,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="bell"
              title="No notifications yet"
              subtitle="When someone replies to your comment or mentions you, it'll show up here"
            />
          }
        />
      )}

      <CommentSheet
        visible={sheetVisible}
        quoteId={sheetQuote?.id ?? null}
        quoteText={sheetQuote?.text ?? ""}
        initialReplyThread={sheetThread}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  badge: {
    fontWeight: "700",
  },
  markBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  markBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  card: {
    padding: 14,
    borderWidth: 1,
    marginVertical: 5,
    gap: 8,
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
  },
  avatarWrap: {
    position: "relative",
  },
  unreadDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  cardTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  bold: {
    fontWeight: "700",
  },
  preview: {
    borderLeftWidth: 2,
    paddingLeft: 8,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
  },
  spoilerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  spoilerText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  quoteLabel: {
    fontSize: 11,
  },
  friendActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  viewInBookBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  viewInBookText: {
    fontSize: 12,
    fontWeight: "700",
  },
  friendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  friendBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  timeText: {
    fontSize: 11,
  },
});
