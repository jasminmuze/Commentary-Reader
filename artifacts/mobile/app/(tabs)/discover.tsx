import React, { useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  useListBooks,
  useListRooms,
  useGetTrendingRooms,
  getListRoomsQueryKey,
  getGetTrendingRoomsQueryKey,
} from "@workspace/api-client-react";
import { Alert } from "react-native";
import { useResolveCatalogBook } from "@workspace/api-client-react";
import type { BookCatalogItem } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import {
  useCatalogSearch,
  CatalogRow,
  CatalogStatus,
  CatalogFooter,
  CatalogDetailSheet,
} from "@/components/CatalogBook";
import { BookCard } from "@/components/BookCard";
import { BookCardShimmer } from "@/components/LoadingShimmer";
import { EmptyState } from "@/components/EmptyState";
import type { Book, Room } from "@workspace/api-client-react";

function RoomStrip({
  title,
  rooms,
  colors,
}: {
  title: string;
  rooms: Room[];
  colors: ReturnType<typeof useColors>;
}) {
  if (rooms.length === 0) return null;
  return (
    <View style={styles.roomsSection}>
      <Text style={[styles.roomsTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.roomsScroll}
        keyboardShouldPersistTaps="handled"
      >
        {rooms.map((room) => (
          <Pressable
            key={room.id}
            onPress={() => router.push(`/room/${room.id}`)}
            style={[
              styles.roomCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <View style={styles.roomCardHead}>
              <View style={[styles.roomCover, { backgroundColor: room.coverColor }]} />
              <Feather
                name={room.isPublic ? "users" : "lock"}
                size={12}
                color={colors.mutedForeground}
              />
            </View>
            <Text style={[styles.roomCardName, { color: colors.foreground }]} numberOfLines={1}>
              {room.name}
            </Text>
            <Text style={[styles.roomCardBook, { color: colors.mutedForeground }]} numberOfLines={1}>
              {room.bookTitle}
            </Text>
            <Text style={[styles.roomCardMeta, { color: colors.mutedForeground }]}>
              {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
              {room.isMember ? " · joined" : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const { data: books, isLoading } = useListBooks(
    trimmed ? { q: trimmed } : undefined
  );

  const { data: trendingRooms } = useGetTrendingRooms({
    query: { enabled: !trimmed, queryKey: getGetTrendingRoomsQueryKey() },
  });

  const { data: searchedRooms } = useListRooms(
    trimmed ? { q: trimmed } : undefined,
    {
      query: {
        enabled: !!trimmed,
        queryKey: getListRoomsQueryKey(trimmed ? { q: trimmed } : undefined),
      },
    },
  );

  const catalog = useCatalogSearch(query);
  const resolveCatalog = useResolveCatalogBook();
  const [selected, setSelected] = useState<BookCatalogItem | null>(null);

  const openCommunity = (item: BookCatalogItem) => {
    resolveCatalog.mutate(
      {
        data: {
          title: item.title,
          author: item.author,
          isbn: item.isbn,
          coverUrl: item.coverUrl,
          description: item.description,
        },
      },
      {
        onSuccess: (book) => {
          setSelected(null);
          router.push(`/book/${book.id}`);
        },
        onError: () => Alert.alert("Couldn't open community", "Please try again in a moment."),
      },
    );
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Discover</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Find any book, then see who is reading it
        </Text>
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Title, author, or ISBN"
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            maxLength={160}
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
        ListHeaderComponent={
          <View>
          <RoomStrip
            title={trimmed ? "MATCHING READING ROOMS" : "TRENDING READING ROOMS"}
            rooms={(trimmed ? searchedRooms : trendingRooms) ?? []}
            colors={colors}
          />
          {trimmed && (books ?? []).length > 0 ? (
            <Text style={[styles.roomsTitle, { color: colors.mutedForeground }]}>ON SHELFMATES</Text>
          ) : null}
          </View>
        }
        ListFooterComponent={
          trimmed ? (
            <View style={styles.catalogSection}>
              <Text style={[styles.roomsTitle, { color: colors.mutedForeground, marginHorizontal: 4 }]}>ALL BOOKS</Text>
              {catalog.items.length > 0 ? (
                catalog.items.map((item) => (
                  <CatalogRow key={item.catalogId} item={item} onPress={() => setSelected(item)} />
                ))
              ) : (
                <CatalogStatus
                  search={catalog}
                  colors={colors}
                  emptyHint="No catalog matches. Try another spelling or an ISBN."
                />
              )}
              <CatalogFooter search={catalog} colors={colors} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          trimmed && !isLoading ? null : isLoading ? (
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
        keyboardDismissMode="on-drag"
      />
      <CatalogDetailSheet
        item={selected}
        source={catalog.data?.source}
        onClose={() => setSelected(null)}
        onOpenCommunity={openCommunity}
        opening={resolveCatalog.isPending}
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
  catalogSection: { paddingHorizontal: 16, marginTop: 12 },
  list: { paddingTop: 12, flexGrow: 1 },
  roomsSection: { marginBottom: 8 },
  roomsTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 10,
  },
  roomsScroll: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
  roomCard: {
    width: 190,
    padding: 12,
    borderWidth: 1,
    gap: 4,
  },
  roomCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  roomCover: { width: 22, height: 32, borderRadius: 4 },
  roomCardName: { fontSize: 13, fontWeight: "700" },
  roomCardBook: { fontSize: 11 },
  roomCardMeta: { fontSize: 11, marginTop: 2 },
});
