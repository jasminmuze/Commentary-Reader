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

const PAGE_ONE_CFI = 'epubcfi(/6/2!/4/1:0)';

function intensityToOpacity(intensity: number): number {
  return Math.max(0.15, Math.min(0.50, intensity));
}

function ReaderInner({
  entry, quotes, libraryId, canonicalBookId,
}: {
  entry: LibraryEntry;
  quotes: Quote[];
  libraryId: number;
  canonicalBookId: number | null;
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
  // 제어된 탐색 상태: 'navigating' 중에는 저장을 차단
  const navPhaseRef = useRef<'idle' | 'navigating'>('idle');
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const styleScript = buildApplyStyleScript(settingsRef.current);

    if (initialLocationRef.current) {
      // Reader initialLocation prop 은 신뢰하지 않음 — onReady 이후 직접 주입
      const targetJson = JSON.stringify(initialLocationRef.current);
      navPhaseRef.current = 'navigating';
      console.log('[NAV] restore 시작 →', initialLocationRef.current);
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        if (navPhaseRef.current === 'navigating') {
          navPhaseRef.current = 'idle';
          console.log('[NAV] restore 타임아웃 — 강제 해제');
        }
      }, 6000);
      injectJavascript(
        `(function(){` +
        `  var target = ${targetJson};` +
        `  rendition.display(target).then(function(){` +
        `    var loc = rendition.currentLocation();` +
        `    var rn = window.ReactNativeWebView || window;` +
        `    rn.postMessage(JSON.stringify({` +
        `      type:'navigationDone',` +
        `      reason:'restore',` +
        `      target: target,` +
        `      resultCfi: loc && loc.start && loc.start.cfi,` +
        `      resultHref: loc && loc.start && loc.start.href` +
        `    }));` +
        styleScript +
        `  });` +
        `})(); true`
      );
    } else {
      console.log('[NAV] onReady — 복원 없음, 스타일 적용');
      injectJavascript(styleScript);
    }
    // startAnchoring(); — 앵커링 별도 후속 작업
  }, [injectJavascript, settingsRef]);

  const handleWebViewMessage = useCallback((event: Record<string, unknown>) => {
    if (event.type === 'navLog') {
      console.log(event.msg as string);
    } else if (event.type === 'navigationDone') {
      const reason = event.reason as string;
      const target = event.target as string;
      const displayTarget = event.displayTarget as string | undefined;
      const resultCfi = event.resultCfi as string | undefined;
      const resultHref = event.resultHref as string | undefined;
      console.log(
        `[NAV] ${reason} 완료 | target: ${target}` +
        (displayTarget ? ` | displayTarget: ${displayTarget}` : '') +
        ` | resultHref: ${resultHref ?? '없음'}` +
        ` | resultCfi: ${resultCfi ?? '없음'}`
      );
      if (resultCfi && resultCfi !== PAGE_ONE_CFI) {
        currentLocationRef.current = resultCfi;
      }
      if (navTimeoutRef.current) {
        clearTimeout(navTimeoutRef.current);
        navTimeoutRef.current = null;
      }
      navPhaseRef.current = 'idle';
    }
  }, []);

  // ANCHORING DISABLED FOR DIAGNOSIS — restore/TOC accuracy test
  // useEffect(() => {
  //   if (readyRef.current && quotes.length > 0) startAnchoring();
  // }, [quotes, startAnchoring]);

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
      // page-1 (titlepage) 이벤트는 마운트·탐색 중 항상 발생 → 항상 무시
      if (!cfi || cfi === PAGE_ONE_CFI) return;

      // UI 업데이트는 항상 수행 (탐색 중 포함)
      setReadProgress(Math.min(100, Math.max(0, Math.round(progress))));
      const disp = location?.start?.displayed;
      if (disp && disp.total > 1) setPageInfo({ page: disp.page, total: disp.total });

      // 제어된 탐색 중에는 저장만 건너뜀
      if (navPhaseRef.current === 'navigating') {
        console.log('[NAV] 탐색 중 — 저장 건너뜀:', cfi);
        return;
      }

      // 정상 저장 경로
      currentLocationRef.current = cfi;
      const clampedProgress = Math.min(100, Math.max(0, Math.round(progress)));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateLocation.mutate(
          { libraryId, data: { location: cfi, readingProgress: clampedProgress } },
          {
            onSuccess: (updated) => {
              queryClient.setQueryData(getGetLibraryEntryQueryKey(libraryId), updated);
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
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
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

  if (!loaded || !localSrc) {
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
        <Reader
          key={readerKey}
          src={localSrc}
          fileSystem={useFileSystem}
          enableSelection
          flow={flow}
          manager={manager}
          defaultTheme={readerTheme}
          onReady={handleReady}
          onLocationChange={handleLocationChange}
          onSearch={handleSearch}
          onPressAnnotation={handlePressAnnotation}
          onWebViewMessage={handleWebViewMessage}
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
        onSelect={(href) => {
          navPhaseRef.current = 'navigating';
          console.log('[NAV] TOC 선택 → href:', href);
          if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
          navTimeoutRef.current = setTimeout(() => {
            if (navPhaseRef.current === 'navigating') {
              navPhaseRef.current = 'idle';
              console.log('[NAV] TOC 탐색 타임아웃 — 강제 해제');
            }
          }, 6000);
          const hrefJson = JSON.stringify(href);
          if (href.includes('#')) {
            // 프래그먼트 있음: 직접 display(href)
            injectJavascript(
              `(function(){` +
              `  var target = ${hrefJson};` +
              `  rendition.display(target).then(function(){` +
              `    var loc = rendition.currentLocation();` +
              `    var rn = window.ReactNativeWebView || window;` +
              `    rn.postMessage(JSON.stringify({` +
              `      type:'navigationDone',` +
              `      reason:'toc',` +
              `      target: target,` +
              `      resultCfi: loc && loc.start && loc.start.cfi,` +
              `      resultHref: loc && loc.start && loc.start.href` +
              `    }));` +
              `  });` +
              `})(); true`
            );
          } else {
            // 프래그먼트 없음: 섹션을 직접 로드 → cfiFromElement()로 시작 CFI 계산 → display(startCfi)
            // display(index) / display(href) 는 섹션이 활성화된 상태에서 인트라-섹션 오프셋을
            // 재사용하므로 첫 클릭에 챕터 중간에 착지하는 버그가 있음
            injectJavascript(
              `(async function(){` +
              `  var href = ${hrefJson};` +
              `  var rn = window.ReactNativeWebView || window;` +
              `  var section = book.spine.get(href);` +
              `  if (section) {` +
              `    await section.load(book.load.bind(book));` +
              `    var doc = section.document;` +
              `    var el = doc.body.querySelector('h1,h2,h3,h4,p,section,div') || doc.body.firstElementChild || doc.body;` +
              `    var startCfi = section.cfiFromElement(el);` +
              `    rn.postMessage(JSON.stringify({type:'navLog',msg:'[NAV] TOC startCfi → '+startCfi}));` +
              `    await rendition.display(startCfi);` +
              `    var loc = rendition.currentLocation();` +
              `    rn.postMessage(JSON.stringify({` +
              `      type:'navigationDone',` +
              `      reason:'toc',` +
              `      target: href,` +
              `      displayTarget: startCfi,` +
              `      resultCfi: loc && loc.start && loc.start.cfi,` +
              `      resultHref: loc && loc.start && loc.start.href` +
              `    }));` +
              `  } else {` +
              `    await rendition.display(href);` +
              `    var loc2 = rendition.currentLocation();` +
              `    rn.postMessage(JSON.stringify({` +
              `      type:'navigationDone',` +
              `      reason:'toc',` +
              `      target: href,` +
              `      displayTarget: href,` +
              `      resultCfi: loc2 && loc2.start && loc2.start.cfi,` +
              `      resultHref: loc2 && loc2.start && loc2.start.href` +
              `    }));` +
              `  }` +
              `})(); true`
            );
          }
          setTocVisible(false);
        }}
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
  // entry가 최초로 fresh하게 로드됐는지 추적.
  // 한 번 true가 되면 background refetch 중에도 Reader를 유지한다.
  const [entryReady, setEntryReady] = useState(false);
  useEffect(() => {
    if (!isFetching && entry) setEntryReady(true);
  }, [isFetching, entry]);

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

  if (!entryReady || !entry) {
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
