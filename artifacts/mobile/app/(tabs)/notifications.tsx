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
  getGetNotificationsQueryKey,
  getGetUserProfileQueryKey,
  getGetFriendsQueryKey,
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
import type { Comment, NotificationItem } from "@workspace/api-client-react";

function timeAgo(dateStr: string | Date): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "방금 전";
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}일 전`;
  return `${Math.floor(diffDays / 30)}개월 전`;
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
  const isReply = item.type === "reply";
  const isFriendRequest = item.type === "friend_request";
  const isFriendAccept = item.type === "friend_accept";
  const showViewInBook =
    !!onViewInBook && !isFriendRequest && !isFriendAccept && !!item.quoteId;

  const title = isReply
    ? "님이 내 댓글에 답글을 남겼어요"
    : isFriendRequest
      ? "님이 친구 요청을 보냈어요"
      : isFriendAccept
        ? "님이 친구 요청을 수락했어요"
        : "님이 나를 멘션했어요";

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
            avatarColor={item.actorAvatarColor}
            size={36}
          />
          {!item.read ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>

        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            <Text style={styles.bold}>{item.actorUsername}</Text>
            {title}
          </Text>

          {item.commentText ? (
            <View style={[styles.preview, { borderLeftColor: colors.primary }]}>
              <Text
                style={[styles.previewText, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                {item.commentText}
              </Text>
            </View>
          ) : null}

          {item.quoteText ? (
            <Text
              style={[styles.quoteLabel, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              "{item.quoteText}" 문장에서
            </Text>
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
                책에서 보기
              </Text>
            </Pressable>
          ) : null}

          {isFriendRequest && !item.read ? (
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
                  수락
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
                  거절
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

  // 기존 동작: 알림이 가리키는 인용의 댓글 시트를 연다.
  const openCommentSheetFor = useCallback(async (item: NotificationItem) => {
    // The referenced comment was deleted — nothing to navigate to.
    if (!item.quoteId) {
      Alert.alert("이동할 수 없어요", "원본 댓글이 삭제되었어요.");
      return;
    }

    // Reply/thread notifications open the parent comment's reply thread.
    if (item.parentCommentId) {
      try {
        const parent = await getComment(item.parentCommentId);
        setSheetThread(parent);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          Alert.alert("이동할 수 없어요", "댓글이 삭제되었거나 볼 수 없는 댓글이에요.");
        } else {
          Alert.alert("이동할 수 없어요", "댓글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
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

  // "책에서 보기": 책이 내 서재에 있으면 리더를 해당 문장 딥링크로 열고,
  // 서재에 없거나 실패하면 기존 댓글 시트 동작으로 폴백한다.
  const handleViewInBook = useCallback(
    (item: NotificationItem) => {
      markItemRead(item);
      if (!item.quoteId) {
        Alert.alert("이동할 수 없어요", "원본 댓글이 삭제되었어요.");
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

  const handleAcceptFriendRequest = useCallback(
    (item: NotificationItem) => {
      acceptFriendRequest.mutate(
        { requesterId: item.actorId },
        {
          onSuccess: () => invalidateFriendState(item.actorId),
          onError: (err) => {
            if (err instanceof ApiError && err.status === 404) {
              Alert.alert("이미 처리된 요청이에요", "요청이 취소되었거나 이미 처리되었어요.");
            } else {
              Alert.alert("오류", "요청을 수락하지 못했어요. 잠시 후 다시 시도해 주세요.");
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
              Alert.alert("이미 처리된 요청이에요", "요청이 취소되었거나 이미 처리되었어요.");
            } else {
              Alert.alert("오류", "요청을 거절하지 못했어요. 잠시 후 다시 시도해 주세요.");
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
          알림
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
              모두 읽음
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
              onAccept={handleAcceptFriendRequest}
              onDecline={handleDeclineFriendRequest}
              onViewInBook={canUseNativeReader() ? handleViewInBook : undefined}
              friendActionPending={
                acceptFriendRequest.isPending || declineFriendRequest.isPending
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
              title="알림이 없어요"
              subtitle="누군가 내 댓글에 답글을 남기거나 나를 멘션하면 여기에 표시돼요"
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
