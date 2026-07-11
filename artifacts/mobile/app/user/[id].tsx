import React, { useCallback } from "react";
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
  useAddFriend,
  useRemoveFriend,
  useSendFriendRequest,
  useAcceptFriendRequest,
  getGetUserProfileQueryKey,
  getGetFriendsQueryKey,
  getGetNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";

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
          <UserAvatar username={profile.username} avatarColor={profile.avatarColor} size={88} />
          <Text style={[styles.name, { color: colors.foreground }]}>{profile.username}</Text>
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
});
