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
import { useColors } from "@/hooks/useColors";
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
            placeholder="Search books and reading rooms"
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
        ListHeaderComponent={
          <RoomStrip
            title={trimmed ? "MATCHING READING ROOMS" : "TRENDING READING ROOMS"}
            rooms={(trimmed ? searchedRooms : trendingRooms) ?? []}
            colors={colors}
          />
        }
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
