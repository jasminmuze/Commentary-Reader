import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  getFeed,
  getGetFeedQueryKey,
  useGetMyRooms,
  useLikeComment,
  useLikeHighlight,
} from "@workspace/api-client-react";
import type { FeedItem, FeedPage } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { navigateToQuote } from "@/lib/quoteNavigation";
import { apiUrl } from "@/lib/api";

const PAGE_SIZE = 20;

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function FeedCard({
  item,
  onPress,
  onToggleLike,
}: {
  item: FeedItem;
  onPress: (item: FeedItem) => void;
  onToggleLike: (item: FeedItem) => void;
}) {
  const colors = useColors();
  const { user } = useUser();
  const isComment = item.type === "comment";
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  // Authors see their own spoiler comments unblurred; others tap to reveal.
  const spoilerHidden =
    isComment &&
    item.containsSpoilers &&
    user?.id !== item.userId &&
    !spoilerRevealed;

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Pressable onPress={() => router.push(`/user/${item.userId}`)} hitSlop={8}>
          <UserAvatar
            username={item.username}
            nickname={item.nickname}
            avatarUrl={item.avatarUrl}
            avatarColor={item.avatarColor}
            size={32}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerLine, { color: colors.foreground }]} numberOfLines={2}>
            <Text style={styles.username}>{item.nickname?.trim() || item.username}</Text>
            <Text style={{ color: colors.mutedForeground }}>
              {isComment
                ? " left a comment"
                : " highlighted a passage"}
            </Text>
          </Text>
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {timeAgo(item.createdAt)}
          </Text>
        </View>
        <Feather
          name={isComment ? "message-circle" : "edit-3"}
          size={16}
          color={colors.mutedForeground}
        />
      </View>

      <View style={styles.quoteRow}>
        {item.coverUrl ? (
          <Image
            source={{ uri: apiUrl(`/api${item.coverUrl}`) }}
            style={styles.coverThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.quoteBar, { backgroundColor: item.coverColor }]} />
        )}
        <Text style={[styles.quoteText, { color: colors.foreground }]} numberOfLines={5}>
          {item.quoteText}
        </Text>
      </View>

      {isComment && item.commentText ? (
        spoilerHidden ? (
          <Pressable
            onPress={() => setSpoilerRevealed(true)}
            style={[
              styles.spoilerCover,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Spoiler — tap to reveal"
          >
            <Feather name="eye-off" size={14} color={colors.mutedForeground} />
            <Text style={[styles.spoilerCoverText, { color: colors.mutedForeground }]}>
              Spoiler — tap to reveal
            </Text>
          </Pressable>
        ) : (
          <View style={styles.commentRow}>
            {item.containsSpoilers ? (
              <View
                style={[
                  styles.spoilerBadge,
                  { backgroundColor: colors.muted, borderRadius: colors.radius },
                ]}
              >
                <Feather name="alert-triangle" size={10} color={colors.mutedForeground} />
                <Text style={[styles.spoilerBadgeText, { color: colors.mutedForeground }]}>
                  Spoiler
                </Text>
              </View>
            ) : null}
            <Text
              style={[styles.commentText, { color: colors.foreground, flex: 1 }]}
              numberOfLines={3}
            >
              {item.commentText}
            </Text>
          </View>
        )
      ) : null}

      <View style={styles.cardFooter}>
        <Text
          style={[styles.bookMeta, { color: colors.mutedForeground, flex: 1 }]}
          numberOfLines={1}
        >
          {item.bookTitle} · {item.bookAuthor}
        </Text>
        <Pressable
          onPress={() => onToggleLike(item)}
          hitSlop={10}
          style={({ pressed }) => [styles.likeButton, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={item.likedByMe ? "Unlike" : "Like"}
        >
          <Feather
            name="heart"
            size={16}
            color={item.likedByMe ? colors.primary : colors.mutedForeground}
          />
          {item.likeCount > 0 ? (
            <Text
              style={[
                styles.likeCount,
                {
                  color: item.likedByMe ? colors.primary : colors.mutedForeground,
                  fontWeight: item.likedByMe ? "700" : "500",
                },
              ]}
            >
              {item.likeCount}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();

  // Per-room filter: null = everyone I follow, a number = that room only.
  const [roomFilter, setRoomFilter] = useState<number | null>(null);
  const { data: myRooms } = useGetMyRooms();

  const feedParams =
    roomFilter === null
      ? { limit: PAGE_SIZE }
      : { limit: PAGE_SIZE, roomId: roomFilter };

  // Must match the infinite query key below (scoped by user id + room filter).
  const feedQueryKey = useMemo(
    () => [...getGetFeedQueryKey(feedParams), "infinite", user?.id ?? 0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomFilter, user?.id],
  );

  const {
    data,
    isLoading,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    // Scoped by user id so a different account never sees a cached feed.
    queryKey: [
      ...getGetFeedQueryKey(feedParams),
      "infinite",
      user?.id ?? 0,
    ],
    queryFn: ({ pageParam, signal }) =>
      getFeed(
        pageParam ? { ...feedParams, cursor: pageParam } : feedParams,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!user,
  });

  const items: FeedItem[] = data?.pages.flatMap((p) => p.items) ?? [];

  // Patches one feed item across all cached pages.
  const patchFeedItem = useCallback(
    (
      type: FeedItem["type"],
      id: number,
      patch: (item: FeedItem) => FeedItem,
    ) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        feedQueryKey,
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((it) =>
                it.type === type && it.id === id ? patch(it) : it,
              ),
            })),
          },
      );
    },
    [queryClient, feedQueryKey],
  );

  const likeHighlight = useLikeHighlight();
  const likeComment = useLikeComment();

  const handleToggleLike = useCallback(
    (item: FeedItem) => {
      // Optimistic toggle; reconciled with the server result (or reverted) below.
      const wasLiked = item.likedByMe;
      patchFeedItem(item.type, item.id, (it) => ({
        ...it,
        likedByMe: !wasLiked,
        likeCount: Math.max(0, it.likeCount + (wasLiked ? -1 : 1)),
      }));

      const revert = () =>
        patchFeedItem(item.type, item.id, (it) => ({
          ...it,
          likedByMe: wasLiked,
          likeCount: Math.max(0, it.likeCount + (wasLiked ? 1 : -1)),
        }));
      const reconcile = (result: { liked: boolean; likeCount: number }) =>
        patchFeedItem(item.type, item.id, (it) => ({
          ...it,
          likedByMe: result.liked,
          likeCount: result.likeCount,
        }));

      if (item.type === "highlight") {
        likeHighlight.mutate(
          { highlightId: item.id },
          { onSuccess: reconcile, onError: revert },
        );
      } else {
        likeComment.mutate(
          { commentId: item.id },
          { onSuccess: reconcile, onError: revert },
        );
      }
    },
    [patchFeedItem, likeHighlight, likeComment],
  );

  const handleOpen = useCallback((item: FeedItem) => {
    navigateToQuote(item.quoteId, {
      onFallback: () => router.push(`/book/${item.bookId}`),
    }).catch(() => {
      Alert.alert(
        "Can't open this",
        "Couldn't load the passage. Please try again in a moment.",
      );
    });
  }, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Feed</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Highlights and comments from people you follow
        </Text>
        {myRooms && myRooms.length > 0 ? (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[{ id: null as number | null, name: "All" }, ...myRooms.map((r) => ({ id: r.id as number | null, name: r.name }))]}
            keyExtractor={(chip) => String(chip.id ?? "all")}
            style={styles.chipRow}
            contentContainerStyle={styles.chipRowContent}
            renderItem={({ item: chip }) => {
              const active = roomFilter === chip.id;
              return (
                <Pressable
                  onPress={() => setRoomFilter(chip.id)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {chip.name}
                  </Text>
                </Pressable>
              );
            }}
          />
        ) : null}
      </View>

      <FlatList<FeedItem>
        data={items}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderItem={({ item }) => (
          <FeedCard item={item} onPress={handleOpen} onToggleLike={handleToggleLike} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ gap: 12, paddingTop: 20 }}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={{ marginHorizontal: 16, gap: 8 }}>
                  <LoadingShimmer width="40%" height={14} />
                  <LoadingShimmer width="100%" height={14} />
                  <LoadingShimmer width="80%" height={14} />
                </View>
              ))}
            </View>
          ) : roomFilter !== null ? (
            <EmptyState
              icon="users"
              title="No activity in this room yet"
              subtitle="Highlights and comments shared in this room will appear here"
            />
          ) : (
            <EmptyState
              icon="users"
              title="Your feed is empty"
              subtitle="Follow friends to see their highlights and comments here"
            />
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator
              style={{ marginVertical: 16 }}
              color={colors.primary}
            />
          ) : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isFetchingNextPage}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
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
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 2 },
  chipRow: { marginTop: 12, marginHorizontal: -20 },
  chipRowContent: { paddingHorizontal: 20, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 180,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  list: { paddingTop: 12, flexGrow: 1 },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerLine: { fontSize: 13, lineHeight: 18 },
  username: { fontWeight: "700" },
  timeText: { fontSize: 11, marginTop: 1 },
  quoteRow: {
    flexDirection: "row",
    gap: 10,
  },
  quoteBar: {
    width: 3,
    borderRadius: 2,
    alignSelf: "stretch",
    minHeight: 20,
  },
  coverThumb: {
    width: 26,
    height: 38,
    borderRadius: 3,
  },
  quoteText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: "italic",
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  spoilerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 2,
  },
  spoilerBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  spoilerCover: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  spoilerCoverText: {
    fontSize: 13,
    fontWeight: "600",
  },
  bookMeta: {
    fontSize: 12,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  likeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  likeCount: {
    fontSize: 12,
  },
});
