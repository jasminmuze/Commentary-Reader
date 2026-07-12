import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  const isComment = item.type === "comment";

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
            avatarColor={item.avatarColor}
            size={32}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerLine, { color: colors.foreground }]} numberOfLines={2}>
            <Text style={styles.username}>{item.username}</Text>
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
        <View style={[styles.quoteBar, { backgroundColor: item.coverColor }]} />
        <Text style={[styles.quoteText, { color: colors.foreground }]} numberOfLines={5}>
          {item.quoteText}
        </Text>
      </View>

      {isComment && item.commentText ? (
        <Text style={[styles.commentText, { color: colors.foreground }]} numberOfLines={3}>
          {item.commentText}
        </Text>
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

  // Must match the infinite query key below (scoped by user id).
  const feedQueryKey = [
    ...getGetFeedQueryKey({ limit: PAGE_SIZE }),
    "infinite",
    user?.id ?? 0,
  ];

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
      ...getGetFeedQueryKey({ limit: PAGE_SIZE }),
      "infinite",
      user?.id ?? 0,
    ],
    queryFn: ({ pageParam, signal }) =>
      getFeed(
        pageParam
          ? { limit: PAGE_SIZE, cursor: pageParam }
          : { limit: PAGE_SIZE },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, user?.id],
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
