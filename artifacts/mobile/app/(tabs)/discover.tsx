import React, { useState } from "react";
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useListBooks } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { BookCard } from "@/components/BookCard";
import { BookCardShimmer } from "@/components/LoadingShimmer";
import { EmptyState } from "@/components/EmptyState";
import type { Book } from "@workspace/api-client-react";

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const { data: books, isLoading } = useListBooks(
    query.trim() ? { q: query.trim() } : undefined
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Discover</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Browse the books the community is reading
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
            returnKeyType="search"
          />
        </View>
      </View>

      <FlatList<Book>
        data={books ?? []}
        keyExtractor={(item, index) => String(item.id ?? index)}
        renderItem={({ item }) => (
          <BookCard book={item} onPress={() => router.push(`/book/${item.id}`)} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>{[1, 2, 3].map((i) => <BookCardShimmer key={i} />)}</View>
          ) : (
            <EmptyState
              icon="search"
              title="No results found"
              subtitle="Try a different search, or upload an EPUB to add a new book"
            />
          )
        }
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: 14 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  list: { paddingTop: 12, flexGrow: 1 },
});
