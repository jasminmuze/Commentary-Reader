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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetUserRecords,
  useGetUserHighlights,
  getGetUserRecordsQueryKey,
  getGetUserHighlightsQueryKey,
} from "@workspace/api-client-react";
import type {
  UserRecordsBook,
  UserHighlightItem,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { EmptyState } from "@/components/EmptyState";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { navigateToQuote } from "@/lib/quoteNavigation";

type Mode = "books" | "highlights";

function BookRecordCard({ item }: { item: UserRecordsBook }) {
  const colors = useColors();
  const counts: string[] = [];
  if (item.highlightCount > 0) counts.push(`하이라이트 ${item.highlightCount}`);
  if (item.commentCount > 0) counts.push(`댓글 ${item.commentCount}`);
  if (item.savedCount > 0) counts.push(`저장 ${item.savedCount}`);

  return (
    <Pressable
      onPress={() => router.push(`/records/${item.bookId}`)}
      style={({ pressed }) => [
        styles.bookCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.cover, { backgroundColor: item.coverColor, borderRadius: 6 }]}>
        <Text style={styles.coverInitial}>{item.title.slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bookTitle, { color: colors.foreground }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.bookAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.author}
        </Text>
        <Text style={[styles.bookCounts, { color: colors.mutedForeground }]} numberOfLines={1}>
          {counts.join(" · ")}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function HighlightRow({
  item,
  onPress,
}: {
  item: UserHighlightItem;
  onPress: (item: UserHighlightItem) => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onPress(item)}
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
      <View style={[styles.highlightBar, { backgroundColor: item.coverColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.highlightText, { color: colors.foreground }]} numberOfLines={4}>
          {item.quoteText}
        </Text>
        <Text style={[styles.highlightMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.bookTitle} · {new Date(item.createdAt).toLocaleDateString("ko-KR")}
        </Text>
      </View>
    </Pressable>
  );
}

export default function RecordsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const [mode, setMode] = useState<Mode>("books");

  const userId = user?.id ?? 0;

  const {
    data: records,
    isLoading: recordsLoading,
    refetch: refetchRecords,
    isRefetching: recordsRefetching,
  } = useGetUserRecords(userId, {
    query: { enabled: !!user, queryKey: getGetUserRecordsQueryKey(userId) },
  });

  const {
    data: highlights,
    isLoading: highlightsLoading,
    refetch: refetchHighlights,
    isRefetching: highlightsRefetching,
  } = useGetUserHighlights(userId, {
    query: {
      enabled: !!user && mode === "highlights",
      queryKey: getGetUserHighlightsQueryKey(userId),
    },
  });

  const handleOpenHighlight = useCallback((item: UserHighlightItem) => {
    navigateToQuote(item.quoteId).catch(() => {
      Alert.alert(
        "이동할 수 없어요",
        "문장 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    });
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const loadingList = (
    <View style={{ gap: 12, paddingTop: 20 }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ marginHorizontal: 16, gap: 8 }}>
          <LoadingShimmer width="60%" height={14} />
          <LoadingShimmer width="100%" height={14} />
          <LoadingShimmer width="80%" height={14} />
        </View>
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>내 기록</Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          내가 남긴 하이라이트·댓글·저장을 책별로 모아봐요
        </Text>
        <View style={[styles.segment, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          {(
            [
              { value: "books", label: "책별" },
              { value: "highlights", label: "전체 하이라이트" },
            ] as { value: Mode; label: string }[]
          ).map((opt) => {
            const active = mode === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setMode(opt.value)}
                style={[
                  styles.segmentBtn,
                  {
                    backgroundColor: active ? colors.card : "transparent",
                    borderRadius: colors.radius - 2,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: active ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {mode === "books" ? (
        <FlatList<UserRecordsBook>
          data={records ?? []}
          keyExtractor={(item) => String(item.bookId)}
          renderItem={({ item }) => <BookRecordCard item={item} />}
          ListEmptyComponent={
            recordsLoading ? (
              loadingList
            ) : (
              <EmptyState
                icon="book-open"
                title="아직 기록이 없어요"
                subtitle="책을 읽으며 하이라이트나 댓글을 남기면 여기에 모여요"
              />
            )
          }
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 40 }]}
          refreshControl={
            <RefreshControl
              refreshing={recordsRefetching}
              onRefresh={refetchRecords}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList<UserHighlightItem>
          data={highlights ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <HighlightRow item={item} onPress={handleOpenHighlight} />
          )}
          ListEmptyComponent={
            highlightsLoading ? (
              loadingList
            ) : (
              <EmptyState
                icon="edit-3"
                title="아직 하이라이트가 없어요"
                subtitle="책에서 문장을 선택해 하이라이트를 남겨 보세요"
              />
            )
          }
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 40 }]}
          refreshControl={
            <RefreshControl
              refreshing={highlightsRefetching}
              onRefresh={refetchHighlights}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
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
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  segment: {
    flexDirection: "row",
    marginTop: 14,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    paddingTop: 12,
    flexGrow: 1,
  },
  bookCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
  },
  cover: {
    width: 44,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  coverInitial: {
    color: "#FFFFFFDD",
    fontSize: 20,
    fontWeight: "700",
  },
  bookTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  bookAuthor: {
    fontSize: 12,
    marginTop: 1,
  },
  bookCounts: {
    fontSize: 12,
    marginTop: 6,
  },
  highlightRow: {
    flexDirection: "row",
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
