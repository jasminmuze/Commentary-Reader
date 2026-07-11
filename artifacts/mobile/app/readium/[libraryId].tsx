import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  requireNativeComponent,
  type ViewProps,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetBookQuotesQueryKey,
  getGetLibraryEntryQueryKey,
  useCreateQuote,
  useGetBookQuotes,
  useGetLibraryEntry,
  useToggleHighlight,
  useUpdateReadingLocation,
} from "@workspace/api-client-react";
import type { LibraryEntry, Quote } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { useFileSystem } from "@/hooks/useFileSystem";
import { useReaderSettings, HIGHLIGHT_STYLE_CONFIGS } from "@/hooks/useReaderSettings";
import type { ReaderSettings } from "@/hooks/useReaderSettings";
import { CommentSheet } from "@/components/CommentSheet";
import { ReaderSettingsPanel } from "@/components/ReaderSettingsPanel";
import { TocPanel } from "@/components/TocPanel";
import type { TocSection } from "@/components/TocPanel";
import { UserNotesPanel } from "@/components/UserNotesPanel";
import { apiUrl } from "@/lib/api";

// ---------------------------------------------------------------------------
// Native bridge types
// ---------------------------------------------------------------------------

type NativeReadiumHostModule = {
  submitPreferences(libraryId: number, settingsJson: string): Promise<boolean>;
  goToLocator(libraryId: number, locatorJson: string): Promise<boolean>;
  goToHref(libraryId: number, href: string): Promise<boolean>;
  applyDecorations(libraryId: number, group: string, decorationsJson: string): Promise<number>;
  clearSelection(libraryId: number): void;
  findQuoteLocators(libraryId: number, requestsJson: string): Promise<string>;
};

type NativeReadiumViewProps = ViewProps & {
  libraryId: number;
  filePath: string;
  locatorJson?: string | null;
  settingsJson?: string | null;
};

type TocEntry = { title: string; href: string; depth: number };

type OpenedEvent = { libraryId: number; title?: string; tocJson?: string; searchable?: boolean };
type LocationEvent = {
  libraryId: number;
  location: string;
  progress: number | null;
  href?: string | null;
};
type HighlightTappedEvent = { libraryId: number; decorationId: string; group: string };
type TextSelectedEvent = {
  libraryId: number;
  action: "highlight" | "comment";
  text: string;
  locatorJson: string;
};
type QuoteLocatedEvent = { libraryId: number; quoteId: number; locatorJson: string };

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

function getNativeReadiumHost(): NativeReadiumHostModule | null {
  if (Platform.OS !== "android" || isExpoGo()) return null;
  const host = NativeModules.NativeReadiumHost as NativeReadiumHostModule | undefined;
  if (!host || typeof host.findQuoteLocators !== "function") return null;
  return host;
}

let NativeReadiumView: React.ComponentType<NativeReadiumViewProps> | null = null;
if (Platform.OS === "android" && !isExpoGo()) {
  try {
    NativeReadiumView = requireNativeComponent<NativeReadiumViewProps>("NativeReadiumView");
  } catch {
    NativeReadiumView = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nativeFilePath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

function percentFromProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function intensityToOpacity(intensity: number): number {
  return Math.max(0.15, Math.min(0.5, intensity));
}

/** Signed 32-bit ARGB int for a "#RRGGBB" hex color at the given opacity. */
function hexTint(hex: string, opacity: number): number {
  const rgb = parseInt(hex.replace("#", ""), 16) & 0xffffff;
  const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  return ((alpha << 24) | rgb) | 0;
}

const COMMUNITY_AMBER = "#F9E04B";

const DECORATION_GROUP = "community";
const QUOTE_DECORATION_PREFIX = "quote-";

function quoteIdFromDecorationId(decorationId: string): number | null {
  if (!decorationId.startsWith(QUOTE_DECORATION_PREFIX)) return null;
  const id = Number(decorationId.slice(QUOTE_DECORATION_PREFIX.length));
  return Number.isFinite(id) ? id : null;
}

/** Converts the native flat TOC (title/href/depth) into the section tree TocPanel renders. */
function tocEntriesToSections(entries: TocEntry[]): TocSection[] {
  const roots: TocSection[] = [];
  const stack: { node: TocSection; depth: number }[] = [];
  for (const entry of entries) {
    const node: TocSection = {
      id: entry.href,
      label: entry.title,
      href: entry.href,
      subitems: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].depth >= entry.depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.subitems.push(node);
    }
    stack.push({ node, depth: entry.depth });
  }
  return roots;
}

function NativeReadiumUnavailableScreen() {
  const colors = useColors();

  return (
    <View style={[styles.center, { backgroundColor: colors.background, padding: 28 }]}>
      <Feather name="book-open" size={34} color={colors.primary} />
      <Text style={[styles.title, { color: colors.foreground, marginTop: 16 }]}>
        Android 개발 빌드가 필요해요
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        네이티브 Readium 리더는 Android 빌드 안에서 동작해요. Expo Go와 웹 미리보기에서는 앱
        셸만 확인할 수 있고, EPUB 리더는 개발용 APK를 설치한 뒤에 열 수 있어요.
      </Text>
      <Pressable
        style={[styles.button, { borderColor: colors.border, marginTop: 20 }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={16} color={colors.foreground} />
        <Text style={[styles.buttonText, { color: colors.foreground }]}>돌아가기</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reader (mounted only when the EPUB is downloaded and settings are loaded)
// ---------------------------------------------------------------------------

function EmbeddedReader({
  entry,
  quotes,
  libraryId,
  canonicalBookId,
  localSrc,
  nativeReadium,
  onFatalError,
}: {
  entry: LibraryEntry;
  quotes: Quote[];
  libraryId: number;
  canonicalBookId: number | null;
  localSrc: string;
  nativeReadium: NativeReadiumHostModule;
  onFatalError: (message: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const createQuote = useCreateQuote();
  const toggleHighlight = useToggleHighlight();
  const updateLocation = useUpdateReadingLocation();
  const {
    settings,
    settingsRef,
    update: updateSettings,
    reset: resetSettings,
    loaded: settingsLoaded,
  } = useReaderSettings();

  const [chromeVisible, setChromeVisible] = useState(true);
  const [opened, setOpened] = useState(false);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [searchable, setSearchable] = useState(false);
  const [anchoredCount, setAnchoredCount] = useState(0);
  const [anchoring, setAnchoring] = useState(false);
  const [readProgress, setReadProgress] = useState<number | null>(
    percentFromProgress(entry.readingProgress ?? null),
  );
  const [settingsPanelVisible, setSettingsPanelVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [notesVisible, setNotesVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<{
    id: number;
    text: string;
    cfiRange?: string;
  } | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  // 초기 위치/설정은 한 번만 캡처 — 뷰가 이미 열린 뒤 prop 이 바뀌어도
  // 네이티브 쪽에서 재오픈하지 않으므로 여기서도 고정한다.
  // 설정은 이 훅 인스턴스의 AsyncStorage 로드가 끝난 뒤에 캡처해야 하므로
  // (각 useReaderSettings 인스턴스가 독립적으로 로드함) loaded 이후 렌더에서 잠근다.
  const initialLocatorRef = useRef<string | null>(entry.lastReadingLocation ?? null);
  const initialSettingsJsonRef = useRef<string | null>(null);
  if (settingsLoaded && initialSettingsJsonRef.current === null) {
    initialSettingsJsonRef.current = JSON.stringify(settingsRef.current);
  }

  const quotesRef = useRef<Quote[]>(quotes);
  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  // quoteId -> locator JSON string (이 판본에서 찾은 위치)
  const locatorByQuoteIdRef = useRef<Map<number, string>>(new Map());
  const requestedQuoteIdsRef = useRef<Set<number>>(new Set());
  const [locatedVersion, setLocatedVersion] = useState(0);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLocationRef = useRef<LocationEvent | null>(null);

  const canonicalBookIdRef = useRef(canonicalBookId);
  useEffect(() => {
    canonicalBookIdRef.current = canonicalBookId;
  }, [canonicalBookId]);

  const ensureMatched = useCallback(() => {
    if (!canonicalBookIdRef.current) {
      Alert.alert(
        "먼저 책을 매칭하세요",
        "커뮤니티 하이라이트와 코멘트를 사용하려면 이 책을 매칭해야 해요.",
        [
          { text: "취소", style: "cancel" },
          { text: "매칭하기", onPress: () => router.push(`/match/${libraryId}`) },
        ],
      );
      return false;
    }
    return true;
  }, [libraryId]);

  // -------------------------------------------------------------------
  // Location persistence (debounced + flush on unmount)
  // -------------------------------------------------------------------

  const flushLocation = useCallback(() => {
    const event = pendingLocationRef.current;
    pendingLocationRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!event) return;
    updateLocation.mutate(
      {
        libraryId,
        data: {
          location: event.location,
          readingProgress: percentFromProgress(event.progress) ?? 0,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetLibraryEntryQueryKey(libraryId), updated);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, queryClient, updateLocation.mutate]);

  // -------------------------------------------------------------------
  // Community highlight decorations
  // -------------------------------------------------------------------

  const myHighlightStyle = settings.highlightStyle;

  const applyAllDecorations = useCallback(() => {
    const myStyle = HIGHLIGHT_STYLE_CONFIGS[myHighlightStyle];
    const decorations: {
      id: string;
      tint: number;
      style: "highlight" | "underline";
      isActive: boolean;
      locator: unknown;
    }[] = [];
    for (const [quoteId, locatorJson] of locatorByQuoteIdRef.current) {
      const quote = quotesRef.current.find((q) => q.id === quoteId);
      let locator: unknown;
      try {
        locator = JSON.parse(locatorJson);
      } catch {
        continue;
      }
      // 내가 하이라이트한 인용은 설정에서 고른 색상/스타일로,
      // 커뮤니티 하이라이트는 인기 강도에 따른 앰버색으로 표시한다.
      const mine = quote?.highlightedByMe === true;
      decorations.push({
        id: `${QUOTE_DECORATION_PREFIX}${quoteId}`,
        tint: mine
          ? myStyle.annotationType === "underline"
            ? hexTint(myStyle.color, 1)
            : hexTint(myStyle.color, 0.45)
          : hexTint(COMMUNITY_AMBER, intensityToOpacity(quote?.highlightIntensity ?? 0.35)),
        style: mine ? myStyle.annotationType : "highlight",
        isActive: false,
        locator,
      });
    }
    setAnchoredCount(decorations.length);
    if (decorations.length === 0) return;
    nativeReadium
      .applyDecorations(libraryId, DECORATION_GROUP, JSON.stringify(decorations))
      .catch((error) => {
        console.warn("[NativeReadium] 데코레이션 적용 실패:", error);
      });
  }, [libraryId, nativeReadium, myHighlightStyle]);

  useEffect(() => {
    if (opened) applyAllDecorations();
  }, [opened, locatedVersion, quotes, applyAllDecorations]);

  // 아직 위치를 찾지 않은 인용을 이 판본에서 검색.
  // 1차: 인용 전체 텍스트로 검색해 문장 전체가 하이라이트되게 하고,
  // 2차: (판본 차이로) 못 찾은 인용만 선행 substring 으로 폴백 검색한다.
  useEffect(() => {
    if (!opened || !searchable || !canonicalBookId) return;
    const requests = quotes
      .filter(
        (q) =>
          q.searchText.length > 0 &&
          !requestedQuoteIdsRef.current.has(q.id) &&
          !locatorByQuoteIdRef.current.has(q.id),
      )
      .map((q) => {
        requestedQuoteIdsRef.current.add(q.id);
        return {
          quoteId: q.id,
          fullText: q.text.replace(/\s+/g, " ").trim(),
          searchText: q.searchText,
        };
      });
    if (requests.length === 0) return;
    setAnchoring(true);
    (async () => {
      const fullRequests = requests
        .filter((r) => r.fullText.length > 0)
        .map((r) => ({ quoteId: r.quoteId, searchText: r.fullText }));
      const foundIds = new Set<number>();
      if (fullRequests.length > 0) {
        try {
          const resultJson = await nativeReadium.findQuoteLocators(
            libraryId,
            JSON.stringify(fullRequests),
          );
          const results = JSON.parse(resultJson) as { quoteId: number }[];
          for (const r of results) foundIds.add(r.quoteId);
        } catch (error) {
          console.warn("[NativeReadium] 인용 전체 텍스트 검색 실패:", error);
        }
      }
      const fallback = requests
        .filter((r) => !foundIds.has(r.quoteId) && r.searchText !== r.fullText)
        .map((r) => ({ quoteId: r.quoteId, searchText: r.searchText }));
      if (fallback.length > 0) {
        await nativeReadium.findQuoteLocators(libraryId, JSON.stringify(fallback));
      }
    })()
      .catch((error) => {
        console.warn("[NativeReadium] 인용 위치 검색 실패:", error);
      })
      .finally(() => setAnchoring(false));
  }, [opened, searchable, canonicalBookId, quotes, libraryId, nativeReadium]);

  // -------------------------------------------------------------------
  // Selection actions (하이라이트 / 댓글)
  // -------------------------------------------------------------------

  const handleTextSelected = useCallback(
    (event: TextSelectedEvent) => {
      const trimmed = event.text.trim();
      if (trimmed.length < 8) {
        Alert.alert("너무 짧아요", "최소 8자 이상 선택해 주세요.");
        return;
      }
      if (!ensureMatched()) return;
      const bookId = canonicalBookIdRef.current;
      if (!bookId) return;

      createQuote.mutate(
        { bookId, data: { text: trimmed.slice(0, 1000) } },
        {
          onSuccess: (quote) => {
            locatorByQuoteIdRef.current.set(quote.id, event.locatorJson);
            requestedQuoteIdsRef.current.add(quote.id);
            setLocatedVersion((v) => v + 1);
            if (event.action === "highlight") {
              toggleHighlight.mutate(
                {
                  quoteId: quote.id,
                  data: { userLibraryId: libraryId, cfiRange: event.locatorJson },
                },
                {
                  onSuccess: () => {
                    queryClient.invalidateQueries({
                      queryKey: getGetBookQuotesQueryKey(bookId),
                    });
                  },
                },
              );
            } else {
              setSelectedQuote({ id: quote.id, text: quote.text, cfiRange: event.locatorJson });
              setSheetVisible(true);
            }
          },
          onError: () =>
            Alert.alert(
              event.action === "highlight" ? "하이라이트 실패" : "실패",
              "다시 시도해 주세요.",
            ),
        },
      );
    },
    [createQuote, ensureMatched, libraryId, queryClient, toggleHighlight],
  );
  const handleTextSelectedRef = useRef(handleTextSelected);
  useEffect(() => {
    handleTextSelectedRef.current = handleTextSelected;
  }, [handleTextSelected]);

  // -------------------------------------------------------------------
  // Native event subscriptions
  // -------------------------------------------------------------------

  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener("NativeReadiumHost.opened", (event: OpenedEvent) => {
        if (event.libraryId !== libraryId) return;
        setOpened(true);
        setSearchable(event.searchable === true);
        try {
          setToc(JSON.parse(event.tocJson ?? "[]") as TocEntry[]);
        } catch {
          setToc([]);
        }
      }),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.locationChanged",
        (event: LocationEvent) => {
          if (event.libraryId !== libraryId || !event.location) return;
          const percent = percentFromProgress(event.progress);
          if (percent !== null) setReadProgress(percent);
          // Debounce: the navigator emits a location on every scroll tick.
          pendingLocationRef.current = event;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            const pending = pendingLocationRef.current;
            pendingLocationRef.current = null;
            saveTimerRef.current = null;
            if (!pending) return;
            updateLocation.mutate(
              {
                libraryId,
                data: {
                  location: pending.location,
                  readingProgress: percentFromProgress(pending.progress) ?? 0,
                },
              },
              {
                onSuccess: (updated) => {
                  queryClient.setQueryData(getGetLibraryEntryQueryKey(libraryId), updated);
                },
              },
            );
          }, 1200);
        },
      ),
      DeviceEventEmitter.addListener("NativeReadiumHost.centerTapped", (event: { libraryId: number }) => {
        if (event.libraryId !== libraryId) return;
        setChromeVisible((visible) => !visible);
      }),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.highlightTapped",
        (event: HighlightTappedEvent) => {
          if (event.libraryId !== libraryId) return;
          const quoteId = quoteIdFromDecorationId(event.decorationId);
          if (quoteId === null) return;
          const quote = quotesRef.current.find((q) => q.id === quoteId);
          setSelectedQuote({
            id: quoteId,
            text: quote?.text ?? "",
            cfiRange: locatorByQuoteIdRef.current.get(quoteId),
          });
          setSheetVisible(true);
        },
      ),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.textSelected",
        (event: TextSelectedEvent) => {
          if (event.libraryId !== libraryId) return;
          handleTextSelectedRef.current(event);
        },
      ),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.quoteLocated",
        (event: QuoteLocatedEvent) => {
          if (event.libraryId !== libraryId) return;
          locatorByQuoteIdRef.current.set(event.quoteId, event.locatorJson);
          setLocatedVersion((v) => v + 1);
        },
      ),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.error",
        (event: { libraryId: number; message?: string }) => {
          if (event.libraryId !== libraryId) return;
          onFatalError(event.message ?? "리더를 여는 중 오류가 발생했어요.");
        },
      ),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.debug",
        (event: { libraryId: number; message: string }) => {
          if (event.libraryId === libraryId) {
            console.log(`[NativeReadium] ${event.message}`);
          }
        },
      ),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.resourceLoadFailed",
        (event: { libraryId: number; href?: string; message?: string }) => {
          if (event.libraryId === libraryId) {
            console.warn(
              `[NativeReadium] resource load failed: ${event.href ?? "?"} — ${event.message ?? ""}`,
            );
          }
        },
      ),
    ];

    return () => {
      flushLocation();
      subs.forEach((sub) => sub.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, onFatalError]);

  // -------------------------------------------------------------------
  // Settings / TOC handlers
  // -------------------------------------------------------------------

  const handleSettingsChange = useCallback(
    (patch: Partial<ReaderSettings>) => {
      updateSettings(patch);
      const next = { ...settingsRef.current, ...patch };
      nativeReadium.submitPreferences(libraryId, JSON.stringify(next)).catch((error) => {
        console.warn("[NativeReadium] 설정 적용 실패:", error);
      });
    },
    [libraryId, nativeReadium, settingsRef, updateSettings],
  );

  const handleSettingsReset = useCallback(() => {
    resetSettings();
    setSettingsPanelVisible(false);
    nativeReadium.submitPreferences(libraryId, "{}").catch((error) => {
      console.warn("[NativeReadium] 설정 초기화 실패:", error);
    });
  }, [libraryId, nativeReadium, resetSettings]);

  const tocSections = useMemo(() => tocEntriesToSections(toc), [toc]);

  const myHighlightedQuotes = useMemo(
    () => quotes.filter((q) => q.highlightedByMe === true),
    [quotes],
  );

  const subtitle = canonicalBookId
    ? anchoring
      ? "커뮤니티 하이라이트 표시 중…"
      : `커뮤니티 하이라이트 ${anchoredCount}개`
    : "매칭되지 않음 · 텍스트를 길게 눌러 선택하세요";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {NativeReadiumView && initialSettingsJsonRef.current !== null ? (
        <NativeReadiumView
          style={StyleSheet.absoluteFill}
          libraryId={libraryId}
          filePath={nativeFilePath(localSrc)}
          locatorJson={initialLocatorRef.current}
          settingsJson={initialSettingsJsonRef.current}
        />
      ) : null}

      {!opened ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, marginTop: 10, fontSize: 13 }}>
            책 여는 중…
          </Text>
        </View>
      ) : null}

      {chromeVisible ? (
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 10,
              borderBottomColor: colors.border + "80",
              backgroundColor: colors.background,
            },
          ]}
        >
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
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
      ) : null}

      {chromeVisible && readProgress !== null ? (
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
          </Text>
        </View>
      ) : null}

      <ReaderSettingsPanel
        visible={settingsPanelVisible}
        settings={settings}
        onChange={handleSettingsChange}
        onReset={handleSettingsReset}
        onClose={() => setSettingsPanelVisible(false)}
      />

      <TocPanel
        visible={tocVisible}
        toc={tocSections}
        onSelect={(href) => {
          setTocVisible(false);
          nativeReadium.goToHref(libraryId, href).catch((error) => {
            console.warn("[NativeReadium] 목차 이동 실패:", error);
          });
        }}
        onClose={() => setTocVisible(false)}
      />

      <UserNotesPanel
        visible={notesVisible}
        quotes={myHighlightedQuotes}
        userId={user?.id ?? 0}
        cfiByQuoteId={locatorByQuoteIdRef.current}
        onNavigate={(locatorJson) => {
          setNotesVisible(false);
          nativeReadium.goToLocator(libraryId, locatorJson).catch((error) => {
            console.warn("[NativeReadium] 노트 이동 실패:", error);
          });
        }}
        onClose={() => setNotesVisible(false)}
      />

      <CommentSheet
        visible={sheetVisible}
        quoteId={selectedQuote?.id ?? null}
        quoteText={selectedQuote?.text ?? ""}
        onClose={() => setSheetVisible(false)}
        onCommentSaved={(visibility) => {
          const locatorJson = selectedQuote?.cfiRange;
          const qId = selectedQuote?.id;
          const bookId = canonicalBookIdRef.current;
          if (!locatorJson || !qId || !bookId) return;
          toggleHighlight.mutate(
            { quoteId: qId, data: { userLibraryId: libraryId, cfiRange: locatorJson, visibility } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetBookQuotesQueryKey(bookId) });
              },
            },
          );
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Route: entry/quotes loading + EPUB download, then mounts the reader
// ---------------------------------------------------------------------------

export default function ReadiumRoute() {
  const colors = useColors();
  const {
    cacheDirectory,
    getFileInfo,
    downloadFile,
    deleteAsync,
    readAsStringAsync,
    moveAsync,
  } = useFileSystem();
  const { user } = useUser();
  const { loaded: settingsLoaded } = useReaderSettings();
  const params = useLocalSearchParams<{ libraryId?: string }>();
  const libraryId = Number(params.libraryId);
  const nativeReadium = useMemo(() => getNativeReadiumHost(), []);

  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [status, setStatus] = useState("EPUB 준비 중…");
  const [retryNonce, setRetryNonce] = useState(0);

  const { data: entry, isFetching } = useGetLibraryEntry(libraryId, {
    query: {
      enabled: Number.isFinite(libraryId) && !!user?.id,
      queryKey: getGetLibraryEntryQueryKey(libraryId),
    },
  });
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

  useEffect(() => {
    if (!entry || !cacheDirectory || !nativeReadium) return;

    let cancelled = false;
    const remote = apiUrl(entry.epubUrl);
    const dest = `${cacheDirectory}native_readium_epub_v2_${libraryId}.epub`;
    const tmp = `${dest}.${Date.now()}.tmp`;

    const isZip = async (uri: string): Promise<boolean> => {
      const head = await readAsStringAsync(uri, {
        encoding: "base64",
        position: 0,
        length: 4,
      });
      return head.startsWith("UEsD");
    };

    (async () => {
      setStatus("로컬 EPUB 캐시 확인 중…");
      const info = await getFileInfo(dest);
      if (cancelled) return;

      if (info.exists && (info.size ?? 0) > 0 && (await isZip(dest))) {
        if (!cancelled) setLocalSrc(info.uri);
        return;
      }

      setStatus("EPUB 다운로드 중…");
      const result = await downloadFile(remote, tmp);

      if (!result.uri) {
        await deleteAsync(tmp);
        if (!cancelled) setFatalError("EPUB 다운로드에 실패했어요.");
        return;
      }

      const tmpInfo = await getFileInfo(tmp);
      if ((tmpInfo.size ?? 0) <= 0 || !(await isZip(tmp))) {
        await deleteAsync(tmp);
        if (!cancelled) {
          setFatalError(
            "내려받은 파일이 올바른 EPUB이 아니에요 (서버가 오류 페이지를 반환했을 수 있어요). 다시 시도해 주세요.",
          );
        }
        return;
      }

      if (cancelled) {
        await deleteAsync(tmp);
        return;
      }

      await deleteAsync(dest);
      await moveAsync(tmp, dest);
      const finalInfo = await getFileInfo(dest);
      if (!cancelled) setLocalSrc(finalInfo.uri);
    })().catch(async (error) => {
      try {
        await deleteAsync(tmp);
      } catch {
        // best-effort cleanup
      }
      if (!cancelled) {
        setFatalError(error instanceof Error ? error.message : "EPUB 다운로드에 실패했어요.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    entry,
    cacheDirectory,
    deleteAsync,
    downloadFile,
    getFileInfo,
    libraryId,
    moveAsync,
    nativeReadium,
    readAsStringAsync,
    retryNonce,
  ]);

  const handleFatalError = useCallback((message: string) => {
    setFatalError(message);
  }, []);

  if (!nativeReadium || !NativeReadiumView) return <NativeReadiumUnavailableScreen />;

  if (!Number.isFinite(libraryId)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Text style={{ color: colors.foreground }}>잘못된 서재 항목이에요.</Text>
      </View>
    );
  }

  if (fatalError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="alert-circle" size={34} color="#FF6B6B" />
        <Text style={[styles.title, { color: colors.foreground, marginTop: 16 }]}>
          리더를 열 수 없어요
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{fatalError}</Text>
        <Pressable
          style={[styles.button, { borderColor: colors.border, marginTop: 20 }]}
          onPress={() => {
            setFatalError(null);
            setLocalSrc(null);
            setRetryNonce((value) => value + 1);
          }}
        >
          <Feather name="refresh-cw" size={16} color={colors.foreground} />
          <Text style={[styles.buttonText, { color: colors.foreground }]}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  if (!entryReady || !entry || !localSrc || !settingsLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 28 }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, marginTop: 18 }]}>
          {entry?.book?.title ?? entry?.originalTitle ?? "책 여는 중"}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {isFetching && !entryReady ? "서재 항목 불러오는 중…" : status}
        </Text>
      </View>
    );
  }

  return (
    <EmbeddedReader
      entry={entry}
      quotes={quotes ?? []}
      libraryId={libraryId}
      canonicalBookId={canonicalBookId}
      localSrc={localSrc}
      nativeReadium={nativeReadium}
      onFatalError={handleFatalError}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    zIndex: 10,
  },
  backBtn: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: "700", letterSpacing: -0.3 },
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
  progressWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 6,
    zIndex: 10,
  },
  progressTrack: { height: 2, borderRadius: 1, overflow: "hidden" },
  progressFill: { height: 2, borderRadius: 1 },
  progressLabel: { fontSize: 11, textAlign: "center", marginTop: 4, letterSpacing: -0.2 },
});
