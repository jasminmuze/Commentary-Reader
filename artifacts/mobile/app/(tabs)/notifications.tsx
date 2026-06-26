import React, { useCallback } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetNotifications,
  useMarkNotificationsRead,
  getGetNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import type { NotificationItem } from "@workspace/api-client-react";

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

function NotificationCard({ item }: { item: NotificationItem }) {
  const colors = useColors();
  const isReply = item.type === "reply";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: item.read ? colors.background : colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
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
            {isReply
              ? " replied to your comment"
              : " mentioned you in a reply"}
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
              on "{item.quoteText}"
            </Text>
          ) : null}

          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {timeAgo(item.createdAt)}
          </Text>
        </View>
      </View>
    </View>
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
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <NotificationCard item={item} />}
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
              title="No notifications"
              subtitle="When someone replies to your comment or mentions you, it will appear here"
            />
          }
        />
      )}
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
  timeText: {
    fontSize: 11,
  },
});
