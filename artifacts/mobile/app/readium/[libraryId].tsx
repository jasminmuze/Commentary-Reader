import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { ReadiumView, useSearch } from "react-native-readium";
import type {
  Decoration,
  DecorationActivatedEvent,
  DecorationGroup,
  File as ReadiumFile,
  Link,
  Locator,
  PublicationReadyEvent,
  ReadiumProps,
  ReadiumViewRef,
  SearchResult,
  SelectionAction,
  SelectionActionEvent,
} from "react-native-readium";
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
import { CommentSheet } from "@/components/CommentSheet";
import { ReaderSettingsPanel } from "@/components/ReaderSettingsPanel";
import { apiUrl } from "@/lib/api";
import {
  HIGHLIGHT_STYLE_CONFIGS,
  LINE_SPACING_VALUES,
  MARGIN_VALUES,
  THEME_CONFIGS,
  useReaderSettings,
  type ReaderSettings,
} from "@/hooks/useReaderSettings";

const READIUM_LOCATION_VERSION = 3;
const selectionActions: SelectionAction[] = [
  { id: "highlight", label: "하이라이트" },
  { id: "comment", label: "코멘트" },
  { id: "define", label: "사전" },
];

type StoredReadiumLocation = {
  v: typeof READIUM_LOCATION_VERSION;
  engine: "readium";
  locator: Locator;
  progress?: number | null;
};

type LegacyReaderLocation = {
  v?: number;
  cfi?: string;
  href?: string;
  progress?: number | null;
};

type QuoteWithLocation = Quote & {
  cfiRange?: string | null;
  highlightedByMe?: boolean | null;
  highlightIntensity?: number | null;
};

type SelectedQuote = {
  id: number;
  text: string;
  locatorJson?: string;
};

type TocRow = {
  key: string;
  link: Link;
  depth: number;
};

function normalizePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percent = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function progressFromLocator(locator?: Locator | null): number | null {
  if (!locator?.locations) return null;
  return normalizePercent(
    locator.locations.totalProgression ?? locator.locations.progression,
  );
}

function locatorFromHref(href: string): Locator | null {
  const normalized = href.trim();
  if (!normalized || normalized.startsWith("epubcfi(")) return null;
  return {
    href: normalized,
    type: "application/xhtml+xml",
    title: "",
    locations: { progression: 0 },
  };
}

function parseStoredReadiumLocator(
  value?: string | null,
  fallbackProgress?: number | null,
): Locator | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as StoredReadiumLocation | LegacyReaderLocation;
    if (
      parsed &&
      "engine" in parsed &&
      parsed.engine === "readium" &&
      "locator" in parsed &&
      parsed.locator?.href
    ) {
      return parsed.locator;
    }

    if (parsed && "href" in parsed && typeof parsed.href === "string") {
      return locatorFromHref(parsed.href);
    }
  } catch {
    // Older rows can be raw EPUB CFIs or raw hrefs.
  }

  const legacyHrefLocator = locatorFromHref(value);
  if (legacyHrefLocator) {
    const progress = normalizePercent(fallbackProgress);
    if (progress !== null) {
      legacyHrefLocator.locations = { progression: progress / 100 };
    }
  }
  return legacyHrefLocator;
}

function serializeReadiumLocation(locator: Locator): string {
  const snapshot: StoredReadiumLocation = {
    v: READIUM_LOCATION_VERSION,
    engine: "readium",
    locator,
    progress: progressFromLocator(locator),
  };
  return JSON.stringify(snapshot);
}

function nativeFilePath(uri: string): string {
  return Platform.OS === "web" ? uri : uri.replace(/^file:\/\//, "");
}

function fontFamilyForReadium(settings: ReaderSettings): ReadiumProps["preferences"]["fontFamily"] {
  return settings.font === "sans" ? "sans-serif" : "serif";
}

function themeForReadium(settings: ReaderSettings): ReadiumProps["preferences"]["theme"] {
  if (settings.theme === "dark" || settings.theme === "oled" || settings.theme === "forest") {
    return "dark";
  }
  if (settings.theme === "sepia") return "sepia";
  return "light";
}

function marginScale(settings: ReaderSettings): number {
  const px = parseInt(MARGIN_VALUES[settings.margin], 10);
  if (!Number.isFinite(px)) return 1;
  return Math.max(0.7, Math.min(1.8, px / 24));
}

function buildReadiumPreferences(settings: ReaderSettings): ReadiumProps["preferences"] {
  const theme = THEME_CONFIGS[settings.theme];
  return {
    theme: themeForReadium(settings),
    backgroundColor: theme.bg,
    textColor: theme.fg,
    fontFamily: fontFamilyForReadium(settings),
    fontSize: settings.fontSize,
    lineHeight: parseFloat(LINE_SPACING_VALUES[settings.lineSpacing]),
    pageMargins: marginScale(settings),
    publisherStyles: false,
    scroll: settings.scrollMode === "vertical",
    textAlign: "start",
  };
}

function flattenToc(links: Link[], depth = 0): TocRow[] {
  return links.flatMap((link, index) => {
    const key = `${depth}-${index}-${link.href}`;
    const children = link.children ? flattenToc(link.children, depth + 1) : [];
    return [{ key, link, depth }, ...children];
  });
}

function readiumLocatorFromLink(link: Link): Locator {
  const type = (link as Link & { type?: string }).type ?? "application/xhtml+xml";
  return {
    href: link.href,
    type,
    title: link.title ?? "",
    locations: { progression: 0 },
  };
}

function quoteStoredLocation(quote: Quote): string | null {
  return (quote as QuoteWithLocation).cfiRange ?? null;
}

function decorationFromQuote(quote: Quote, settings: ReaderSettings): Decoration | null {
  const locator = parseStoredReadiumLocator(quoteStoredLocation(quote));
  if (!locator) return null;

  const quoteWithLocation = quote as QuoteWithLocation;
  const styleConfig = HIGHLIGHT_STYLE_CONFIGS[settings.highlightStyle];
  const isMine = quoteWithLocation.highlightedByMe === true;

  return {
    id: `quote-${quote.id}`,
    locator,
    style: {
      type: isMine ? styleConfig.annotationType : "highlight",
      tint: isMine ? styleConfig.color : "#F9E04B",
    },
    extras: {
      quoteId: String(quote.id),
      selectedText: quote.text,
    },
  };
}

function mergeDecorations(left: Decoration[], right: Decoration[]): Decoration[] {
  const map = new Map<string, Decoration>();
  for (const item of left) map.set(item.id, item);
  for (const item of right) map.set(item.id, item);
  return Array.from(map.values());
}

function selectedTextPreview(result: SearchResult): string {
  const before = result.before ? `${result.before} ` : "";
  const highlight = result.highlight ?? result.locator.text?.highlight ?? "";
  const after = result.after ? ` ${result.after}` : "";
  return `${before}${highlight}${after}`.trim() || result.locator.title || result.locator.href;
}

function TocModal({
  visible,
  toc,
  onSelect,
  onClose,
}: {
  visible: boolean;
  toc: Link[];
  onSelect: (link: Link) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => flattenToc(toc), [toc]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.bottomPanel,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        <View style={[styles.modalHeader, { borderBottomColor: colors.border + "80" }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>목차</Text>
          <Pressable onPress={onClose} hitSlop={16}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {rows.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>목차를 불러오는 중이에요.</Text>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item.link)}
                style={({ pressed }) => [
                  styles.tocRow,
                  {
                    paddingLeft: 18 + item.depth * 16,
                    opacity: pressed ? 0.55 : 1,
                    borderBottomColor: colors.border + "30",
                  },
                ]}
              >
                <Text style={[styles.tocText, { color: colors.foreground }]} numberOfLines={2}>
                  {item.link.title ?? item.link.href}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

function SearchModal({
  visible,
  query,
  setQuery,
  results,
  isSearching,
  isLoadingMore,
  hasMore,
  isSupported,
  onSubmit,
  onLoadMore,
  onSelect,
  onClear,
  onClose,
}: {
  visible: boolean;
  query: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  isSearching: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  isSupported: boolean;
  onSubmit: () => void;
  onLoadMore: () => void;
  onSelect: (locator: Locator) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardPanel}
      >
        <View
          style={[
            styles.bottomPanel,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + 10,
            },
          ]}
        >
          <View style={[styles.modalHeader, { borderBottomColor: colors.border + "80" }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>본문 검색</Text>
            <Pressable onPress={onClose} hitSlop={16}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={[styles.searchBar, { borderColor: colors.border, backgroundColor: colors.background }]}> 
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={onSubmit}
              placeholder="책 안에서 찾기"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.foreground }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={onClear} hitSlop={10}>
                <Feather name="x-circle" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          {!isSupported ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>이 EPUB는 검색 서비스를 제공하지 않아요.</Text>
          ) : isSearching ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>검색 중...</Text>
            </View>
          ) : results.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>검색어를 입력하면 결과가 여기에 떠요.</Text>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item, index) => `${item.locator.href}-${index}-${item.locator.locations?.progression ?? 0}`}
              onEndReached={() => {
                if (hasMore && !isLoadingMore) onLoadMore();
              }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onSelect(item.locator)}
                  style={({ pressed }) => [
                    styles.searchRow,
                    { opacity: pressed ? 0.6 : 1, borderBottomColor: colors.border + "30" },
                  ]}
                >
                  <Text style={[styles.searchTitle, { color: colors.primary }]} numberOfLines={1}>
                    {item.locator.title || item.locator.href}
                  </Text>
                  <Text style={[styles.searchSnippet, { color: colors.foreground }]} numberOfLines={3}>
                    {selectedTextPreview(item)}
                  </Text>
                </Pressable>
              )}
              ListFooterComponent={
                isLoadingMore ? <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} /> : null
              }
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NotesModal({
  visible,
  quotes,
  onNavigate,
  onOpenQuote,
  onClose,
}: {
  visible: boolean;
  quotes: Quote[];
  onNavigate: (locator: Locator) => void;
  onOpenQuote: (quote: Quote) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.bottomPanel,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        <View style={[styles.modalHeader, { borderBottomColor: colors.border + "80" }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>내 하이라이트</Text>
          <Pressable onPress={onClose} hitSlop={16}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {quotes.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>아직 남긴 하이라이트가 없어요.</Text>
        ) : (
          <FlatList
            data={quotes}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => {
              const locator = parseStoredReadiumLocator(quoteStoredLocation(item));
              return (
                <View style={[styles.noteRow, { borderBottomColor: colors.border + "30" }]}> 
                  <Pressable
                    disabled={!locator}
                    onPress={() => {
                      if (locator) {
                        onNavigate(locator);
                        onClose();
                      }
                    }}
                    style={styles.noteTextWrap}
                  >
                    <Text style={[styles.noteText, { color: colors.foreground }]} numberOfLines={4}>
                      {item.text}
                    </Text>
                    {!locator ? (
                      <Text style={[styles.noteMeta, { color: colors.mutedForeground }]}>이전 리더 위치라 이동할 수 없어요.</Text>
                    ) : null}
                  </Pressable>
                  <Pressable onPress={() => onOpenQuote(item)} style={styles.commentIconBtn}>
                    <Feather name="message-circle" size={18} color={colors.primary} />
                  </Pressable>
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

function ReadiumReaderInner({
  entry,
  quotes,
  libraryId,
  canonicalBookId,
}: {
  entry: LibraryEntry;
  quotes: Quote[];
  libraryId: number;
  canonicalBookId: number | null;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const fs = useFileSystem();
  const readiumRef = useRef<ReadiumViewRef>(null);
  const createQuote = useCreateQuote();
  const toggleHighlight = useToggleHighlight();
  const updateLocation = useUpdateReadingLocation();
  const { user } = useUser();
  const { settings, settingsRef, update: updateSettings, reset: resetSettings, loaded } = useReaderSettings();

  const initialLocator = useMemo(
    () => parseStoredReadiumLocator(entry.lastReadingLocation, entry.readingProgress ?? null),
    // The first location is a mount-time seed; background refetches should not remount the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const quotesRef = useRef<Quote[]>(quotes);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedLocationRef = useRef<string | undefined>(entry.lastReadingLocation ?? undefined);
  const publicationReadyRef = useRef(false);

  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [toc, setToc] = useState<Link[]>([]);
  const [readProgress, setReadProgress] = useState<number | null>(
    initialLocator ? progressFromLocator(initialLocator) : normalizePercent(entry.readingProgress ?? null) ?? 0,
  );
  const [currentLocation, setCurrentLocation] = useState<Locator | null>(initialLocator);
  const [localDecorations, setLocalDecorations] = useState<Decoration[]>([]);
  const [settingsPanelVisible, setSettingsPanelVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [notesVisible, setNotesVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<SelectedQuote | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const {
    results: searchResults,
    isSearching,
    isLoadingMore,
    isSupported,
    hasMore,
    search,
    loadMore,
    clear,
  } = useSearch(readiumRef);

  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  useEffect(() => {
    if (!fs.cacheDirectory) return;
    let cancelled = false;
    const remote = apiUrl(entry.epubUrl);
    const dest = `${fs.cacheDirectory}readium_epub_${libraryId}.epub`;

    (async () => {
      const info = await fs.getFileInfo(dest);
      if (cancelled) return;
      if (info.exists) {
        setLocalSrc(dest);
        return;
      }

      const result = await fs.downloadFile(remote, dest);
      if (cancelled) return;
      if (result.uri) {
        setLocalSrc(result.uri);
      } else {
        setDownloadError("EPUB 다운로드에 실패했어요.");
      }
    })().catch((error) => {
      if (!cancelled) {
        setDownloadError(error instanceof Error ? error.message : "EPUB 다운로드에 실패했어요.");
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.epubUrl, libraryId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      clear();
    };
  }, [clear]);

  const preferences = useMemo(() => buildReadiumPreferences(settings), [settings]);

  const file = useMemo<ReadiumFile | null>(() => {
    if (!localSrc) return null;
    return {
      url: nativeFilePath(localSrc),
      initialLocation: initialLocator ?? undefined,
    };
  }, [initialLocator, localSrc]);

  const serverDecorations = useMemo(
    () => quotes.map((quote) => decorationFromQuote(quote, settings)).filter((item): item is Decoration => !!item),
    [quotes, settings],
  );

  const decorations = useMemo<DecorationGroup[]>(
    () => [
      {
        name: "highlights",
        decorations: mergeDecorations(serverDecorations, localDecorations),
      },
    ],
    [localDecorations, serverDecorations],
  );

  const myHighlightedQuotes = useMemo(
    () => quotes.filter((quote) => (quote as QuoteWithLocation).highlightedByMe === true),
    [quotes],
  );

  const ensureMatched = useCallback(() => {
    if (canonicalBookId) return true;
    Alert.alert(
      "먼저 책을 매칭하세요",
      "커뮤니티 하이라이트와 코멘트를 사용하려면 이 책을 매칭해야 해요.",
      [
        { text: "취소", style: "cancel" },
        { text: "매칭하기", onPress: () => router.push(`/match/${libraryId}`) },
      ],
    );
    return false;
  }, [canonicalBookId, libraryId]);

  const addLocalDecoration = useCallback((quoteId: number, locator: Locator, text: string) => {
    const styleConfig = HIGHLIGHT_STYLE_CONFIGS[settingsRef.current.highlightStyle];
    const decoration: Decoration = {
      id: `quote-${quoteId}`,
      locator,
      style: {
        type: styleConfig.annotationType,
        tint: styleConfig.color,
      },
      extras: {
        quoteId: String(quoteId),
        selectedText: text,
      },
    };
    setLocalDecorations((prev) => mergeDecorations(prev, [decoration]));
  }, [settingsRef]);

  const saveLocation = useCallback((locator: Locator) => {
    if (!publicationReadyRef.current) return;
    const serialized = serializeReadiumLocation(locator);
    if (lastPersistedLocationRef.current === serialized) return;

    const progress = progressFromLocator(locator) ?? readProgress ?? 0;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateLocation.mutate(
        { libraryId, data: { location: serialized, readingProgress: progress } },
        {
          onSuccess: (updated) => {
            lastPersistedLocationRef.current = serialized;
            queryClient.setQueryData(getGetLibraryEntryQueryKey(libraryId), updated);
          },
        },
      );
    }, 1500);
  }, [libraryId, queryClient, readProgress, updateLocation]);

  const handleLocationChange = useCallback((locator: Locator) => {
    setCurrentLocation(locator);
    const progress = progressFromLocator(locator);
    if (progress !== null) setReadProgress(progress);
    saveLocation(locator);
  }, [saveLocation]);

  const handlePublicationReady = useCallback((event: PublicationReadyEvent) => {
    publicationReadyRef.current = true;
    setToc(event.tableOfContents ?? []);
    if (initialLocator) {
      readiumRef.current?.goTo(initialLocator);
    }
  }, [initialLocator]);

  const navigateToLocator = useCallback((locator: Locator) => {
    readiumRef.current?.goTo(locator);
    setCurrentLocation(locator);
    const progress = progressFromLocator(locator);
    if (progress !== null) setReadProgress(progress);
  }, []);

  const handleSelectionAction = useCallback((event: SelectionActionEvent) => {
    const trimmed = event.selectedText.trim();
    if (event.actionId === "define") {
      Alert.alert("사전", trimmed || "선택한 단어가 없어요.");
      return;
    }

    if (!ensureMatched() || !canonicalBookId) return;
    if (trimmed.length < 8) {
      Alert.alert("너무 짧아요", "최소 8자 이상 선택해 주세요.");
      return;
    }

    const locatorJson = serializeReadiumLocation(event.locator);
    if (event.actionId === "highlight") {
      createQuote.mutate(
        { bookId: canonicalBookId, data: { text: trimmed.slice(0, 1000) } },
        {
          onSuccess: (quote) => {
            addLocalDecoration(quote.id, event.locator, quote.text);
            toggleHighlight.mutate(
              { quoteId: quote.id, data: { userLibraryId: libraryId, cfiRange: locatorJson } },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getGetBookQuotesQueryKey(canonicalBookId) });
                },
              },
            );
          },
          onError: () => Alert.alert("하이라이트 실패", "다시 시도해 주세요."),
        },
      );
      return;
    }

    if (event.actionId === "comment") {
      createQuote.mutate(
        { bookId: canonicalBookId, data: { text: trimmed.slice(0, 1000) } },
        {
          onSuccess: (quote) => {
            setSelectedQuote({ id: quote.id, text: quote.text, locatorJson });
            setSheetVisible(true);
          },
          onError: () => Alert.alert("실패", "다시 시도해 주세요."),
        },
      );
    }
  }, [addLocalDecoration, canonicalBookId, createQuote, ensureMatched, libraryId, queryClient, toggleHighlight]);

  const handleDecorationActivated = useCallback((event: DecorationActivatedEvent) => {
    const quoteId = Number(event.decoration.extras?.quoteId);
    if (!Number.isFinite(quoteId)) return;
    const quote = quotesRef.current.find((item) => item.id === quoteId);
    setSelectedQuote({
      id: quoteId,
      text: quote?.text ?? event.decoration.extras?.selectedText ?? "",
      locatorJson: serializeReadiumLocation(event.decoration.locator),
    });
    setSheetVisible(true);
  }, []);

  const openQuoteFromNotes = useCallback((quote: Quote) => {
    setSelectedQuote({
      id: quote.id,
      text: quote.text,
      locatorJson: quoteStoredLocation(quote) ?? undefined,
    });
    setSheetVisible(true);
  }, []);

  const subtitle = canonicalBookId
    ? `Readium · 커뮤니티 하이라이트 ${quotes.length}개`
    : "Readium · 매칭되지 않음";

  if (downloadError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}> 
        <Text style={{ color: "#FF6B6B", textAlign: "center" }}>{downloadError}</Text>
      </View>
    );
  }

  if (!loaded || !file) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}> 
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, marginTop: 10, fontSize: 13 }}>
          {!loaded ? "설정 불러오는 중..." : "EPUB 준비 중..."}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
            backgroundColor: colors.background,
            borderBottomColor: colors.border + "80",
          },
        ]}
      >
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
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
        <Pressable style={styles.iconBtn} onPress={() => setSearchVisible(true)}>
          <Feather name="search" size={18} color={colors.foreground} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setNotesVisible(true)}>
          <Feather name="bookmark" size={18} color={colors.foreground} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setTocVisible(true)}>
          <Feather name="list" size={19} color={colors.foreground} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setSettingsPanelVisible(true)}>
          <Text style={[styles.aaText, { color: colors.foreground }]}>Aa</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <ReadiumView
          ref={readiumRef}
          file={file}
          preferences={preferences}
          decorations={decorations}
          selectionActions={selectionActions}
          onLocationChange={handleLocationChange}
          onPublicationReady={handlePublicationReady}
          onDecorationActivated={handleDecorationActivated}
          onSelectionAction={handleSelectionAction}
        />
      </View>

      {readProgress !== null ? (
        <View style={[styles.progressWrap, { backgroundColor: colors.background, paddingBottom: insets.bottom + 4 }]}> 
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
            {currentLocation?.locations?.position ? ` · 위치 ${currentLocation.locations.position}` : ""}
          </Text>
        </View>
      ) : null}

      <ReaderSettingsPanel
        visible={settingsPanelVisible}
        settings={settings}
        onChange={updateSettings}
        onReset={() => {
          resetSettings();
          setSettingsPanelVisible(false);
        }}
        onClose={() => setSettingsPanelVisible(false)}
      />

      <TocModal
        visible={tocVisible}
        toc={toc}
        onSelect={(link) => {
          navigateToLocator(readiumLocatorFromLink(link));
          setTocVisible(false);
        }}
        onClose={() => setTocVisible(false)}
      />

      <SearchModal
        visible={searchVisible}
        query={searchText}
        setQuery={setSearchText}
        results={searchResults}
        isSearching={isSearching}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        isSupported={isSupported}
        onSubmit={() => search(searchText, { caseSensitive: false })}
        onLoadMore={loadMore}
        onSelect={(locator) => {
          navigateToLocator(locator);
          setSearchVisible(false);
        }}
        onClear={() => {
          setSearchText("");
          clear();
        }}
        onClose={() => setSearchVisible(false)}
      />

      <NotesModal
        visible={notesVisible}
        quotes={myHighlightedQuotes}
        onNavigate={navigateToLocator}
        onOpenQuote={openQuoteFromNotes}
        onClose={() => setNotesVisible(false)}
      />

      <CommentSheet
        visible={sheetVisible}
        quoteId={selectedQuote?.id ?? null}
        quoteText={selectedQuote?.text ?? ""}
        onClose={() => setSheetVisible(false)}
        onCommentSaved={(visibility) => {
          if (!selectedQuote?.locatorJson || !canonicalBookId) return;
          const locator = parseStoredReadiumLocator(selectedQuote.locatorJson);
          if (locator) addLocalDecoration(selectedQuote.id, locator, selectedQuote.text);
          toggleHighlight.mutate(
            {
              quoteId: selectedQuote.id,
              data: { userLibraryId: libraryId, cfiRange: selectedQuote.locatorJson, visibility },
            },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetBookQuotesQueryKey(canonicalBookId) });
              },
            },
          );
        }}
      />
    </View>
  );
}

export default function ReadiumReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { libraryId: libraryIdParam } = useLocalSearchParams<{ libraryId: string }>();
  const libraryId = parseInt(libraryIdParam ?? "0", 10);

  const { data: entry, isFetching } = useGetLibraryEntry(libraryId, {
    query: {
      enabled: !!libraryId && !!user?.id,
      queryKey: getGetLibraryEntryQueryKey(libraryId),
    },
  });
  const [entryReady, setEntryReady] = useState(false);

  useEffect(() => {
    if (!isFetching && entry) setEntryReady(true);
  }, [entry, isFetching]);

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
        <Text style={[styles.webTitle, { color: colors.foreground }]}>모바일 빌드에서 읽어주세요</Text>
        <Text style={[styles.webBody, { color: colors.mutedForeground }]}> 
          Readium 리더는 네이티브 모듈이라 Expo Go/개발 빌드에서 테스트해야 해요.
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.webBtn, { backgroundColor: colors.primary }]}> 
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
    <ReadiumReaderInner
      entry={entry}
      quotes={quotes ?? []}
      libraryId={libraryId}
      canonicalBookId={canonicalBookId}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "700" },
  subtitle: { fontSize: 11, marginTop: 2 },
  aaText: { fontSize: 15, fontWeight: "800" },
  matchBtn: {
    height: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  progressWrap: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  progressTrack: {
    height: 3,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressLabel: {
    marginTop: 5,
    fontSize: 11,
    textAlign: "center",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  keyboardPanel: {
    flex: 1,
    justifyContent: "flex-end",
  },
  bottomPanel: {
    marginTop: "auto",
    maxHeight: "78%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: "hidden",
  },
  modalHeader: {
    height: 54,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 16, fontWeight: "800" },
  emptyText: {
    padding: 22,
    textAlign: "center",
    fontSize: 13,
  },
  tocRow: {
    minHeight: 50,
    paddingRight: 18,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tocText: { fontSize: 14, lineHeight: 19, fontWeight: "600" },
  searchBar: {
    margin: 14,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    fontSize: 15,
  },
  inlineLoading: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  searchRow: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 5,
  },
  searchTitle: { fontSize: 12, fontWeight: "700" },
  searchSnippet: { fontSize: 14, lineHeight: 20 },
  noteRow: {
    minHeight: 74,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  noteTextWrap: { flex: 1, minWidth: 0 },
  noteText: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  noteMeta: { marginTop: 5, fontSize: 11 },
  commentIconBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  webTitle: { marginTop: 16, fontSize: 20, fontWeight: "800" },
  webBody: { marginTop: 10, fontSize: 14, lineHeight: 21, textAlign: "center" },
  webBtn: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
  },
});
