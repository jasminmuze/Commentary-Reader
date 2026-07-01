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
const PAGE_ONE_CFI_PREFIX = 'epubcfi(/6/2!';

type NavPhase = 'idle' | 'restoring' | 'navigating';
type NavReason = 'restore' | 'toc';
type NavTransaction = {
  reason: NavReason;
  target?: string;
  href?: string;
  resultCfi?: string;
  saved?: boolean;
  completed: boolean;
};

type ReaderLocator = {
  raw: string;
  cfi?: string;
  href?: string;
  progress: number | null;
  isSnapshot: boolean;
};

type ReaderLocatorSnapshot = {
  v: 2;
  cfi?: string;
  href?: string;
  progress?: number | null;
};

function normalizeProgress(progress: unknown): number | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  const percent = progress <= 1 ? progress * 100 : progress;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function isBootLocation(cfi?: string, href?: string): boolean {
  const normalizedHref = href?.toLowerCase() ?? "";
  return (
    cfi === PAGE_ONE_CFI ||
    cfi?.startsWith(PAGE_ONE_CFI_PREFIX) === true ||
    normalizedHref.includes("titlepage")
  );
}

function normalizeHref(href?: string): string | undefined {
  const withoutFragment = href?.split('#')[0];
  return withoutFragment?.replace(/^\.?\//, '');
}

function hrefsMatch(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeHref(left);
  const normalizedRight = normalizeHref(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function spineKeyFromCfi(cfi?: string): string | undefined {
  return cfi?.match(/\/6\/(\d+)!/)?.[1];
}

function locationMatchesNavigation(cfi: string, href: string | undefined, navTxn: NavTransaction): boolean {
  const target = navTxn.target;
  const targetCfi = navTxn.resultCfi ?? (target?.startsWith('epubcfi(') ? target : undefined);
  const targetSpine = spineKeyFromCfi(targetCfi);
  const eventSpine = spineKeyFromCfi(cfi);

  if (targetCfi && cfi === targetCfi) return true;
  if (targetSpine && eventSpine && targetSpine !== eventSpine) return false;

  const targetHref = navTxn.href ?? (target && !target.startsWith('epubcfi(') ? target : undefined);
  if (hrefsMatch(targetHref, href)) return true;

  return !!targetSpine && !!eventSpine && targetSpine === eventSpine;
}

function intensityToOpacity(intensity: number): number {
  return Math.max(0.15, Math.min(0.50, intensity));
}

function parseReaderLocator(value?: string | null, fallbackProgress?: number | null): ReaderLocator | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ReaderLocatorSnapshot;
    if (parsed && parsed.v === 2 && (parsed.cfi || parsed.href)) {
      return {
        raw: value,
        cfi: parsed.cfi,
        href: parsed.href,
        progress: normalizeProgress(parsed.progress) ?? normalizeProgress(fallbackProgress) ?? null,
        isSnapshot: true,
      };
    }
  } catch {
    // Older rows store the raw EPUB CFI directly.
  }
  return {
    raw: value,
    cfi: value.startsWith('epubcfi(') ? value : undefined,
    href: value.startsWith('epubcfi(') ? undefined : value,
    progress: normalizeProgress(fallbackProgress) ?? null,
    isSnapshot: false,
  };
}

function serializeReaderLocator(cfi: string, href: string | undefined, progress: number): string {
  const snapshot: ReaderLocatorSnapshot = { v: 2, cfi, progress };
  if (href) snapshot.href = href;
  return JSON.stringify(snapshot);
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
  const initialLocator = useMemo(
    () => parseReaderLocator(entry.lastReadingLocation, entry.readingProgress ?? null),
    // Mount-time seed only; the Reader stays alive during background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLocationRef = useRef<string | undefined>(initialLocator?.cfi ?? initialLocator?.href);
  const currentHrefRef = useRef<string | undefined>(initialLocator?.href);
  const lastPersistedLocationRef = useRef<string | undefined>(entry.lastReadingLocation ?? undefined);
  // 복원할 대상 locator — 마운트 시 한 번만 캡처 (refetch로 변경되면 안 됨)
  const initialLocationRef = useRef<ReaderLocator | null>(initialLocator);
  // 제어된 탐색 상태: 복원/TOC 이동 중에는 위치 저장을 차단
  const navPhaseRef = useRef<NavPhase>('idle');
  const navTxnRef = useRef<NavTransaction | null>(null);
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
  const [readProgress, setReadProgress] = useState<number | null>(
    initialLocator?.progress ?? normalizeProgress(entry.readingProgress ?? null) ?? 0,
  );
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null);

  const quotesRef = useRef<Quote[]>([]);
  const pendingRef = useRef<Quote[]>([]);
  const anchoredRef = useRef<Set<number>>(new Set());
  const idxRef = useRef(0);
  const readyRef = useRef(false);
  const runningRef = useRef(false);
  const cfiByQuoteIdRef = useRef<Map<number, string>>(new Map());

  useEffect(() => { quotesRef.current = quotes; }, [quotes]);

  const beginControlledNavigation = useCallback((reason: NavReason, target?: string, href?: string) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    navPhaseRef.current = reason === 'restore' ? 'restoring' : 'navigating';
    navTxnRef.current = { reason, target, href: normalizeHref(href), completed: false };
  }, []);

  const scheduleLocationSave = useCallback((cfi: string, progress: number, href?: string) => {
    currentLocationRef.current = cfi;
    const serializedHref = href ?? currentHrefRef.current;
    currentHrefRef.current = serializedHref;
    const serialized = serializeReaderLocator(cfi, serializedHref, progress);
    if (lastPersistedLocationRef.current === serialized) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    console.log('[NAV] 위치 저장 예약 →', cfi, serializedHref ? `| href: ${serializedHref}` : '', `| progress: ${progress}`);
    saveTimer.current = setTimeout(() => {
      updateLocation.mutate(
        { libraryId, data: { location: serialized, readingProgress: progress } },
        {
          onSuccess: (updated) => {
            lastPersistedLocationRef.current = serialized;
            queryClient.setQueryData(getGetLibraryEntryQueryKey(libraryId), updated);
            console.log('[NAV] 위치 저장 완료 →', cfi, serializedHref ? `| href: ${serializedHref}` : '', `| progress: ${progress}`);
          },
          onError: () => {
            console.log('[NAV] 위치 저장 실패 →', cfi, serializedHref ? `| href: ${serializedHref}` : '', `| progress: ${progress}`);
          },
        }
      );
    }, 1500);
  }, [libraryId, queryClient, updateLocation]);

  const startAnchoring = useCallback(() => {
    if (runningRef.current || !readyRef.current || !canonicalBookId) return;
    // Never run search()-based anchoring while a controlled navigation
    // (restore / TOC jump) is in flight — it would race rendition.display().
    if (navPhaseRef.current !== 'idle') return;
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
      const restoreLocator = initialLocationRef.current;
      const restoreTarget = restoreLocator.cfi ?? restoreLocator.href;
      const restoreHref = restoreLocator.href;
      const targetJson = JSON.stringify(restoreTarget);
      const hrefJson = JSON.stringify(restoreHref ?? null);
      beginControlledNavigation('restore', restoreTarget, restoreHref);
      console.log('[NAV] restore 시작 →', restoreTarget, restoreHref ? `| href: ${restoreHref}` : '');
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => {
        if (navPhaseRef.current === 'restoring') {
          navPhaseRef.current = 'idle';
          navTxnRef.current = null;
          console.log('[NAV] restore 타임아웃 — 강제 해제');
          startAnchoring();
        }
      }, 6000);
      injectJavascript(
        `(async function(){` +
        `  var target = ${targetJson};` +
        `  var rn = window.ReactNativeWebView || window;` +
        `  try {` +
        `    var fallbackHref = ${hrefJson};` +
        `    await rendition.display(target);` +
        `    await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });` +
        `    var loc = rendition.currentLocation();` +
        `    var start = loc && loc.start;` +
        `    if (!start && fallbackHref && fallbackHref !== target) {` +
        `      await rendition.display(fallbackHref);` +
        `      await new Promise(function(resolve){ requestAnimationFrame(function(){ requestAnimationFrame(resolve); }); });` +
        `      loc = rendition.currentLocation();` +
        `      start = loc && loc.start;` +
        `    }` +
        `    rn.postMessage(JSON.stringify({` +
        `      type:'navigationDone',` +
        `      reason:'restore',` +
        `      target: target,` +
        `      resultCfi: start && start.cfi,` +
        `      resultHref: start && start.href,` +
        `      fallbackHref: fallbackHref,` +
        `      resultProgress: start && typeof start.percentage === 'number' ? start.percentage : null,` +
        `      resultPage: start && start.displayed && start.displayed.page,` +
        `      resultTotal: start && start.displayed && start.displayed.total` +
        `    }));` +
        styleScript +
        `  } catch (err) {` +
        `    rn.postMessage(JSON.stringify({` +
        `      type:'navigationError',` +
        `      reason:'restore',` +
        `      target: target,` +
        `      message: String(err && err.message ? err.message : err)` +
        `    }));` +
        `  }` +
        `})(); true`
      );
    } else {
      console.log('[NAV] onReady — 복원 없음, 스타일 적용');
      injectJavascript(styleScript);
    }
    startAnchoring();
  }, [beginControlledNavigation, injectJavascript, settingsRef, startAnchoring]);

  const handleWebViewMessage = useCallback((event: Record<string, unknown>) => {
    if (event.type === 'navLog') {
      console.log(event.msg as string);
    } else if (event.type === 'navigationError') {
      console.log(
        `[NAV] ${event.reason as string} 실패 | target: ${event.target as string}` +
        ` | message: ${event.message as string}`
      );
      if (navTimeoutRef.current) {
        clearTimeout(navTimeoutRef.current);
        navTimeoutRef.current = null;
      }
      navPhaseRef.current = 'idle';
      navTxnRef.current = null;
      startAnchoring();
    } else if (event.type === 'navigationDone') {
      const reason = event.reason as string;
      const target = event.target as string;
      const displayTarget = event.displayTarget as string | undefined;
      const resultCfi = event.resultCfi as string | undefined;
      const resultHref = event.resultHref as string | undefined;
      const fallbackHref = event.fallbackHref as string | undefined;
      const resultProgress = normalizeProgress(event.resultProgress);
      const resultPage = typeof event.resultPage === "number" ? event.resultPage : null;
      const resultTotal = typeof event.resultTotal === "number" ? event.resultTotal : null;
      console.log(
        `[NAV] ${reason} 완료 | target: ${target}` +
        (displayTarget ? ` | displayTarget: ${displayTarget}` : '') +
        ` | resultHref: ${resultHref ?? '없음'}` +
        ` | resultCfi: ${resultCfi ?? '없음'}`
      );
      const targetCfi = target?.startsWith('epubcfi(') ? target : undefined;
      const stableHref = resultHref ?? fallbackHref ?? (!targetCfi ? target : undefined);
      const stableCfi =
        reason === 'restore' && targetCfi && !isBootLocation(targetCfi, stableHref)
          ? targetCfi
          : resultCfi && !isBootLocation(resultCfi, stableHref)
            ? resultCfi
            : undefined;
      if (stableCfi) {
        currentLocationRef.current = stableCfi;
      }
      if (stableHref) {
        currentHrefRef.current = stableHref;
      }
      if (resultProgress !== null) {
        setReadProgress(resultProgress);
      }
      if ((reason === 'restore' || reason === 'toc') && navTxnRef.current) {
        navTxnRef.current = {
          ...navTxnRef.current,
          target,
          href: stableHref,
          resultCfi: stableCfi ?? resultCfi,
          saved: reason === 'toc' && !!stableCfi,
          completed: true,
        };
      }
      if (reason === 'toc' && stableCfi) {
        scheduleLocationSave(stableCfi, resultProgress ?? readProgress ?? 0, stableHref);
      }
      if (resultPage !== null && resultTotal !== null && resultTotal > 1) {
        setPageInfo({ page: resultPage, total: resultTotal });
      }
      if (navTimeoutRef.current) {
        clearTimeout(navTimeoutRef.current);
        navTimeoutRef.current = null;
      }
      navPhaseRef.current = 'idle';
      // Resume community-highlight anchoring once controlled navigation settles,
      // so deferred search() calls never raced the in-flight rendition.display().
      startAnchoring();
    }
  }, [readProgress, scheduleLocationSave, startAnchoring]);

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
      const href = location?.start?.href;
      if (!cfi) return;

      // Boot/titlepage relocated events can arrive before or after controlled
      // restore. Never let them replace a real saved reading position.
      if (isBootLocation(cfi, href)) {
        console.log('[NAV] boot/titlepage 위치 이벤트 무시:', href ?? 'href 없음', cfi);
        return;
      }

      const clampedProgress = normalizeProgress(progress) ?? 0;
      const disp = location?.start?.displayed;
      const navTxn = navTxnRef.current;

      if (navPhaseRef.current !== 'idle') {
        if (navTxn?.reason === 'restore' && navTxn.target?.startsWith('epubcfi(')) {
          currentLocationRef.current = navTxn.target;
          currentHrefRef.current = navTxn.href ?? href ?? currentHrefRef.current;
        }
        console.log('[NAV] 탐색 중 — UI/저장 건너뜀:', href ?? 'href 없음', cfi);
        return;
      }

      if (navTxn?.completed) {
        const matchedNavTarget = locationMatchesNavigation(cfi, href, navTxn);
        if (!matchedNavTarget) {
          console.log('[NAV] 제어 탐색 후 지연 이벤트 — UI/저장 건너뜀:', href ?? 'href 없음', cfi);
          return;
        }

        setReadProgress(clampedProgress);
        if (disp && disp.total > 1) setPageInfo({ page: disp.page, total: disp.total });
        if (navTxn.reason === 'restore' && navTxn.target?.startsWith('epubcfi(')) {
          currentLocationRef.current = navTxn.target;
          currentHrefRef.current = navTxn.href ?? href ?? currentHrefRef.current;
        } else {
          currentLocationRef.current = cfi;
          currentHrefRef.current = href ?? navTxn.href ?? currentHrefRef.current;
        }
        navTxnRef.current = null;
        if (navTxn.reason === 'toc' && !navTxn.saved) {
          scheduleLocationSave(cfi, clampedProgress, href ?? navTxn.href);
        }
        console.log(
          navTxn.reason === 'toc'
            ? navTxn.saved
              ? '[NAV] 제어 탐색 후 목표 이벤트 — 저장 유지/해제:'
              : '[NAV] 제어 탐색 후 목표 이벤트 — 저장 갱신/해제:'
            : '[NAV] 제어 탐색 후 목표 이벤트 — 저장 건너뜀/해제:',
          href ?? 'href 없음',
          cfi,
        );
        return;
      }

      if (runningRef.current) {
        console.log('[ANCHOR] 앵커링 중 — UI/저장 건너뜀:', href ?? 'href 없음', cfi);
        return;
      }

      // 정상 UI/저장 경로
      setReadProgress(clampedProgress);
      if (disp && disp.total > 1) setPageInfo({ page: disp.page, total: disp.total });
      scheduleLocationSave(cfi, clampedProgress, href);
    },
    [scheduleLocationSave]
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
          beginControlledNavigation('toc', href, normalizeHref(href));
          console.log('[NAV] TOC 선택 → href:', href);
          if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
          navTimeoutRef.current = setTimeout(() => {
            if (navPhaseRef.current === 'navigating') {
              navPhaseRef.current = 'idle';
              navTxnRef.current = null;
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
              `      resultHref: loc && loc.start && loc.start.href,` +
              `      resultProgress: loc && loc.start && typeof loc.start.percentage === 'number' ? loc.start.percentage : null,` +
              `      resultPage: loc && loc.start && loc.start.displayed && loc.start.displayed.page,` +
              `      resultTotal: loc && loc.start && loc.start.displayed && loc.start.displayed.total` +
              `    }));` +
              `  });` +
              `})(); true`
            );
          } else {
            // 프래그먼트 없음: spine section 시작으로 한 번만 이동
            // 반복 수렴 루프는 epub.js가 계산한 현재 위치와 오가며 챕터 밖으로 흔들릴 수 있음
            injectJavascript(
              `(async function(){` +
              `  var href = ${hrefJson};` +
              `  var rn = window.ReactNativeWebView || window;` +
              `  var section = book.spine.get(href.split('/')[1])` +
              `             || book.spine.get(href)` +
              `             || book.spine.get(href.split('/').slice(1).join('/'));` +
              `  var displayTarget = section ? (section.href || section.idref || href) : href;` +
              `  rn.postMessage(JSON.stringify({type:'navLog', msg:'[NAV] TOC section resolved: '+(section?(section.href||section.idref||section.index):'null')}));` +
              `  try {` +
              `    await rendition.display(displayTarget);` +
              `    await new Promise(function(resolve){ requestAnimationFrame(resolve); });` +
              `    var loc = rendition.currentLocation();` +
              `    rn.postMessage(JSON.stringify({type:'navigationDone',reason:'toc',target:href,displayTarget:displayTarget,resultCfi:loc&&loc.start&&loc.start.cfi,resultHref:loc&&loc.start&&loc.start.href,resultProgress:loc&&loc.start&&typeof loc.start.percentage==='number'?loc.start.percentage:null,resultPage:loc&&loc.start&&loc.start.displayed&&loc.start.displayed.page,resultTotal:loc&&loc.start&&loc.start.displayed&&loc.start.displayed.total}));` +
              `  } catch (err) {` +
              `    rn.postMessage(JSON.stringify({type:'navigationError',reason:'toc',target:href,message:String(err&&err.message?err.message:err)}));` +
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
        onCommentSaved={(visibility) => {
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
            { quoteId: qId, data: { userLibraryId: libraryId, cfiRange: cfi, visibility } },
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
