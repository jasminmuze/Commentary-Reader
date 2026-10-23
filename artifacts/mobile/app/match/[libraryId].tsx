import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
  useMatchLibraryEntry,
  useCreateBook,
  useSearchGoogleBooks,
  useResolveGoogleBook,
  getSearchGoogleBooksQueryKey,
  getGetUserLibraryQueryKey,
  getGetLibraryEntryQueryKey,
} from "@workspace/api-client-react";
import type { GoogleBookCatalogItem } from "@workspace/api-client-react";
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
  const [catalogQuery, setCatalogQuery] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (entry && !initialized) {
      setQuery(entry.originalTitle ?? "");
      setInitialized(true);
    }
  }, [entry, initialized]);

  useEffect(() => {
    const timer = setTimeout(() => setCatalogQuery(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const googleBooksQuery = useSearchGoogleBooks(
    { q: catalogQuery },
    {
      query: {
        enabled: catalogQuery.length >= 2,
        retry: false,
        queryKey: getSearchGoogleBooksQueryKey({ q: catalogQuery }),
      },
    },
  );

  const matchEntry = useMatchLibraryEntry();
  const createBook = useCreateBook();
  const resolveGoogleBook = useResolveGoogleBook();

  const goToReader = () => {
    queryClient.invalidateQueries({ queryKey: getGetLibraryEntryQueryKey(libraryId) });
    if (user) queryClient.invalidateQueries({ queryKey: getGetUserLibraryQueryKey(user.id) });
    router.replace(`/readium/${libraryId}`);
  };

  const handleMatch = (bookId: number) => {
    matchEntry.mutate(
      { libraryId, data: { canonicalBookId: bookId } },
      {
        onSuccess: goToReader,
        onError: () => Alert.alert("Match failed", "Please try again."),
      }
    );
  };

  const handleCreate = () => {
    const title = (entry?.originalTitle ?? query).trim();
    const author = (entry?.originalAuthor ?? "").trim();
    if (title.length < 1) {
      Alert.alert("Title required", "A title is needed to add a new book. Please enter one in the search field above.");
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
        onError: () => Alert.alert("Couldn't add book", "We couldn't create the new book. Please try again."),
      }
    );
  };

  const handleGoogleBookSelect = (item: GoogleBookCatalogItem) => {
    resolveGoogleBook.mutate(
      {
        data: {
          title: item.title,
          author: item.author,
          isbn: item.isbn,
        },
      },
      {
        onSuccess: (book) => handleMatch(book.id),
        onError: () => Alert.alert("Couldn't use this result", "Please try again or add the book manually."),
      },
    );
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const busy = matchEntry.isPending || createBook.isPending || resolveGoogleBook.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Match book</Text>
        <View style={{ width: 30 }} />
      </View>

      {entryLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList<GoogleBookCatalogItem>
          data={catalogQuery === query.trim() ? googleBooksQuery.data ?? [] : []}
          keyExtractor={(item, index) => `${item.isbn ?? item.title}-${index}`}
          ListHeaderComponent={
            <View>
              <View style={[styles.fileCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <Feather name="file-text" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fileTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {entry?.originalTitle ?? "Untitled"}
                  </Text>
                  <Text style={[styles.fileAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {entry?.originalAuthor ?? "Unknown author"}
                    {entry?.originalIsbn ? ` · ISBN ${entry.originalIsbn}` : ""}
                  </Text>
                </View>
              </View>

              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Linking your uploaded file to a community book lets you see other readers' highlights and comments too.
              </Text>

              <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <Feather name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground }]}
                  placeholder="Search by title or author"
                  placeholderTextColor={colors.mutedForeground}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {query.length > 0 ? (
                  <Pressable
                    style={styles.clearSearchBtn}
                    onPress={() => {
                      setQuery("");
                      setCatalogQuery("");
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Feather name="x-circle" size={19} color={colors.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>GOOGLE BOOKS</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.externalBookRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed || busy ? 0.7 : 1,
                },
              ]}
              onPress={() => handleGoogleBookSelect(item)}
              disabled={busy}
            >
              {item.coverUrl ? (
                <Image
                  source={{ uri: item.coverUrl }}
                  style={styles.googleCover}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.googleCoverPlaceholder, { backgroundColor: colors.primary + "18" }]}>
                  <Feather name="book-open" size={20} color={colors.primary} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.bookTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
                <Text style={[styles.bookAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>{item.author}</Text>
                {item.publisher || item.publishedDate || item.pageCount ? (
                  <Text style={[styles.bookMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {[item.publisher, item.publishedDate, item.pageCount ? `${item.pageCount} pages` : null].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
                {item.isbn ? (
                  <Text style={[styles.bookMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    ISBN {item.isbn}
                  </Text>
                ) : null}
                {item.language ? (
                  <Text style={[styles.bookMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.language.toUpperCase()}
                  </Text>
                ) : null}
                {item.description ? (
                  <Text style={[styles.googleDescription, { color: colors.mutedForeground }]} numberOfLines={3}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <Feather name="plus" size={19} color={colors.primary} />
            </Pressable>
          )}
          ListEmptyComponent={
            catalogQuery !== query.trim() ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 10 }} />
            ) : catalogQuery.length < 2 ? (
              <Text style={[styles.externalStatus, { color: colors.mutedForeground }]}>
                Enter a title, author, or ISBN to search Google Books.
              </Text>
            ) : googleBooksQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 10 }} />
            ) : googleBooksQuery.isError ? (
              <Text style={[styles.externalStatus, { color: colors.mutedForeground }]}>
                Google Books search is unavailable right now. You can still add the book manually or continue without matching.
              </Text>
            ) : (
              <Text style={[styles.externalStatus, { color: colors.mutedForeground }]}>
                No Google Books results found. You can still add the book manually or continue without matching.
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
                    <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>Add as a new book</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => router.replace(`/readium/${libraryId}`)}
                disabled={busy}
              >
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Do it later · read without matching</Text>
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
  clearSearchBtn: { padding: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 20,
    marginBottom: 8,
  },
  bookTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  bookAuthor: { fontSize: 13, marginTop: 1 },
  bookMeta: { fontSize: 11, marginTop: 4 },
  externalStatus: { fontSize: 13, lineHeight: 19, textAlign: "center", paddingHorizontal: 8, paddingVertical: 8 },
  externalBookRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  googleCover: {
    width: 56,
    height: 80,
    borderRadius: 4,
    backgroundColor: "rgba(127,127,127,0.12)",
  },
  googleCoverPlaceholder: {
    width: 56,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  googleDescription: { fontSize: 12, lineHeight: 17, marginTop: 3 },
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
