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
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBook,
  useLikeComment,
  useSaveComment,
  getGetBookQueryKey,
} from "@workspace/api-client-react";
import type { Quote } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentSheet } from "@/components/CommentSheet";
import { CommentCard } from "@/components/CommentCard";

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

  const { data: book, isLoading } = useGetBook(bookId, {
    query: { enabled: !!bookId, queryKey: getGetBookQueryKey(bookId) },
  });

  const likeComment = useLikeComment();
  const saveComment = useSaveComment();

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
    setSelectedQuote({ id: quoteId, text });
    setSheetVisible(true);
  }, []);

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
            <View style={[styles.cover, { backgroundColor: book.coverColor, borderRadius: colors.radius }]}>
              <Text style={styles.coverTitle} numberOfLines={6}>{book.title}</Text>
            </View>
            <View style={styles.heroInfo}>
              <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={6}>
                {book.description}
              </Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{book.highlightCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>하이라이트</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{book.commentCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>코멘트</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{book.quoteCount}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>구절</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Top quotes */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>가장 많이 하이라이트된 구절</Text>
          {book.topQuotes.length === 0 ? (
            <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>아직 하이라이트된 구절이 없어요.</Text>
          ) : (
            book.topQuotes.map((q) => (
              <QuoteRow key={q.id} quote={q} colors={colors} onPress={() => openQuote(q.id, q.text)} />
            ))
          )}

          {/* Best comments */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 24 }]}>베스트 코멘트</Text>
          {book.bestComments.length === 0 ? (
            <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>아직 코멘트가 없어요.</Text>
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
                <CommentCard comment={c} onLike={handleLike} onSave={handleSave} />
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
