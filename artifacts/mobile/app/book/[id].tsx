import React, { useCallback, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBook,
  useGetBookRooms,
  useDeleteComment,
  useLikeComment,
  useSaveComment,
  getGetBookQueryKey,
  getGetBookRoomsQueryKey,
} from "@workspace/api-client-react";
import type { Comment, Quote, Room } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentSheet } from "@/components/CommentSheet";
import { CommentCard } from "@/components/CommentCard";
import { bookCoverUrl } from "@/lib/api";

function QuoteRow({ quote, onPress, colors }: {
  quote: Quote;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const bg = `rgba(212, 137, 26, ${Math.max(0.12, quote.highlightIntensity * 0.4)})`;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.quoteRow,
        {
          backgroundColor: pressed ? `rgba(212, 137, 26, ${quote.highlightIntensity * 0.5 + 0.12})` : bg,
          borderLeftColor: colors.primary,
        },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.quoteText, { color: colors.foreground }]} numberOfLines={5}>
        {quote.text}
      </Text>
      <View style={styles.quoteMeta}>
        <Feather name="edit-3" size={12} color={colors.primary} />
        <Text style={[styles.quoteMetaText, { color: colors.mutedForeground }]}>{quote.highlightCount}</Text>
        <Feather name="message-circle" size={12} color={colors.mutedForeground} style={{ marginLeft: 10 }} />
        <Text style={[styles.quoteMetaText, { color: colors.mutedForeground }]}>{quote.commentCount}</Text>
      </View>
    </Pressable>
  );
}

export default function BookDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = parseInt(id ?? "0", 10);

  const [selectedQuote, setSelectedQuote] = useState<{ id: number; text: string } | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingComment, setEditingComment] = useState<Comment | null>(null);

  const { data: book, isLoading } = useGetBook(bookId, {
    query: { enabled: !!bookId, queryKey: getGetBookQueryKey(bookId) },
  });

  const { data: rooms } = useGetBookRooms(bookId, {
    query: { enabled: !!bookId, queryKey: getGetBookRoomsQueryKey(bookId) },
  });

  const likeComment = useLikeComment();
  const saveComment = useSaveComment();
  const deleteComment = useDeleteComment();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetBookQueryKey(bookId) });
  }, [queryClient, bookId]);

  const handleLike = useCallback((commentId: number) => {
    likeComment.mutate({ commentId }, { onSuccess: invalidate });
  }, [likeComment, invalidate]);

  const handleSave = useCallback((commentId: number) => {
    saveComment.mutate({ commentId }, { onSuccess: invalidate });
  }, [saveComment, invalidate]);

  const openQuote = useCallback((quoteId: number, text: string) => {
    setEditingComment(null);
    setSelectedQuote({ id: quoteId, text });
    setSheetVisible(true);
  }, []);

  const handleEdit = useCallback((comment: Comment) => {
    setSelectedQuote({ id: comment.quoteId, text: comment.quoteText ?? "" });
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{book?.title ?? ""}</Text>
          <Text style={[styles.headerAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>{book?.author ?? ""}</Text>
        </View>
      </View>

      {isLoading || !book ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Cover + stats */}
          <View style={styles.heroRow}>
            {bookCoverUrl(book.coverUrl) ? (
              <Image
                source={{ uri: bookCoverUrl(book.coverUrl) ?? undefined }}
                style={[styles.coverImage, { borderRadius: colors.radius }]}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.cover, { backgroundColor: book.coverColor, borderRadius: colors.radius }]}>
                <Text style={styles.coverTitle} numberOfLines={6}>{book.title}</Text>
              </View>
            )}
            <View style={styles.heroInfo}>
              <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={6}>
                {book.description}
              </Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{book.highlightCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Highlights</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{book.commentCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Comments</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{book.quoteCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Passages</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Reading rooms */}
          <View style={styles.roomsHead}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginHorizontal: 0, marginTop: 0, marginBottom: 0 }]}>
              Reading rooms
            </Text>
            <Pressable
              onPress={() =>
                router.push(
                  `/room/create?bookId=${bookId}&bookTitle=${encodeURIComponent(book.title)}`,
                )
              }
              hitSlop={8}
              style={styles.roomsCreate}
            >
              <Feather name="plus" size={13} color={colors.primary} />
              <Text style={[styles.roomsCreateText, { color: colors.primary }]}>Create</Text>
            </Pressable>
          </View>
          {(rooms ?? []).length === 0 ? (
            <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>
              No rooms yet — start one and read together.
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.roomsScroll}
            >
              {(rooms ?? []).map((room: Room) => (
                <Pressable
                  key={room.id}
                  onPress={() => router.push(`/room/${room.id}`)}
                  style={[
                    styles.roomCard,
                    { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
                  ]}
                >
                  <View style={styles.roomCardHead}>
                    <Feather
                      name={room.isPublic ? "users" : "lock"}
                      size={13}
                      color={colors.primary}
                    />
                    {room.isMember ? (
                      <View style={[styles.roomJoinedBadge, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
                        <Text style={[styles.roomJoinedText, { color: colors.mutedForeground }]}>JOINED</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.roomCardName, { color: colors.foreground }]} numberOfLines={2}>
                    {room.name}
                  </Text>
                  <Text style={[styles.roomCardMeta, { color: colors.mutedForeground }]}>
                    {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Top quotes */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Most highlighted passages</Text>
          {book.topQuotes.length === 0 ? (
            <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>No highlighted passages yet.</Text>
          ) : (
            book.topQuotes.map((q) => (
              <QuoteRow key={q.id} quote={q} colors={colors} onPress={() => openQuote(q.id, q.text)} />
            ))
          )}

          {/* Best comments */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>Top comments</Text>
          {book.bestComments.length === 0 ? (
            <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>No comments yet.</Text>
          ) : (
            book.bestComments.map((c) => (
              <Pressable key={c.id} onPress={() => openQuote(c.quoteId, c.quoteText ?? "")}>
                {c.quoteText ? (
                  <View style={[styles.commentQuote, { borderLeftColor: colors.primary }]}>
                    <Text style={[styles.commentQuoteText, { color: colors.mutedForeground }]} numberOfLines={2}>
                      “{c.quoteText}”
                    </Text>
                  </View>
                ) : null}
                <CommentCard
                  comment={c}
                  onLike={handleLike}
                  onSave={handleSave}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <CommentSheet
        visible={sheetVisible}
        quoteId={selectedQuote?.id ?? null}
        quoteText={selectedQuote?.text ?? ""}
        onClose={() => setSheetVisible(false)}
        initialEditingComment={editingComment}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  headerAuthor: { fontSize: 13, marginTop: 1 },
  heroRow: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  coverImage: {
    width: 96,
    height: 140,
  },
  cover: {
    width: 96,
    height: 140,
    padding: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  coverTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    lineHeight: 15,
  },
  heroInfo: { flex: 1 },
  description: { fontSize: 13, lineHeight: 19 },
  statsRow: { flexDirection: "row", gap: 20, marginTop: 14 },
  stat: { alignItems: "flex-start" },
  statNum: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 11, marginTop: 1 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 20,
    marginTop: 28,
    marginBottom: 10,
  },
  emptyLine: { fontSize: 13, marginHorizontal: 20 },
  roomsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginTop: 28,
    marginBottom: 10,
  },
  roomsCreate: { flexDirection: "row", alignItems: "center", gap: 4 },
  roomsCreateText: { fontSize: 12, fontWeight: "700" },
  roomsScroll: { paddingHorizontal: 16, gap: 10 },
  roomCard: {
    width: 170,
    padding: 12,
    borderWidth: 1,
    gap: 6,
  },
  roomCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roomJoinedBadge: { paddingHorizontal: 6, paddingVertical: 2 },
  roomJoinedText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  roomCardName: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  roomCardMeta: { fontSize: 11 },
  quoteRow: {
    marginHorizontal: 16,
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderRadius: 6,
    gap: 8,
  },
  quoteText: { fontSize: 15, lineHeight: 23 },
  quoteMeta: { flexDirection: "row", alignItems: "center" },
  quoteMetaText: { fontSize: 12, fontWeight: "600", marginLeft: 4 },
  commentQuote: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: -4,
    paddingLeft: 10,
    borderLeftWidth: 2,
  },
  commentQuoteText: { fontSize: 12, fontStyle: "italic", lineHeight: 17 },
});
