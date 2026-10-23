import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserProfile,
  useGetUserRooms,
  useAddFriend,
  useRemoveFriend,
  useSendFriendRequest,
  useAcceptFriendRequest,
  getGetUserProfileQueryKey,
  getGetUserRoomsQueryKey,
  getGetFriendsQueryKey,
  getGetNotificationsQueryKey,
} from "@workspace/api-client-react";
import type { UserPublicActivityItem } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";

function activityDateLabel(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PublicActivityCard({
  item,
  isAuthor,
}: {
  item: UserPublicActivityItem;
  isAuthor: boolean;
}) {
  const colors = useColors();
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const isComment = item.kind === "comment";
  const isSpoiler = isComment && item.containsSpoilers === true;
  const spoilerHidden = isSpoiler && !isAuthor && !spoilerRevealed;

  return (
    <View
      style={[
        styles.activityCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius + 4,
        },
      ]}
    >
      <View style={styles.activityHeader}>
        <View
          style={[
            styles.activityKind,
            {
              backgroundColor: isComment ? colors.muted : `${colors.primary}18`,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Feather
            name={isComment ? "message-circle" : "bookmark"}
            size={12}
            color={isComment ? colors.mutedForeground : colors.primary}
          />
          <Text
            style={[
              styles.activityKindText,
              { color: isComment ? colors.mutedForeground : colors.primary },
            ]}
          >
            {isComment ? "COMMENT" : "HIGHLIGHT"}
          </Text>
        </View>
        <Text style={[styles.activityDate, { color: colors.mutedForeground }]}>
          {activityDateLabel(item.createdAt)}
        </Text>
      </View>

      <View style={styles.activityBook}>
        <View
          style={[
            styles.activityBookMark,
            { backgroundColor: item.coverColor || colors.primary },
          ]}
        />
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.activityBookTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {item.bookTitle}
          </Text>
          <Text
            style={[styles.activityBookAuthor, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {item.bookAuthor}
          </Text>
        </View>
      </View>

      {spoilerHidden ? (
        <Pressable
          onPress={() => setSpoilerRevealed(true)}
          style={[
            styles.activitySpoiler,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Spoiler — tap to reveal"
        >
          <Feather name="eye-off" size={15} color={colors.mutedForeground} />
          <Text style={[styles.activitySpoilerText, { color: colors.mutedForeground }]}>
            Spoiler — tap to reveal
          </Text>
        </Pressable>
      ) : (
        <View
          style={[
            styles.activityTextBlock,
            {
              backgroundColor: colors.background,
              borderLeftColor: isComment ? colors.border : colors.primary,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text
            style={[
              styles.activityMainText,
              {
                color: colors.foreground,
                fontStyle: isComment ? "normal" : "italic",
              },
            ]}
            numberOfLines={isComment ? 3 : 4}
          >
            {isComment ? item.commentText : `“${item.quoteText}”`}
          </Text>
          {isComment ? (
            <Text
              style={[styles.activityContext, { color: colors.mutedForeground }]}
              numberOfLines={2}
            >
              On “{item.quoteText}”
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

export default function UserProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const profileId = Number(params.id);
  const validId = Number.isFinite(profileId) && profileId > 0;

  const { data: profile, isLoading } = useGetUserProfile(profileId, {
    query: {
      enabled: validId,
      queryKey: getGetUserProfileQueryKey(profileId),
    },
  });

  const { data: userRooms } = useGetUserRooms(profileId, {
    query: {
      enabled: validId,
      queryKey: getGetUserRoomsQueryKey(profileId),
    },
  });

  const addFriend = useAddFriend();
  const removeFriend = useRemoveFriend();
  const sendFriendRequest = useSendFriendRequest();
  const acceptFriendRequest = useAcceptFriendRequest();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey(profileId) });
    if (user) {
      queryClient.invalidateQueries({ queryKey: getGetFriendsQueryKey(user.id) });
      queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey(user.id) });
    }
  }, [queryClient, profileId, user]);

  const handleToggleFollow = useCallback(() => {
    if (!user || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (profile.isFollowedByMe) {
      removeFriend.mutate({ userId: user.id, friendId: profile.id }, { onSuccess: invalidate });
    } else {
      addFriend.mutate({ userId: user.id, data: { friendId: profile.id } }, { onSuccess: invalidate });
    }
  }, [user, profile, addFriend, removeFriend, invalidate]);

  const handleFriendAction = useCallback(() => {
    if (!user || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (profile.friendStatus === "none") {
      sendFriendRequest.mutate(
        { data: { recipientId: profile.id } },
        { onSuccess: invalidate },
      );
    } else if (profile.friendStatus === "incoming") {
      acceptFriendRequest.mutate(
        { requesterId: profile.id },
        { onSuccess: invalidate, onError: invalidate },
      );
    }
  }, [user, profile, sendFriendRequest, acceptFriendRequest, invalidate]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const followPending = addFriend.isPending || removeFriend.isPending;
  const friendPending = sendFriendRequest.isPending || acceptFriendRequest.isPending;

  const Header = (
    <View style={[styles.navBar, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
      <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.navTitle, { color: colors.foreground }]}>Profile</Text>
      <View style={styles.backBtn} />
    </View>
  );

  if (!validId || (!isLoading && !profile)) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.center}>
          <Feather name="user-x" size={40} color={colors.mutedForeground} />
          <Text style={[styles.notFound, { color: colors.mutedForeground }]}>
            We couldn't find this user.
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading || !profile) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {Header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });

  const followLabel = profile.isFollowedByMe
    ? "Following"
    : profile.followsMe
      ? "Follow back"
      : "Follow";

  const friendStatus = profile.friendStatus;
  const friendLabel =
    friendStatus === "friends"
      ? "Friends"
      : friendStatus === "requested"
        ? "Requested"
        : friendStatus === "incoming"
          ? "Accept request"
          : "Add friend";
  const friendIcon: React.ComponentProps<typeof Feather>["name"] =
    friendStatus === "friends"
      ? "check"
      : friendStatus === "requested"
        ? "clock"
        : friendStatus === "incoming"
          ? "user-check"
          : "users";
  const friendDisabled =
    friendPending || friendStatus === "friends" || friendStatus === "requested";
  // Filled style when actionable, muted when resolved/pending.
  const friendActive = friendStatus === "none" || friendStatus === "incoming";

  const stats: { label: string; value: number }[] = [
    { label: "Followers", value: profile.followerCount },
    { label: "Following", value: profile.followingCount },
    { label: "Highlights", value: profile.highlightCount },
    { label: "Comments", value: profile.commentCount },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {Header}
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <UserAvatar
            username={profile.username}
            nickname={profile.nickname}
            avatarUrl={profile.avatarUrl}
            avatarColor={profile.avatarColor}
            size={88}
          />
          <Text style={[styles.name, { color: colors.foreground }]}>
            {profile.nickname?.trim() || profile.username}
          </Text>
          <Text style={[styles.since, { color: colors.mutedForeground }]}>
            @{profile.username}
          </Text>
          <Text style={[styles.since, { color: colors.mutedForeground }]}>
            Reading along since {memberSince}
          </Text>
          {profile.followsMe && !profile.isMe ? (
            <View style={[styles.followsBadge, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
              <Text style={[styles.followsBadgeText, { color: colors.mutedForeground }]}>Follows you</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.statsRow, { borderColor: colors.border }]}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statBlock}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {!profile.isMe ? (
          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: profile.isFollowedByMe ? colors.muted : colors.primary,
                  borderColor: profile.isFollowedByMe ? colors.border : colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed || followPending ? 0.8 : 1,
                },
              ]}
              onPress={handleToggleFollow}
              disabled={followPending}
            >
              {followPending ? (
                <ActivityIndicator color={profile.isFollowedByMe ? colors.mutedForeground : colors.primaryForeground} />
              ) : (
                <>
                  <Feather
                    name={profile.isFollowedByMe ? "user-check" : "user-plus"}
                    size={16}
                    color={profile.isFollowedByMe ? colors.mutedForeground : colors.primaryForeground}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      { color: profile.isFollowedByMe ? colors.mutedForeground : colors.primaryForeground },
                    ]}
                  >
                    {followLabel}
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: friendActive ? colors.card : colors.muted,
                  borderColor: friendActive ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed || friendPending ? 0.8 : 1,
                },
              ]}
              onPress={handleFriendAction}
              disabled={friendDisabled}
            >
              {friendPending ? (
                <ActivityIndicator color={colors.mutedForeground} />
              ) : (
                <>
                  <Feather
                    name={friendIcon}
                    size={16}
                    color={friendActive ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      { color: friendActive ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {friendLabel}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.activitySection}>
          <View style={styles.activitySectionHeader}>
            <View>
              <Text style={[styles.activitySectionTitle, { color: colors.foreground }]}>
                Recent public activity
              </Text>
              <Text style={[styles.activitySectionSubtitle, { color: colors.mutedForeground }]}>
                Highlights and conversation starters
              </Text>
            </View>
            {profile.recentActivity.length > 0 ? (
              <View
                style={[
                  styles.activityCount,
                  { backgroundColor: colors.muted, borderRadius: colors.radius },
                ]}
              >
                <Text style={[styles.activityCountText, { color: colors.mutedForeground }]}>
                  {profile.recentActivity.length}
                </Text>
              </View>
            ) : null}
          </View>

          {profile.recentActivity.length > 0 ? (
            <View style={styles.activityList}>
              {profile.recentActivity.map((item) => (
                <PublicActivityCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  isAuthor={profile.isMe}
                />
              ))}
            </View>
          ) : (
            <View
              style={[
                styles.activityEmpty,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius + 4,
                },
              ]}
            >
              <View style={[styles.activityEmptyIcon, { backgroundColor: colors.muted }]}>
                <Feather name="book-open" size={18} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.activityEmptyTitle, { color: colors.foreground }]}>
                {profile.isMe ? "Your reading story starts here" : "Their reading story starts here"}
              </Text>
              <Text style={[styles.activityEmptyBody, { color: colors.mutedForeground }]}>
                Public highlights and comments will show up as they read.
              </Text>
            </View>
          )}
        </View>

        {/* Rooms section — only show if the user belongs to any public rooms */}
        {userRooms && userRooms.length > 0 ? (
          <View style={styles.roomsSection}>
            <Text style={[styles.roomsSectionTitle, { color: colors.mutedForeground }]}>
              READING ROOMS
            </Text>
            {userRooms.map((room) => (
              <Pressable
                key={room.id}
                onPress={() => router.push(`/room/${room.id}`)}
                style={({ pressed }) => [
                  styles.roomRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.roomDot, { backgroundColor: room.coverColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.roomName, { color: colors.foreground }]} numberOfLines={1}>
                    {room.name}
                  </Text>
                  <Text style={[styles.roomBook, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {room.bookTitle}
                  </Text>
                </View>
                <Text style={[styles.roomCount, { color: colors.mutedForeground }]}>
                  {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
                </Text>
                <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  notFound: {
    fontSize: 14,
    textAlign: "center",
  },
  profileSection: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 8,
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  since: {
    fontSize: 13,
  },
  followsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  followsBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  statBlock: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 24,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  activitySection: {
    marginHorizontal: 16,
    marginTop: 30,
    gap: 14,
  },
  activitySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activitySectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  activitySectionSubtitle: {
    fontSize: 12,
    marginTop: 4,
  },
  activityCount: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  activityCountText: {
    fontSize: 12,
    fontWeight: "700",
  },
  activityList: {
    gap: 10,
  },
  activityCard: {
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activityKind: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  activityKindText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.55,
  },
  activityDate: {
    fontSize: 11,
  },
  activityBook: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  activityBookMark: {
    width: 4,
    height: 32,
    borderRadius: 2,
  },
  activityBookTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  activityBookAuthor: {
    fontSize: 11,
    marginTop: 2,
  },
  activityTextBlock: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderLeftWidth: 2,
    gap: 8,
  },
  activityMainText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  activityContext: {
    fontSize: 11,
    lineHeight: 16,
  },
  activitySpoiler: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
  },
  activitySpoilerText: {
    fontSize: 12,
    fontWeight: "600",
  },
  activityEmpty: {
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: "center",
  },
  activityEmptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  activityEmptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  activityEmptyBody: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 5,
    maxWidth: 250,
  },
  roomsSection: {
    marginHorizontal: 16,
    marginTop: 28,
    gap: 8,
  },
  roomsSectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  roomDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  roomName: {
    fontSize: 14,
    fontWeight: "600",
  },
  roomBook: {
    fontSize: 12,
    marginTop: 2,
  },
  roomCount: {
    fontSize: 12,
  },
});
