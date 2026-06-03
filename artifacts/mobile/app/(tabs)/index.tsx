import React from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useListBooks } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { BookCard } from "@/components/BookCard";
import { BookCardShimmer } from "@/components/LoadingShimmer";
import { EmptyState } from "@/components/EmptyState";
import type { Book } from "@workspace/api-client-react";

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();

  const { data: books, isLoading, refetch, isRefetching } = useListBooks();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
            Good reading,
          </Text>
          <Text style={[styles.username, { color: colors.foreground }]}>
            {user?.username ?? "Reader"}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>
            {user?.username.charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Section title */}
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        LIBRARY
      </Text>

      <FlatList<Book>
        data={books ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <BookCard
            book={item}
            onPress={() => router.push(`/book/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>
              {[1, 2, 3].map((i) => <BookCardShimmer key={i} />)}
            </View>
          ) : (
            <EmptyState
              icon="book-open"
              title="No books yet"
              subtitle="Books will appear here once they're added to the library"
            />
          )
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        scrollEnabled
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  greeting: {
    fontSize: 13,
    fontWeight: "500",
  },
  username: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 18,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  list: {
    paddingBottom: 120,
    flexGrow: 1,
  },
});
