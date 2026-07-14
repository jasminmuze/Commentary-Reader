import React, { useState, useCallback } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  useGetFriends,
  useSearchUsers,
  useAddFriend,
  useRemoveFriend,
  useSendFriendRequest,
  useAcceptFriendRequest,
  getGetFriendsQueryKey,
  getSearchUsersQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import type { User, UserWithFriendStatus } from "@workspace/api-client-react";

export default function FriendsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const { data: friends, isLoading: loadingFriends } = useGetFriends(user?.id ?? 0, {
    query: { enabled: !!user, queryKey: getGetFriendsQueryKey(user?.id ?? 0) },
  });

  const { data: searchResults, isLoading: loadingSearch } = useSearchUsers(
    { q: query },
    {
      query: {
        enabled: query.length >= 2,
        queryKey: getSearchUsersQueryKey({ q: query }),
      },
    }
  );

  const addFriend = useAddFriend();
  const removeFriend = useRemoveFriend();
  const sendFriendRequest = useSendFriendRequest();
  const acceptFriendRequest = useAcceptFriendRequest();

  // Refresh both the Following list and the current search results so
  // buttons flip to Following / Requested immediately after a press.
  const invalidateLists = useCallback(() => {
    if (!user) return;
    queryClient.invalidateQueries({ queryKey: getGetFriendsQueryKey(user.id) });
    queryClient.invalidateQueries({ queryKey: getSearchUsersQueryKey({ q: query }) });
  }, [user, queryClient, query]);

  const handleAdd = useCallback((friendId: number) => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addFriend.mutate(
      { userId: user.id, data: { friendId } },
      { onSuccess: invalidateLists }
    );
  }, [user, addFriend, invalidateLists]);

  const handleRemove = useCallback((friendId: number) => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    removeFriend.mutate(
      { userId: user.id, friendId },
      { onSuccess: invalidateLists }
    );
  }, [user, removeFriend, invalidateLists]);

  const handleFriendRequest = useCallback((targetId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    sendFriendRequest.mutate(
      { data: { recipientId: targetId } },
      { onSuccess: invalidateLists }
    );
  }, [sendFriendRequest, invalidateLists]);

  const handleAcceptRequest = useCallback((targetId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    acceptFriendRequest.mutate(
      { requesterId: targetId },
      { onSuccess: invalidateLists, onError: invalidateLists }
    );
  }, [acceptFriendRequest, invalidateLists]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const showSearch = query.length >= 2;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Friends</Text>
        <Text style={[styles.count, { color: colors.mutedForeground }]}>
          {friends?.length ?? 0} following
        </Text>
      </View>

      {/* Search bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search readers by username or nickname..."
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {showSearch ? (
        <>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SEARCH RESULTS</Text>
          <FlatList<UserWithFriendStatus>
            data={searchResults ?? []}
            keyExtractor={(item, index) => String(item.id ?? index)}
            renderItem={({ item }) => {
              const following = item.isFollowing ?? item.isFriend;
              const friendLabel =
                item.friendStatus === "friends"
                  ? "Friends"
                  : item.friendStatus === "requested"
                    ? "Requested"
                    : item.friendStatus === "incoming"
                      ? "Accept"
                      : "Friend";
              const friendDisabled =
                item.friendStatus === "friends" || item.friendStatus === "requested";
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.userRow,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => router.push(`/user/${item.id}`)}
                >
                  <UserAvatar
                    username={item.username}
                    nickname={item.nickname}
                    avatarUrl={item.avatarUrl}
                    avatarColor={item.avatarColor}
                    size={42}
                  />
                  <View style={styles.nameCol}>
                    <Text style={[styles.userName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.nickname?.trim() || item.username}
                    </Text>
                    <Text style={[styles.userHandle, { color: colors.mutedForeground }]} numberOfLines={1}>
                      @{item.username}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        backgroundColor: following ? colors.muted : colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                    onPress={() => (following ? handleRemove(item.id) : handleAdd(item.id))}
                  >
                    <Text
                      style={[
                        styles.actionBtnText,
                        { color: following ? colors.mutedForeground : colors.primaryForeground },
                      ]}
                    >
                      {following ? "Following" : "Follow"}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={friendDisabled}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        backgroundColor: friendDisabled ? colors.muted : colors.card,
                        borderWidth: friendDisabled ? 0 : 1,
                        borderColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                    onPress={() =>
                      item.friendStatus === "incoming"
                        ? handleAcceptRequest(item.id)
                        : handleFriendRequest(item.id)
                    }
                  >
                    <Text
                      style={[
                        styles.actionBtnText,
                        { color: friendDisabled ? colors.mutedForeground : colors.primary },
                      ]}
                    >
                      {friendLabel}
                    </Text>
                  </Pressable>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              loadingSearch ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              ) : (
                <EmptyState icon="search" title="No readers found" subtitle={`No one matching "${query}"`} />
              )
            }
            contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 80 }]}
          />
        </>
      ) : (
        <>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>FOLLOWING</Text>
          <FlatList<User>
            data={friends ?? []}
            keyExtractor={(item, index) => String(item.id ?? index)}
            renderItem={({ item }) => (
              <View style={[styles.userRow, { borderColor: colors.border }]}>
                <UserAvatar
                  username={item.username}
                  nickname={item.nickname}
                  avatarUrl={item.avatarUrl}
                  avatarColor={item.avatarColor}
                  size={42}
                />
                <Text style={[styles.userName, { color: colors.foreground }]}>
                  {item.nickname?.trim() || item.username}
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: colors.muted, borderRadius: colors.radius, opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => handleRemove(item.id)}
                >
                  <Text style={[styles.actionBtnText, { color: colors.mutedForeground }]}>Unfollow</Text>
                </Pressable>
              </View>
            )}
            ListEmptyComponent={
              loadingFriends ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              ) : (
                <EmptyState
                  icon="users"
                  title="No friends yet"
                  subtitle="Search for readers above to follow them and see their comments"
                />
              )
            }
            contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 80 }]}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  count: {
    fontSize: 13,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 4,
  },
  list: { flexGrow: 1 },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  userName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  nameCol: {
    flex: 1,
    gap: 1,
  },
  userHandle: {
    fontSize: 12,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
