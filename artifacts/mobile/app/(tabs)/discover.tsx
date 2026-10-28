import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { useUser } from "@/context/UserContext";

const ROOM_GUIDE_DISMISSED_KEY = "shelfmates:reading-room-guide-dismissed";

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
  const { user } = useUser();
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Book>>(null);
  const [roomGuideVisible, setRoomGuideVisible] = useState(false);
  const [roomGuideSaving, setRoomGuideSaving] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    AsyncStorage.getItem(`${ROOM_GUIDE_DISMISSED_KEY}:${user.id}`)
      .then((dismissed) => {
        if (!cancelled) setRoomGuideVisible(dismissed !== "true");
      })
      .catch(() => {
        if (!cancelled) setRoomGuideVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  const dismissRoomGuide = async (afterDismiss?: () => void) => {
    if (roomGuideSaving) return;
    setRoomGuideSaving(true);
    try {
      if (user?.id) {
        await AsyncStorage.setItem(
          `${ROOM_GUIDE_DISMISSED_KEY}:${user.id}`,
          "true",
        );
      }
      setRoomGuideVisible(false);
      afterDismiss?.();
    } catch {
      Alert.alert(
        "Couldn't save this preference",
        "Please try again to close the room guide.",
      );
    } finally {
      setRoomGuideSaving(false);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Discover</Text>
          <Pressable
            onPress={() => setRoomGuideVisible(true)}
            style={({ pressed }) => [styles.guideReopen, { opacity: pressed ? 0.65 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Open the reading room guide"
            accessibilityHint="Explains how public and private reading rooms work."
            accessibilityState={{ expanded: roomGuideVisible }}
            testID="discover-room-guide-reopen"
          >
            <Feather name="help-circle" size={16} color={colors.primary} />
            <Text style={[styles.guideReopenText, { color: colors.primary }]}>Room guide</Text>
          </Pressable>
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Find any book, then see who is reading it
        </Text>
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            ref={searchInputRef}
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
          {query.length > 0 ? (
            <Pressable
              style={styles.clearSearchBtn}
              onPress={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="discover-clear-search"
            >
              <Feather name="x-circle" size={19} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {roomGuideVisible ? (
        <View
          style={[
            styles.guideCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
          testID="discover-room-guide"
        >
          <View style={styles.guideHeadingRow}>
            <View style={styles.guideHeading}>
              <Feather name="users" size={17} color={colors.primary} />
              <Text
                style={[styles.guideTitle, { color: colors.foreground }]}
                accessibilityRole="header"
              >
                Read together in a room
              </Text>
            </View>
          </View>
          <Text style={[styles.guideBody, { color: colors.mutedForeground }]}>
            Browse or search rooms in Discover. Public rooms can be found and joined by anyone. Private rooms can only be joined by invitation.
          </Text>
          <Text style={[styles.guideBody, { color: colors.mutedForeground }]}>
            To start one, find and open a book, then tap Create under Reading rooms. Invite friends from inside your room.
          </Text>
          <Pressable
            onPress={() => void dismissRoomGuide()}
            disabled={roomGuideSaving}
            style={styles.guideDismissButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss reading room guide"
            accessibilityHint="Closes this guide. You can reopen it from Discover."
            accessibilityState={{ disabled: roomGuideSaving }}
            testID="discover-room-guide-dismiss"
            hitSlop={8}
          >
            <Text style={[styles.guideDismiss, { color: colors.mutedForeground }]}>Not now</Text>
          </Pressable>
          <View style={styles.guideActions}>
            <Pressable
              onPress={() => {
                setQuery("");
                void dismissRoomGuide(() =>
                  requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true })),
                );
              }}
              disabled={roomGuideSaving}
              style={[styles.guideAction, styles.guideSecondaryAction, { borderColor: colors.border, borderRadius: colors.radius }]}
              accessibilityRole="button"
              accessibilityLabel="Browse reading rooms"
              accessibilityHint="Closes the guide and shows rooms in Discover."
              accessibilityState={{ disabled: roomGuideSaving }}
              testID="discover-room-guide-browse"
            >
              <Text style={[styles.guideSecondaryText, { color: colors.foreground }]}>Browse rooms</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void dismissRoomGuide(() =>
                  requestAnimationFrame(() => searchInputRef.current?.focus()),
                );
              }}
              disabled={roomGuideSaving}
              style={[styles.guideAction, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
              accessibilityRole="button"
              accessibilityLabel="Find a book"
              accessibilityHint="Closes the guide and moves focus to book search."
              accessibilityState={{ disabled: roomGuideSaving }}
              testID="discover-room-guide-find-book"
            >
              <Text style={[styles.guidePrimaryText, { color: colors.primaryForeground }]}>Find a book</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <FlatList<Book>
        ref={listRef}
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
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  guideReopen: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6 },
  guideReopenText: { fontSize: 12, fontWeight: "600" },
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
  clearSearchBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  guideCard: { marginHorizontal: 16, marginTop: 12, padding: 14, borderWidth: 1, gap: 9 },
  guideHeadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  guideHeading: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, paddingRight: 76 },
  guideTitle: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  guideDismissButton: { position: "absolute", top: 10, right: 14, minHeight: 40, justifyContent: "center" },
  guideDismiss: { fontSize: 12, fontWeight: "600", paddingVertical: 4 },
  guideBody: { fontSize: 13, lineHeight: 18 },
  guideActions: { flexDirection: "row", gap: 9, marginTop: 2 },
  guideAction: { minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, flex: 1 },
  guideSecondaryAction: { borderWidth: 1 },
  guidePrimaryText: { fontSize: 13, fontWeight: "700" },
  guideSecondaryText: { fontSize: 13, fontWeight: "600" },
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
