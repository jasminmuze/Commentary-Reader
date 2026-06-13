import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Annotation, Location, SearchResult } from "@epubjs-react-native/core";
import {
  useGetLibraryEntry,
  useGetBookQuotes,
  useCreateQuote,
  useToggleHighlight,
  useUpdateReadingLocation,
  getGetBookQuotesQueryKey,
  getGetLibraryEntryQueryKey,
} from "@workspace/api-client-react";
import type { LibraryEntry, Quote } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { useFileSystem } from "@/hooks/useFileSystem";
import { CommentSheet } from "@/components/CommentSheet";
import { ReaderSettingsPanel } from "@/components/ReaderSettingsPanel";
import { TocPanel } from "@/components/TocPanel";
import { UserNotesPanel } from "@/components/UserNotesPanel";
import { apiUrl } from "@/lib/api";
import {
  useReaderSettings,
  buildReaderTheme,
  buildApplyStyleScript,
  HIGHLIGHT_STYLE_CONFIGS,
} from "@/hooks/useReaderSettings";

function intensityToOpacity(intensity: number): number {
  return Math.max(0.15, Math.min(0.50, intensity));
}

function ReaderInner({
  entry, quotes, libraryId, canonicalBookId, isFetching,
}: {
  entry: LibraryEntry;
  quotes: Quote[];
  libraryId: number;
  canonicalBookId: number | null;
  isFetching: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { addAnnotation, search, injectJavascript, changeTheme, toc, goToLocation } = useReader();
  const createQuote = useCreateQuote();
  const toggleHighlight = useToggleHighlight();
  const updateLocation = useUpdateReadingLocation();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLocationRef = useRef<string | undefined>(entry.lastReadingLocation ?? undefined);
  // 복원할 대상 CFI — 마운트 시 한 번만 캡처 (refetch로 변경되면 안 됨)
  const initialLocationRef = useRef<string | undefined>(entry.lastReadingLocation ?? undefined);
  // 복원 모드: initialLocation이 있을 때 true, 복원 완료 시 false
  const isRestoringRef = useRef<boolean>(!!entry.lastReadingLocation);
  const restoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstSaveLoggedRef = useRef(false);

  const fs = useFileSystem();
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  const { user } = useUser();
  const { settings, settingsRef, update: updateSettings, reset: resetSettings, loaded } = useReaderSettings();
  const [settingsPanelVisible, setSettingsPanelVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [notesVisible, setNotesVisible] = useState(false);

  const [selectedQuote, setSelectedQuote] = useState<{ id: number; text: string; cfiRange?: string } | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [anchoring, setAnchoring] = useState(false);
  const [readProgress, setReadProgress] = useState<number | null>(null);
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null);

  const quotesRef = useRef<Quote[]>([]);
  const pendingRef = useRef<Quote[]>([]);
  const anchoredRef = useRef<Set<number>>(new Set());
  const idxRef = useRef(0);
  const readyRef = useRef(false);
  const runningRef = useRef(false);
  const cfiByQuoteIdRef = useRef<Map<number, string>>(new Map());

  useEffect(() => { quotesRef.current = quotes; }, [quotes]);

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
    search(pending[0].text);
  }, [canonicalBookId, search]);

  const handleReady = useCallback(() => {
    readyRef.current = true;
    const script = buildApplyStyleScript(settingsRef.current);
    console.log("[Reader] onReady - applying initial styles");
    injectJavascript(script);
    // initialLocation이 있으면 라이브러리 내부에서 goToLocation을 비동기로 호출한다.
    // 그 전에 page-1 onLocationChange가 먼저 발화하므로 복원 타임아웃을 건다.
    if (isRestoringRef.current) {
      console.log('[RESTORE] 복원 모드 시작 — initialLocation:', initialLocationRef.current);
      restoreTimeoutRef.current = setTimeout(() => {
        if (isRestoringRef.current) {
          isRestoringRef.current = false;
          console.log('[RESTORE] 복원 모드 종료 (2000ms 타임아웃)');
        }
      }, 2000);
    }
    startAnchoring();
  }, [startAnchoring, injectJavascript, settingsRef]);

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
        console.log("[ANCHOR] 인용:", q.text.slice(0, 80));
        console.log("[ANCHOR] CFI:", results[0].cfi);
        cfiByQuoteIdRef.current.set(q.id, results[0].cfi);
        try {
          addAnnotation(
            "highlight",
            results[0].cfi,
            { quoteId: q.id },
            { color: "#F9E04B", opacity: intensityToOpacity(q.highlightIntensity) }
          );
        } catch {
          // ignore annotation failures for individual quotes
        }
      } else {
        console.log("[ANCHOR] 매칭 없음:", q.text.slice(0, 60));
      }
    }
    const next = idx + 1;
    idxRef.current = next;
    if (next < pending.length) {
      search(pending[next].text);
    } else {
      runningRef.current = false;
      setAnchoring(false);
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
    const hlStyle = HIGHLIGHT_STYLE_CONFIGS[settingsRef.current.highlightStyle];
    createQuote.mutate(
      { bookId: canonicalBookId, data: { text: trimmed.slice(0, 1000) } },
      {
        onSuccess: (quote) => {
          anchoredRef.current.add(quote.id);
          cfiByQuoteIdRef.current.set(quote.id, cfiRange);
          try {
            addAnnotation(
              hlStyle.annotationType,
              cfiRange,
              { quoteId: quote.id },
              { color: hlStyle.color, opacity: 0.35 }
            );
          } catch {
            // ignore
          }
          toggleHighlight.mutate(
            { quoteId: quote.id, data: { userLibraryId: libraryId, cfiRange } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetBookQuotesQueryKey(canonicalBookId) });
              },
            }
          );
        },
        onError: () => Alert.alert("하이라이트 실패", "다시 시도해 주세요."),
      }
    );
    return true;
  }, [ensureMatched, canonicalBookId, settingsRef, createQuote, addAnnotation, toggleHighlight, libraryId, queryClient]);

  const handleComment = useCallback((cfiRange: string, text: string): boolean => {
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
          setSelectedQuote({ id: quote.id, text: quote.text, cfiRange });
          setSheetVisible(true);
        },
        onError: () => Alert.alert("실패", "다시 시도해 주세요."),
      }
    );
    return true;
  }, [ensureMatched, canonicalBookId, createQuote]);

  const handleLocationChange = useCallback(
    (_total: number, location: Location, progress: number) => {
      const cfi = location?.start?.cfi;
      if (!cfi) return;

      // 복원 모드: goToLocation이 완료되기 전 page-1 이벤트를 무시한다
      if (isRestoringRef.current) {
        if (cfi === initialLocationRef.current) {
          // 목적지 CFI와 정확히 일치 → 즉시 복원 완료
          isRestoringRef.current = false;
          if (restoreTimeoutRef.current) {
            clearTimeout(restoreTimeoutRef.current);
            restoreTimeoutRef.current = null;
          }
          console.log('[RESTORE] 복원 모드 종료 (CFI 일치):', cfi);
        } else {
          console.log('[RESTORE] 초기 위치 무시 (복원 중):', cfi);
          return; // currentLocationRef 업데이트 및 서버 저장 건너뜀
        }
      }

      if (!firstSaveLoggedRef.current) {
        firstSaveLoggedRef.current = true;
        console.log('[RESTORE] 복원 후 첫 저장 위치:', cfi);
      }
      currentLocationRef.current = cfi;
      setReadProgress(Math.min(100, Math.max(0, Math.round(progress))));
      const disp = location?.start?.displayed;
      if (disp && disp.total > 1) {
        setPageInfo({ page: disp.page, total: disp.total });
      }
      const clampedProgress = Math.min(100, Math.max(0, Math.round(progress)));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateLocation.mutate(
          { libraryId, data: { location: cfi, readingProgress: clampedProgress } },
          {
            onSuccess: (updated) => {
              queryClient.setQueryData(
                getGetLibraryEntryQueryKey(libraryId),
                updated
              );
            },
          }
        );
      }, 1500);
    },
    [updateLocation, libraryId, queryClient]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!fs.cacheDirectory) return;
    const remote = apiUrl(entry.epubUrl);
    const dest = `${fs.cacheDirectory}epub_${libraryId}.epub`;
    console.log("[EPUB] 캐시 경로:", dest);
    (async () => {
      const info = await fs.getFileInfo(dest);
      if (info.exists) {
        console.log("[EPUB] 캐시 히트 → 즉시 사용");
        setLocalSrc(dest);
        return;
      }
      console.log("[EPUB] 캐시 미스 → 다운로드 시작:", remote);
      const result = await fs.downloadFile(remote, dest);
      console.log("[EPUB] 다운로드 완료 → 로컬 URI:", result.uri);
      if (result.uri) {
        setLocalSrc(result.uri);
      } else {
        setDlError("EPUB 다운로드에 실패했어요");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.epubUrl, libraryId]);

  const handleSettingsChange = useCallback(
    (patch: Partial<typeof settings>) => {
      updateSettings(patch);
      if (!("scrollMode" in patch) && readyRef.current) {
        const next = { ...settingsRef.current, ...patch };
        console.log("[Reader] settings changed:", Object.keys(patch).join(","), "- injecting styles");
        injectJavascript(buildApplyStyleScript(next));
      }
    },
    [updateSettings, settingsRef, injectJavascript]
  );

  const readerTheme = useMemo(
    () => buildReaderTheme(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.theme]
  );

  const readerKey = settings.scrollMode;

  const myHighlightedQuotes = useMemo(
    () => quotes.filter((q) => q.highlightedByMe === true),
    [quotes]
  );

  const topPad = insets.top;

  if (dlError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Text style={{ color: "#FF6B6B", fontSize: 14, textAlign: "center" }}>{dlError}</Text>
      </View>
    );
  }

  // Reader가 아직 마운트되지 않은 로딩 구간에서 fresh entry가 도착하면 ref를 업데이트한다.
  // useRef 초기값은 최초 마운트 시 1회만 평가되므로, 캐시 stale 데이터로 마운트될 때
  // lastReadingLocation이 null이었다가 refetch 이후 CFI로 바뀌면 여기서 보정한다.
  if (!currentLocationRef.current && entry.lastReadingLocation) {
    currentLocationRef.current = entry.lastReadingLocation;
  }

  // localSrc가 준비됐지만 아직 refetch 중이고 location도 없으면 잠깐 더 기다린다.
  // (EPUB 캐시 히트로 localSrc가 즉시 설정될 때 React Query refetch보다 빠를 수 있음)
  if (!loaded || !localSrc || (isFetching && !currentLocationRef.current)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, marginTop: 10, fontSize: 13 }}>
          {!loaded ? "설정 불러오는 중…" : "EPUB 다운로드 중…"}
        </Text>
      </View>
    );
  }

  const subtitle = canonicalBookId
    ? anchoring
      ? "커뮤니티 하이라이트 표시 중…"
      : `커뮤니티 하이라이트 ${quotes.length}개`
    : "매칭되지 않음 · 텍스트를 길게 눌러 선택하세요";

  const flow = settings.scrollMode === "vertical" ? "scrolled-doc" : "paginated";
  const manager = settings.scrollMode === "vertical" ? "continuous" : "default";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 10,
            borderBottomColor: colors.border + "80",
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {entry.book?.title ?? entry.originalTitle ?? "내 책"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {!canonicalBookId ? (
          <Pressable
            onPress={() => router.push(`/match/${libraryId}`)}
            style={[styles.matchBtn, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>매칭</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.settingsBtn} onPress={() => setNotesVisible(true)}>
          <Feather name="bookmark" size={18} color={colors.foreground} />
        </Pressable>
        <Pressable style={styles.settingsBtn} onPress={() => setTocVisible(true)}>
          <Text style={[styles.settingsBtnText, { color: colors.foreground }]}>☰</Text>
        </Pressable>
        <Pressable style={styles.settingsBtn} onPress={() => setSettingsPanelVisible(true)}>
          <Text style={[styles.settingsBtnText, { color: colors.foreground }]}>Aa</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {console.log("[READER] 마운트 → initialLocation:", currentLocationRef.current ?? "(없음 — 처음부터)") as unknown as null}
        <Reader
          key={readerKey}
          src={localSrc}
          fileSystem={useFileSystem}
          enableSelection
          flow={flow}
          manager={manager}
          defaultTheme={readerTheme}
          initialLocation={currentLocationRef.current}
          onReady={handleReady}
          onLocationChange={handleLocationChange}
          onSearch={handleSearch}
          onPressAnnotation={handlePressAnnotation}
          menuItems={[
            { label: "하이라이트", action: (cfiRange, text) => handleHighlight(cfiRange, text) },
            { label: "코멘트", action: (cfiRange, text) => handleComment(cfiRange, text) },
          ]}
        />
      </View>

      {readProgress !== null && (
        <View
          style={[
            styles.progressWrap,
            { backgroundColor: colors.background, paddingBottom: insets.bottom + 4 },
          ]}
        >
          <View style={[styles.progressTrack, { backgroundColor: colors.border + "50" }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${readProgress}%` as `${number}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
            {readProgress}%
            {pageInfo ? `  ·  챕터 ${pageInfo.page} / ${pageInfo.total}쪽` : ""}
          </Text>
        </View>
      )}

      <ReaderSettingsPanel
        visible={settingsPanelVisible}
        settings={settings}
        onChange={handleSettingsChange}
        onReset={() => {
          resetSettings();
          setSettingsPanelVisible(false);
        }}
        onClose={() => setSettingsPanelVisible(false)}
      />

      <TocPanel
        visible={tocVisible}
        toc={toc}
        onSelect={(href) => goToLocation(href)}
        onClose={() => setTocVisible(false)}
      />

      <UserNotesPanel
        visible={notesVisible}
        quotes={myHighlightedQuotes}
        userId={user?.id ?? 0}
        cfiByQuoteId={cfiByQuoteIdRef.current}
        onNavigate={(cfi) => goToLocation(cfi)}
        onClose={() => setNotesVisible(false)}
      />

      <CommentSheet
        visible={sheetVisible}
        quoteId={selectedQuote?.id ?? null}
        quoteText={selectedQuote?.text ?? ""}
        onClose={() => setSheetVisible(false)}
        onCommentSaved={() => {
          const cfi = selectedQuote?.cfiRange;
          const qId = selectedQuote?.id;
          if (!cfi || !qId || !canonicalBookId) return;
          if (anchoredRef.current.has(qId)) return;
          const hlStyle = HIGHLIGHT_STYLE_CONFIGS[settingsRef.current.highlightStyle];
          anchoredRef.current.add(qId);
          try {
            addAnnotation(hlStyle.annotationType, cfi, { quoteId: qId }, { color: hlStyle.color, opacity: 0.35 });
          } catch {}
          toggleHighlight.mutate(
            { quoteId: qId, data: { userLibraryId: libraryId, cfiRange: cfi } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetBookQuotesQueryKey(canonicalBookId) });
              },
            }
          );
        }}
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

  const { data: entry, isLoading, isFetching } = useGetLibraryEntry(libraryId, {
    query: {
      enabled: !!libraryId && !!user?.id,
      queryKey: getGetLibraryEntryQueryKey(libraryId),
    },
  });
  const canonicalBookId = entry?.canonicalBookId ?? null;
  const { data: quotes } = useGetBookQuotes(canonicalBookId ?? 0, {
    query: {
      enabled: !!canonicalBookId,
      queryKey: getGetBookQuotesQueryKey(canonicalBookId ?? 0),
    },
  });

  if (Platform.OS === "web") {
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: colors.background, paddingTop: insets.top + 40, padding: 24 },
        ]}
      >
        <Feather name="smartphone" size={40} color={colors.primary} />
        <Text style={[styles.webTitle, { color: colors.foreground }]}>모바일에서 읽어주세요</Text>
        <Text style={[styles.webBody, { color: colors.mutedForeground }]}>
          EPUB 리더는 원본 출판 서식을 그대로 보여주기 위해 기기에서만 동작해요. Expo Go 앱이나
          빌드된 기기에서 이 책을 열어 주세요.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.webBtn, { backgroundColor: colors.primary }]}
        >
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
        libraryId={libraryId}
        canonicalBookId={canonicalBookId}
        isFetching={isFetching}
      />
    </ReaderProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  backBtn: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1 },
  title: { fontSize: 15, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { fontSize: 11, marginTop: 1 },
  matchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  settingsBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  settingsBtnText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  webTitle: { fontSize: 20, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  webBody: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  webBtn: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  progressWrap: { paddingHorizontal: 18, paddingTop: 6 },
  progressTrack: { height: 2, borderRadius: 1, overflow: "hidden" },
  progressFill: { height: 2, borderRadius: 1 },
  progressLabel: { fontSize: 11, textAlign: "center", marginTop: 4, letterSpacing: -0.2 },
});
