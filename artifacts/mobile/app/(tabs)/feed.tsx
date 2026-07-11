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
import { useInfiniteQuery } from "@tanstack/react-query";
import { getFeed, getGetFeedQueryKey } from "@workspace/api-client-react";
import type { FeedItem } from "@workspace/api-client-react";
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
}: {
  item: FeedItem;
  onPress: (item: FeedItem) => void;
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

      <Text style={[styles.bookMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
        {item.bookTitle} · {item.bookAuthor}
      </Text>
    </Pressable>
  );
}

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();

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
        renderItem={({ item }) => <FeedCard item={item} onPress={handleOpen} />}
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
});
