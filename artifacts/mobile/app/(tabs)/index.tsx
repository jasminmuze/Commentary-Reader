import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserLibrary,
  useCreateLibraryEntry,
  getGetUserLibraryQueryKey,
} from "@workspace/api-client-react";
import type { LibraryEntry } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { EmptyState } from "@/components/EmptyState";
import { BookCardShimmer } from "@/components/LoadingShimmer";
import { uploadEpub } from "@/lib/api";

function LibraryCard({ entry, onOpen, onMatch }: {
  entry: LibraryEntry;
  onOpen: () => void;
  onMatch: () => void;
}) {
  const colors = useColors();
  const title = entry.book?.title ?? entry.originalTitle ?? "제목 미상";
  const author = entry.book?.author ?? entry.originalAuthor ?? "저자 미상";
  const spineColor = entry.book?.coverColor ?? "#3A3F4B";
  const matched = !!entry.canonicalBookId;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      onPress={onOpen}
    >
      <View style={[styles.spine, { backgroundColor: spineColor, borderRadius: colors.radius }]}>
        <Text style={styles.spineTitle} numberOfLines={6}>{title}</Text>
      </View>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.cardAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>{author}</Text>

        {matched ? (
          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: `${colors.primary}22` }]}>
              <Feather name="check-circle" size={12} color={colors.primary} />
              <Text style={[styles.chipText, { color: colors.primary }]}>매칭됨 · {entry.book?.highlightCount ?? 0} 하이라이트</Text>
            </View>
          </View>
        ) : (
          <Pressable onPress={onMatch} style={[styles.matchInline, { borderColor: colors.primary }]}>
            <Feather name="link" size={12} color={colors.primary} />
            <Text style={[styles.chipText, { color: colors.primary }]}>커뮤니티 책과 매칭하기</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.openIcon}>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: library, isLoading, refetch, isRefetching } = useGetUserLibrary(
    user?.id ?? 0,
    { query: { enabled: !!user, queryKey: getGetUserLibraryQueryKey(user?.id ?? 0) } }
  );
  const createLibraryEntry = useCreateLibraryEntry();

  const handleUpload = useCallback(async () => {
    if (!user || uploading) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/epub+zip", "*/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (!/\.epub$/i.test(asset.name ?? "")) {
        Alert.alert("EPUB 파일만 가능해요", "확장자가 .epub인 파일을 선택해 주세요.");
        return;
      }
      setUploading(true);
      const uploadURL = await uploadEpub(asset.uri);
      createLibraryEntry.mutate(
        { data: { uploadURL } },
        {
          onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: getGetUserLibraryQueryKey(user.id) });
            if (data.match.status === "matched") {
              router.push(`/read/${data.entry.id}`);
            } else {
              router.push(`/match/${data.entry.id}`);
            }
          },
          onError: () => {
            Alert.alert("업로드 실패", "라이브러리에 추가하지 못했어요. 다시 시도해 주세요.");
          },
          onSettled: () => setUploading(false),
        }
      );
    } catch (e) {
      setUploading(false);
      Alert.alert("업로드 실패", e instanceof Error ? e.message : "파일을 업로드하지 못했어요.");
    }
  }, [user, uploading, createLibraryEntry, queryClient]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good reading,</Text>
          <Text style={[styles.username, { color: colors.foreground }]}>{user?.username ?? "Reader"}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.uploadBtn, { backgroundColor: colors.primary, opacity: pressed || uploading ? 0.8 : 1 }]}
          onPress={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather name="plus" size={22} color={colors.primaryForeground} />
          )}
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MY LIBRARY</Text>

      <FlatList<LibraryEntry>
        data={library ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <LibraryCard
            entry={item}
            onOpen={() => router.push(`/read/${item.id}`)}
            onMatch={() => router.push(`/match/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>
              {[1, 2, 3].map((i) => <BookCardShimmer key={i} />)}
            </View>
          ) : (
            <EmptyState
              icon="upload"
              title="라이브러리가 비어 있어요"
              subtitle="오른쪽 위 + 버튼을 눌러 EPUB 파일을 업로드하고 읽기를 시작하세요"
            />
          )
        }
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  greeting: { fontSize: 13, fontWeight: "500" },
  username: { fontSize: 22, fontWeight: "700", letterSpacing: -0.5 },
  uploadBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  list: { flexGrow: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    overflow: "hidden",
    marginHorizontal: 16,
    marginVertical: 6,
  },
  spine: {
    width: 64,
    minHeight: 92,
    paddingHorizontal: 8,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  spineTitle: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    lineHeight: 13,
  },
  cardInfo: { flex: 1, padding: 14, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
  cardAuthor: { fontSize: 13, fontWeight: "500" },
  chipRow: { flexDirection: "row", marginTop: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  matchInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  openIcon: { paddingRight: 10 },
});
