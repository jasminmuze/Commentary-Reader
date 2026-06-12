import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Reader, ReaderProvider, useReader } from "@epubjs-react-native/core";
import type { Annotation, SearchResult } from "@epubjs-react-native/core";
import {
  useGetLibraryEntry,
  useGetBookQuotes,
  useCreateQuote,
  useToggleHighlight,
  getGetBookQuotesQueryKey,
  getGetLibraryEntryQueryKey,
} from "@workspace/api-client-react";
import type { LibraryEntry, Quote } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { useFileSystem } from "@/hooks/useFileSystem";
import { CommentSheet } from "@/components/CommentSheet";
import { apiUrl } from "@/lib/api";

const AMBER = "#D4891A";

function intensityToOpacity(intensity: number): number {
  return Math.max(0.18, Math.min(0.85, intensity));
}

function ReaderInner({ entry, quotes, userId, libraryId, canonicalBookId }: {
  entry: LibraryEntry;
  quotes: Quote[];
  userId: number;
  libraryId: number;
  canonicalBookId: number | null;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { addAnnotation, search } = useReader();
  const createQuote = useCreateQuote();
  const toggleHighlight = useToggleHighlight();

  const [selectedQuote, setSelectedQuote] = useState<{ id: number; text: string } | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [anchoring, setAnchoring] = useState(false);

  const quotesRef = useRef<Quote[]>([]);
  const pendingRef = useRef<Quote[]>([]);
  const anchoredRef = useRef<Set<number>>(new Set());
  const idxRef = useRef(0);
  const readyRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => { quotesRef.current = quotes; }, [quotes]);

  // Anchor only quotes not yet painted; snapshot the working list so a refetch
  // mid-loop can't shift indices out from under an in-flight search.
  const startAnchoring = useCallback(() => {
    if (runningRef.current || !readyRef.current || !canonicalBookId) return;
    const pending = quotesRef.current.filter(
      (q) => q.searchText.length > 0 && !anchoredRef.current.has(q.id)
    );
    if (pending.length === 0) return;
    pendingRef.current = pending;
    idxRef.current = 0;
    runningRef.current = true;
    setAnchoring(true);
    search(pending[0].searchText);
  }, [canonicalBookId, search]);

  const handleReady = useCallback(() => {
    readyRef.current = true;
    startAnchoring();
  }, [startAnchoring]);

  useEffect(() => {
    if (readyRef.current && quotes.length > 0) startAnchoring();
  }, [quotes, startAnchoring]);

  const handleSearch = useCallback((results: SearchResult[]) => {
    if (!runningRef.current) return;
    const pending = pendingRef.current;
    const idx = idxRef.current;
    if (idx < pending.length) {
      const q = pending[idx];
      anchoredRef.current.add(q.id);
      if (results && results.length > 0) {
        try {
          addAnnotation(
            "highlight",
            results[0].cfi,
            { quoteId: q.id },
            { color: AMBER, opacity: intensityToOpacity(q.highlightIntensity) }
          );
        } catch {
          // ignore annotation failures for individual quotes
        }
      }
    }
    const next = idx + 1;
    idxRef.current = next;
    if (next < pending.length) {
      search(pending[next].searchText);
    } else {
      runningRef.current = false;
      setAnchoring(false);
      // Drain any quotes that arrived while this pass was running.
      startAnchoring();
    }
  }, [addAnnotation, search, startAnchoring]);

  const handlePressAnnotation = useCallback((annotation: Annotation) => {
    const data = annotation?.data as { quoteId?: number } | undefined;
    const quoteId = data?.quoteId;
    if (typeof quoteId !== "number") return;
    const q = quotesRef.current.find((x) => x.id === quoteId);
    setSelectedQuote({ id: quoteId, text: q?.text ?? annotation.cfiRangeText ?? "" });
    setSheetVisible(true);
  }, []);

  const ensureMatched = useCallback(() => {
    if (!canonicalBookId) {
      Alert.alert(
        "먼저 책을 매칭하세요",
        "커뮤니티 하이라이트와 코멘트를 사용하려면 이 책을 매칭해야 해요.",
        [
          { text: "취소", style: "cancel" },
          { text: "매칭하기", onPress: () => router.push(`/match/${libraryId}`) },
        ]
      );
      return false;
    }
    return true;
  }, [canonicalBookId, libraryId]);

  const handleHighlight = useCallback((cfiRange: string, text: string): boolean => {
    if (!ensureMatched() || !canonicalBookId) return true;
    const trimmed = text.trim();
    if (trimmed.length < 8) {
      Alert.alert("너무 짧아요", "최소 8자 이상 선택해 주세요.");
      return true;
    }
    createQuote.mutate(
      { bookId: canonicalBookId, data: { text: trimmed.slice(0, 1000) } },
      {
        onSuccess: (quote) => {
          // Mark as anchored so the post-toggle refetch doesn't search + repaint it.
          anchoredRef.current.add(quote.id);
          try {
            addAnnotation("highlight", cfiRange, { quoteId: quote.id }, { color: AMBER, opacity: 0.45 });
          } catch {
            // ignore
          }
          toggleHighlight.mutate(
            { quoteId: quote.id, data: { userId, userLibraryId: libraryId, cfiRange } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetBookQuotesQueryKey(canonicalBookId, { userId }) });
              },
            }
          );
        },
        onError: () => Alert.alert("하이라이트 실패", "다시 시도해 주세요."),
      }
    );
    return true;
  }, [ensureMatched, canonicalBookId, createQuote, addAnnotation, toggleHighlight, userId, libraryId, queryClient]);

  const handleComment = useCallback((_cfiRange: string, text: string): boolean => {
    if (!ensureMatched() || !canonicalBookId) return true;
    const trimmed = text.trim();
    if (trimmed.length < 8) {
      Alert.alert("너무 짧아요", "코멘트를 남기려면 최소 8자 이상 선택해 주세요.");
      return true;
    }
    createQuote.mutate(
      { bookId: canonicalBookId, data: { text: trimmed.slice(0, 1000) } },
      {
        onSuccess: (quote) => {
          setSelectedQuote({ id: quote.id, text: quote.text });
          setSheetVisible(true);
        },
        onError: () => Alert.alert("실패", "다시 시도해 주세요."),
      }
    );
    return true;
  }, [ensureMatched, canonicalBookId, createQuote]);

  const topPad = insets.top;
  const src = apiUrl(entry.epubUrl);
  const subtitle = canonicalBookId
    ? anchoring
      ? "커뮤니티 하이라이트 표시 중…"
      : `커뮤니티 하이라이트 ${quotes.length}개`
    : "매칭되지 않음 · 텍스트를 길게 눌러 선택하세요";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {entry.book?.title ?? entry.originalTitle ?? "내 책"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        {!canonicalBookId ? (
          <Pressable onPress={() => router.push(`/match/${libraryId}`)} style={[styles.matchBtn, { borderColor: colors.primary }]}>
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>매칭</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        <Reader
          src={src}
          fileSystem={useFileSystem}
          enableSelection
          onReady={handleReady}
          onSearch={handleSearch}
          onPressAnnotation={handlePressAnnotation}
          menuItems={[
            { label: "하이라이트", action: (cfiRange, text) => handleHighlight(cfiRange, text) },
            { label: "코멘트", action: (cfiRange, text) => handleComment(cfiRange, text) },
          ]}
        />
      </View>

      <CommentSheet
        visible={sheetVisible}
        quoteId={selectedQuote?.id ?? null}
        quoteText={selectedQuote?.text ?? ""}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

export default function ReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { libraryId: libraryIdParam } = useLocalSearchParams<{ libraryId: string }>();
  const libraryId = parseInt(libraryIdParam ?? "0", 10);

  const { data: entry, isLoading } = useGetLibraryEntry(libraryId, {
    query: { enabled: !!libraryId, queryKey: getGetLibraryEntryQueryKey(libraryId) },
  });
  const canonicalBookId = entry?.canonicalBookId ?? null;
  const { data: quotes } = useGetBookQuotes(
    canonicalBookId ?? 0,
    { userId: user?.id },
    {
      query: {
        enabled: !!canonicalBookId,
        queryKey: getGetBookQuotesQueryKey(canonicalBookId ?? 0, { userId: user?.id }),
      },
    }
  );

  if (Platform.OS === "web") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top + 40, padding: 24 }]}>
        <Feather name="smartphone" size={40} color={colors.primary} />
        <Text style={[styles.webTitle, { color: colors.foreground }]}>모바일에서 읽어주세요</Text>
        <Text style={[styles.webBody, { color: colors.mutedForeground }]}>
          EPUB 리더는 원본 출판 서식을 그대로 보여주기 위해 기기에서만 동작해요. Expo Go 앱이나 빌드된 기기에서 이 책을 열어 주세요.
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.webBtn, { backgroundColor: colors.primary }]}>
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>돌아가기</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading || !entry) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ReaderProvider>
      <ReaderInner
        entry={entry}
        quotes={quotes ?? []}
        userId={user?.id ?? 0}
        libraryId={libraryId}
        canonicalBookId={canonicalBookId}
      />
    </ReaderProvider>
  );
}

const styles = StyleSheet.create({
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
  titleWrap: { flex: 1 },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 1 },
  matchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  webTitle: { fontSize: 20, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  webBody: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  webBtn: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
});
