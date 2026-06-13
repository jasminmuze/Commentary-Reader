import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLibraryEntry,
  useListBooks,
  useMatchLibraryEntry,
  useCreateBook,
  getGetUserLibraryQueryKey,
  getGetLibraryEntryQueryKey,
} from "@workspace/api-client-react";
import type { Book } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";

export default function MatchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { libraryId: libraryIdParam } = useLocalSearchParams<{ libraryId: string }>();
  const libraryId = parseInt(libraryIdParam ?? "0", 10);

  const { data: entry, isLoading: entryLoading } = useGetLibraryEntry(
    libraryId,
    {
      query: {
        enabled: !!libraryId && !!user?.id,
        queryKey: getGetLibraryEntryQueryKey(libraryId),
      },
    }
  );

  const [query, setQuery] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (entry && !initialized) {
      setQuery(entry.originalTitle ?? "");
      setInitialized(true);
    }
  }, [entry, initialized]);

  const { data: books, isLoading: booksLoading } = useListBooks(
    query.trim() ? { q: query.trim() } : undefined
  );

  const matchEntry = useMatchLibraryEntry();
  const createBook = useCreateBook();

  const goToReader = () => {
    queryClient.invalidateQueries({ queryKey: getGetLibraryEntryQueryKey(libraryId) });
    if (user) queryClient.invalidateQueries({ queryKey: getGetUserLibraryQueryKey(user.id) });
    router.replace(`/read/${libraryId}`);
  };

  const handleMatch = (bookId: number) => {
    matchEntry.mutate(
      { libraryId, data: { canonicalBookId: bookId } },
      {
        onSuccess: goToReader,
        onError: () => Alert.alert("매칭 실패", "다시 시도해 주세요."),
      }
    );
  };

  const handleCreate = () => {
    const title = (entry?.originalTitle ?? query).trim();
    const author = (entry?.originalAuthor ?? "").trim();
    if (title.length < 1) {
      Alert.alert("제목이 필요해요", "새 책으로 등록하려면 제목이 필요합니다. 위 검색창에 제목을 입력해 주세요.");
      return;
    }
    createBook.mutate(
      {
        data: {
          title,
          author: author.length > 0 ? author : "Unknown",
          isbn: entry?.originalIsbn ?? undefined,
        },
      },
      {
        onSuccess: (book) => handleMatch(book.id),
        onError: () => Alert.alert("등록 실패", "새 책을 만들지 못했어요. 다시 시도해 주세요."),
      }
    );
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const busy = matchEntry.isPending || createBook.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>책 매칭</Text>
        <View style={{ width: 30 }} />
      </View>

      {entryLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList<Book>
          data={books ?? []}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={
            <View>
              <View style={[styles.fileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <Feather name="file-text" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fileTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {entry?.originalTitle ?? "제목 미상"}
                  </Text>
                  <Text style={[styles.fileAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {entry?.originalAuthor ?? "저자 미상"}
                    {entry?.originalIsbn ? ` · ISBN ${entry.originalIsbn}` : ""}
                  </Text>
                </View>
              </View>

              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                업로드한 파일을 커뮤니티의 책과 연결하면 다른 독자들의 하이라이트와 코멘트를 함께 볼 수 있어요.
              </Text>

              <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <Feather name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground }]}
                  placeholder="제목 또는 저자로 검색"
                  placeholderTextColor={colors.mutedForeground}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>추천 후보</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.bookRow,
                { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => handleMatch(item.id)}
              disabled={busy}
            >
              <View style={[styles.spine, { backgroundColor: item.coverColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.bookTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
                <Text style={[styles.bookAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>{item.author}</Text>
                <Text style={[styles.bookMeta, { color: colors.mutedForeground }]}>
                  {item.highlightCount} 하이라이트 · {item.commentCount} 코멘트
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </Pressable>
          )}
          ListEmptyComponent={
            booksLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : (
              <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>
                일치하는 책이 없어요. 아래에서 새 책으로 등록할 수 있어요.
              </Text>
            )
          }
          ListFooterComponent={
            <View style={styles.footer}>
              <Pressable
                style={({ pressed }) => [styles.createBtn, { borderColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 }]}
                onPress={handleCreate}
                disabled={busy}
              >
                {createBook.isPending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Feather name="plus-circle" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>새 책으로 등록하기</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => router.replace(`/read/${libraryId}`)}
                disabled={busy}
              >
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>나중에 하기 · 매칭 없이 읽기</Text>
              </Pressable>
            </View>
          }
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      {busy ? (
        <View style={styles.busyOverlay} pointerEvents="auto">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
  fileTitle: { fontSize: 15, fontWeight: "700" },
  fileAuthor: { fontSize: 12, marginTop: 2 },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 14, marginBottom: 14 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 20,
    marginBottom: 8,
  },
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  spine: { width: 8, alignSelf: "stretch", borderRadius: 4 },
  bookTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  bookAuthor: { fontSize: 13, marginTop: 1 },
  bookMeta: { fontSize: 11, marginTop: 4 },
  emptyLine: { fontSize: 13, textAlign: "center", marginTop: 16, lineHeight: 19 },
  footer: { marginTop: 16, gap: 14 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
});
