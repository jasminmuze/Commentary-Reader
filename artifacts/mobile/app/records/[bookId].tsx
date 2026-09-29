import React, { useCallback, useState } from "react";
import {
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
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserBookRecords,
  getGetUserBookRecordsQueryKey,
  useDeleteComment,
  useLikeComment,
  useSaveComment,
} from "@workspace/api-client-react";
import type {
  Comment,
  UserHighlightItem,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentCard } from "@/components/CommentCard";
import { CommentSheet } from "@/components/CommentSheet";
import { EmptyState } from "@/components/EmptyState";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { navigateToQuote } from "@/lib/quoteNavigation";

type Section = "highlights" | "comments" | "saved";

type Row =
  | { kind: "highlight"; highlight: UserHighlightItem }
  | { kind: "comment"; comment: Comment };

export default function BookRecordsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ bookId: string }>();
  const bookId = Number(params.bookId);
  const [section, setSection] = useState<Section>("highlights");
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const userId = user?.id ?? 0;
  const enabled = !!user && Number.isFinite(bookId);

  const { data, isLoading, refetch, isRefetching } = useGetUserBookRecords(
    userId,
    bookId,
    {
      query: {
        enabled,
        queryKey: getGetUserBookRecordsQueryKey(userId, bookId),
      },
    },
  );

  const likeComment = useLikeComment();
  const saveComment = useSaveComment();
  const deleteComment = useDeleteComment();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getGetUserBookRecordsQueryKey(userId, bookId),
    });
  }, [queryClient, userId, bookId]);

  const handleLike = (commentId: number) => {
    likeComment.mutate({ commentId }, { onSuccess: invalidate });
  };

  const handleSave = (commentId: number) => {
    saveComment.mutate({ commentId }, { onSuccess: invalidate });
  };

  const handleOpenQuote = useCallback((quoteId: number) => {
    navigateToQuote(quoteId).catch(() => {
      Alert.alert(
        "Can't open this",
        "Couldn't load the passage. Please try again in a moment.",
      );
    });
  }, []);

  const handleEdit = useCallback((comment: Comment) => {
    setEditingComment(comment);
    setSheetVisible(true);
  }, []);

  const handleDelete = useCallback((comment: Comment) => {
    Alert.alert(
      comment.parentId ? "Delete this reply?" : "Delete this comment?",
      comment.parentId
        ? "This can't be undone."
        : "Its replies will also be deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteComment.mutate(
              { commentId: comment.id },
              {
                onSuccess: () => queryClient.invalidateQueries(),
                onError: () => Alert.alert("Couldn't delete", "Please try again in a moment."),
              },
            ),
        },
      ],
    );
  }, [deleteComment, queryClient]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const sections: { value: Section; label: string; count: number }[] = [
    { value: "highlights", label: "Highlights", count: data?.highlights.length ?? 0 },
    { value: "comments", label: "My comments", count: data?.comments.length ?? 0 },
    { value: "saved", label: "Saved", count: data?.savedComments.length ?? 0 },
  ];

  const rows: Row[] =
    section === "highlights"
      ? (data?.highlights ?? []).map((h) => ({ kind: "highlight" as const, highlight: h }))
      : section === "comments"
        ? (data?.comments ?? []).map((c) => ({ kind: "comment" as const, comment: c }))
        : (data?.savedComments ?? []).map((c) => ({ kind: "comment" as const, comment: c }));

  const emptyCopy: Record<Section, { title: string; subtitle: string }> = {
    highlights: {
      title: "No highlights in this book yet",
      subtitle: "Select a passage in the book to create a highlight",
    },
    comments: {
      title: "No comments in this book yet",
      subtitle: "Tap a highlight to share your thoughts",
    },
    saved: {
      title: "No saved comments in this book yet",
      subtitle: "Tap the bookmark icon on a comment to save it here",
    },
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View
            style={[
              styles.cover,
              { backgroundColor: data?.book.coverColor ?? colors.muted, borderRadius: 4 },
            ]}
          >
            <Text style={styles.coverInitial}>{data?.book.title.slice(0, 1) ?? ""}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
              {data?.book.title ?? "My records"}
            </Text>
            {data ? (
              <Text style={[styles.author, { color: colors.mutedForeground }]} numberOfLines={1}>
                {data.book.author}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.chips}>
          {sections.map((s) => {
            const active = section === s.value;
            return (
              <Pressable
                key={s.value}
                onPress={() => setSection(s.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : colors.muted,
                    borderRadius: 999,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {s.label} {s.count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList<Row>
        data={rows}
        keyExtractor={(row) =>
          row.kind === "highlight" ? `h-${row.highlight.id}` : `c-${row.comment.id}`
        }
        renderItem={({ item }) =>
          item.kind === "highlight" ? (
            <Pressable
              onPress={() => handleOpenQuote(item.highlight.quoteId)}
              style={({ pressed }) => [
                styles.highlightRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View
                style={[styles.highlightBar, { backgroundColor: colors.primary + "99" }]}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.highlightText, { color: colors.foreground }]}
                  numberOfLines={5}
                >
                  {item.highlight.quoteText}
                </Text>
                <Text style={[styles.highlightMeta, { color: colors.mutedForeground }]}>
                  {new Date(item.highlight.createdAt).toLocaleDateString("en-US")}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <CommentCard
              comment={item.comment}
              onLike={handleLike}
              onSave={handleSave}
              onPress={(c) => handleOpenQuote(c.quoteId)}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ gap: 12, paddingTop: 20 }}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={{ marginHorizontal: 16, gap: 8 }}>
                  <LoadingShimmer width="60%" height={14} />
                  <LoadingShimmer width="100%" height={14} />
                  <LoadingShimmer width="80%" height={14} />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon={section === "saved" ? "bookmark" : section === "comments" ? "message-circle" : "edit-3"}
              title={emptyCopy[section].title}
              subtitle={emptyCopy[section].subtitle}
            />
          )
        }
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 40 }]}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      />
      <CommentSheet
        visible={sheetVisible}
        quoteId={editingComment?.quoteId ?? null}
        quoteText={editingComment?.quoteText ?? ""}
        initialEditingComment={editingComment}
        onClose={() => {
          setSheetVisible(false);
          setEditingComment(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    marginLeft: -4,
  },
  cover: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  coverInitial: {
    color: "#FFFFFFDD",
    fontSize: 15,
    fontWeight: "700",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  author: {
    fontSize: 12,
    marginTop: 1,
  },
  chips: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    paddingTop: 12,
    flexGrow: 1,
    gap: 0,
  },
  highlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
  },
  highlightBar: {
    width: 3,
    borderRadius: 2,
    alignSelf: "stretch",
    minHeight: 20,
  },
  highlightText: {
    fontSize: 14,
    lineHeight: 21,
  },
  highlightMeta: {
    fontSize: 12,
    marginTop: 8,
  },
});
