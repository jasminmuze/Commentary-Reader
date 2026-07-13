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
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetBookQuotesQueryKey,
  getGetLibraryEntryQueryKey,
  getGetMyRoomsQueryKey,
  useCreateQuote,
  useGetBookQuotes,
  useGetLibraryEntry,
  useGetMyRooms,
  useToggleHighlight,
  useUpdateReadingLocation,
} from "@workspace/api-client-react";
import type { LibraryEntry, Quote, Room } from "@workspace/api-client-react";
import { ScrollView } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { useFileSystem } from "@/hooks/useFileSystem";
import { useReaderSettings, HIGHLIGHT_STYLE_CONFIGS } from "@/hooks/useReaderSettings";
import type { ReaderSettings } from "@/hooks/useReaderSettings";
import { ChapterPullIndicator } from "@/components/ChapterPullIndicator";
import type { ChapterPullState } from "@/components/ChapterPullIndicator";
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
type ChapterPullEvent = {
  libraryId: number;
  phase: "pull" | "cancel" | "commit";
  direction: "next" | "prev";
  progress: number;
  targetTitle?: string | null;
};

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
        An Android development build is required
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        The native Readium reader only runs inside an Android build. In Expo Go and the web preview you can
        only see the app shell; the EPUB reader opens once you install the development APK.
      </Text>
      <Pressable
        style={[styles.button, { borderColor: colors.border, marginTop: 20 }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={16} color={colors.foreground} />
        <Text style={[styles.buttonText, { color: colors.foreground }]}>Go back</Text>
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
  targetQuote,
  myRooms,
  selectedRoomId,
  onSelectRoom,
}: {
  entry: LibraryEntry;
  quotes: Quote[];
  libraryId: number;
  canonicalBookId: number | null;
  localSrc: string;
  nativeReadium: NativeReadiumHostModule;
  onFatalError: (message: string) => void;
  targetQuote: { id: number; text: string } | null;
  myRooms: Room[];
  selectedRoomId: number | null;
  onSelectRoom: (roomId: number | null) => void;
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
  // Scroll-mode chapter pull indicator (driven by the native chapterPull event)
  const [chapterPull, setChapterPull] = useState<ChapterPullState | null>(null);
  const pullArmedRef = useRef(false);

  // Capture the initial location/settings only once — even if the prop changes after the view
  // is already open, the native side doesn't reopen, so we lock it here too.
  // Settings must be captured after this hook instance finishes loading from AsyncStorage
  // (each useReaderSettings instance loads independently), so we lock it in a render after `loaded`.
  const initialLocatorRef = useRef<string | null>(entry.lastReadingLocation ?? null);
  const initialSettingsJsonRef = useRef<string | null>(null);
  if (settingsLoaded && initialSettingsJsonRef.current === null) {
    initialSettingsJsonRef.current = JSON.stringify(settingsRef.current);
  }

  const quotesRef = useRef<Quote[]>(quotes);
  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  // quoteId -> locator JSON string (the position found in this edition)
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
        "Match this book first",
        "You need to match this book to use community highlights and comments.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Match", onPress: () => router.push(`/match/${libraryId}`) },
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
      // Show my own highlights in the color/style chosen in settings,
      // and community highlights in amber scaled by their popularity intensity.
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
        console.warn("[NativeReadium] Failed to apply decorations:", error);
      });
  }, [libraryId, nativeReadium, myHighlightStyle]);

  useEffect(() => {
    if (opened) applyAllDecorations();
  }, [opened, locatedVersion, quotes, applyAllDecorations]);

  // Search this edition for quotes whose position hasn't been found yet.
  // Pass 1: search by the quote's full text so the whole passage gets highlighted.
  // Pass 2: for quotes still not found (due to edition differences), fall back to searching a leading substring.
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
          console.warn("[NativeReadium] Failed to search quote full text:", error);
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
        console.warn("[NativeReadium] Failed to search quote positions:", error);
      })
      .finally(() => setAnchoring(false));
  }, [opened, searchable, canonicalBookId, quotes, libraryId, nativeReadium]);

  // -------------------------------------------------------------------
  // Deep link: navigate to the target passage (entered from a saved comment/notification), then open the comment sheet
  // -------------------------------------------------------------------

  const targetHandledRef = useRef(false);
  const targetSearchStartedRef = useRef(false);
  const targetNotifiedRef = useRef(false);

  // If not found: leave the reader as is, show a notice, and just open the comment sheet.
  const notifyTargetNotFound = useCallback(
    (message: string) => {
      if (!targetQuote || targetNotifiedRef.current || targetHandledRef.current) return;
      targetNotifiedRef.current = true;
      Alert.alert("Couldn't find this passage", message);
      setSelectedQuote({ id: targetQuote.id, text: targetQuote.text });
      setSheetVisible(true);
    },
    [targetQuote],
  );

  // Once a position is available (from community anchoring or the dedicated search below), navigate to that passage.
  useEffect(() => {
    if (!targetQuote || targetHandledRef.current || !opened) return;
    const locatorJson = locatorByQuoteIdRef.current.get(targetQuote.id);
    if (!locatorJson) return;
    targetHandledRef.current = true;
    nativeReadium.goToLocator(libraryId, locatorJson).catch((error) => {
      console.warn("[NativeReadium] Failed to navigate to target passage:", error);
    });
    const quote = quotesRef.current.find((q) => q.id === targetQuote.id);
    setSelectedQuote({
      id: targetQuote.id,
      text: quote?.text ?? targetQuote.text,
      cfiRange: locatorJson,
    });
    setSheetVisible(true);
  }, [targetQuote, opened, locatedVersion, libraryId, nativeReadium]);

  // Dedicated search for the target passage: search directly when it's not in the community list or hasn't been found yet.
  // (full text -> leading substring fallback, same approach as community anchoring)
  useEffect(() => {
    if (!targetQuote || !opened || targetSearchStartedRef.current) return;
    if (targetHandledRef.current || locatorByQuoteIdRef.current.has(targetQuote.id)) return;
    if (!searchable) {
      notifyTargetNotFound(
        "This book doesn't support text search, so we can't jump to the passage. You can still view the comments.",
      );
      return;
    }
    targetSearchStartedRef.current = true;
    requestedQuoteIdsRef.current.add(targetQuote.id);
    const fullText = targetQuote.text.replace(/\s+/g, " ").trim();
    const leading = fullText.split(" ").slice(0, 8).join(" ");
    (async () => {
      let found = false;
      if (fullText.length > 0) {
        try {
          const resultJson = await nativeReadium.findQuoteLocators(
            libraryId,
            JSON.stringify([{ quoteId: targetQuote.id, searchText: fullText }]),
          );
          const results = JSON.parse(resultJson) as { quoteId: number }[];
          found = results.some((r) => r.quoteId === targetQuote.id);
        } catch (error) {
          console.warn("[NativeReadium] Failed to search target passage full text:", error);
        }
      }
      if (!found && leading.length > 0 && leading !== fullText) {
        try {
          const resultJson = await nativeReadium.findQuoteLocators(
            libraryId,
            JSON.stringify([{ quoteId: targetQuote.id, searchText: leading }]),
          );
          const results = JSON.parse(resultJson) as { quoteId: number }[];
          found = results.some((r) => r.quoteId === targetQuote.id);
        } catch (error) {
          console.warn("[NativeReadium] Failed to run target passage fallback search:", error);
        }
      }
      if (!found) {
        // The locator event (from community anchoring or the search above) may arrive
        // slightly late, so wait a moment before making the final call (to avoid false-positive alerts).
        setTimeout(() => {
          if (locatorByQuoteIdRef.current.has(targetQuote.id)) return;
          notifyTargetNotFound(
            "Because of edition differences, we couldn't find this passage's position in this book. You can still view the comments.",
          );
        }, 1500);
      }
    })();
  }, [targetQuote, opened, searchable, libraryId, nativeReadium, notifyTargetNotFound]);

  // -------------------------------------------------------------------
  // Selection actions (highlight / comment)
  // -------------------------------------------------------------------

  const handleTextSelected = useCallback(
    (event: TextSelectedEvent) => {
      const trimmed = event.text.trim();
      if (trimmed.length < 8) {
        Alert.alert("Too short", "Please select at least 8 characters.");
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
                  data: {
                    userLibraryId: libraryId,
                    cfiRange: event.locatorJson,
                    ...(selectedRoomId
                      ? {
                          roomId: selectedRoomId,
                          ...(readProgress !== null ? { authorProgress: readProgress } : {}),
                        }
                      : {}),
                  },
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
              event.action === "highlight" ? "Highlight failed" : "Something went wrong",
              "Please try again.",
            ),
        },
      );
    },
    [createQuote, ensureMatched, libraryId, queryClient, toggleHighlight, selectedRoomId, readProgress],
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
        "NativeReadiumHost.chapterPull",
        (event: ChapterPullEvent) => {
          if (event.libraryId !== libraryId) return;
          if (event.phase === "pull") {
            const armed = event.progress >= 1;
            if (armed && !pullArmedRef.current) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }
            pullArmedRef.current = armed;
            setChapterPull({
              direction: event.direction,
              progress: event.progress,
              targetTitle: event.targetTitle ?? null,
            });
          } else {
            if (event.phase === "commit") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }
            pullArmedRef.current = false;
            setChapterPull(null);
          }
        },
      ),
      DeviceEventEmitter.addListener(
        "NativeReadiumHost.error",
        (event: { libraryId: number; message?: string }) => {
          if (event.libraryId !== libraryId) return;
          onFatalError(event.message ?? "Something went wrong while opening the reader.");
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
        console.warn("[NativeReadium] Failed to apply settings:", error);
      });
    },
    [libraryId, nativeReadium, settingsRef, updateSettings],
  );

  const handleSettingsReset = useCallback(() => {
    resetSettings();
    setSettingsPanelVisible(false);
    nativeReadium.submitPreferences(libraryId, "{}").catch((error) => {
      console.warn("[NativeReadium] Failed to reset settings:", error);
    });
  }, [libraryId, nativeReadium, resetSettings]);

  const tocSections = useMemo(() => tocEntriesToSections(toc), [toc]);

  const myHighlightedQuotes = useMemo(
    () => quotes.filter((q) => q.highlightedByMe === true),
    [quotes],
  );

  const subtitle = canonicalBookId
    ? anchoring
      ? "Showing community highlights…"
      : `${anchoredCount} community highlights`
    : "Not matched · long-press text to select";

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
            Opening book…
          </Text>
        </View>
      ) : null}

      {settings.scrollMode === "vertical" && chapterPull ? (
        <ChapterPullIndicator
          state={chapterPull}
          topInset={insets.top}
          bottomInset={insets.bottom}
        />
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
              {entry.book?.title ?? entry.originalTitle ?? "My book"}
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
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>Match</Text>
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

      {chromeVisible && canonicalBookId && myRooms.length > 0 ? (
        <View
          style={[
            styles.scopeRow,
            { top: insets.top + 62, backgroundColor: colors.background + "F2" },
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scopeContent}
          >
            <Pressable
              onPress={() => onSelectRoom(null)}
              style={[
                styles.scopeChip,
                {
                  backgroundColor: selectedRoomId === null ? colors.primary : colors.card,
                  borderColor: selectedRoomId === null ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather
                name="globe"
                size={12}
                color={selectedRoomId === null ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.scopeChipText,
                  { color: selectedRoomId === null ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Everyone
              </Text>
            </Pressable>
            {myRooms.map((room) => {
              const active = selectedRoomId === room.id;
              return (
                <Pressable
                  key={room.id}
                  onPress={() => onSelectRoom(active ? null : room.id)}
                  style={[
                    styles.scopeChip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Feather
                    name={room.isPublic ? "users" : "lock"}
                    size={12}
                    color={active ? colors.primaryForeground : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.scopeChipText,
                      { color: active ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {room.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
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
            console.warn("[NativeReadium] Failed to navigate from table of contents:", error);
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
            console.warn("[NativeReadium] Failed to navigate from note:", error);
          });
        }}
        onClose={() => setNotesVisible(false)}
      />

      <CommentSheet
        visible={sheetVisible}
        quoteId={selectedQuote?.id ?? null}
        quoteText={selectedQuote?.text ?? ""}
        roomId={selectedRoomId}
        myProgress={readProgress}
        onClose={() => setSheetVisible(false)}
        onCommentSaved={(visibility) => {
          const locatorJson = selectedQuote?.cfiRange;
          const qId = selectedQuote?.id;
          const bookId = canonicalBookIdRef.current;
          if (!locatorJson || !qId || !bookId) return;
          toggleHighlight.mutate(
            {
              quoteId: qId,
              data: {
                userLibraryId: libraryId,
                cfiRange: locatorJson,
                visibility,
                ...(selectedRoomId
                  ? {
                      roomId: selectedRoomId,
                      ...(readProgress !== null ? { authorProgress: readProgress } : {}),
                    }
                  : {}),
              },
            },
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
  const params = useLocalSearchParams<{
    libraryId?: string;
    quoteId?: string;
    quoteText?: string;
  }>();
  const libraryId = Number(params.libraryId);
  const targetQuoteId = Number(params.quoteId);
  const targetQuoteText = typeof params.quoteText === "string" ? params.quoteText : "";
  const targetQuote = useMemo(
    () =>
      Number.isFinite(targetQuoteId) && targetQuoteId > 0
        ? { id: targetQuoteId, text: targetQuoteText }
        : null,
    [targetQuoteId, targetQuoteText],
  );
  const nativeReadium = useMemo(() => getNativeReadiumHost(), []);

  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing EPUB…");
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

  // Reader scope: null = everyone (community), otherwise a reading room id.
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);

  const { data: myRooms } = useGetMyRooms(
    canonicalBookId ? { bookId: canonicalBookId } : undefined,
    {
      query: {
        enabled: !!canonicalBookId,
        queryKey: getGetMyRoomsQueryKey(canonicalBookId ? { bookId: canonicalBookId } : undefined),
      },
    },
  );

  const quotesParams = selectedRoomId ? { roomId: selectedRoomId } : undefined;
  const { data: quotes } = useGetBookQuotes(canonicalBookId ?? 0, quotesParams, {
    query: {
      enabled: !!canonicalBookId,
      queryKey: getGetBookQuotesQueryKey(canonicalBookId ?? 0, quotesParams),
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
      setStatus("Checking local EPUB cache…");
      const info = await getFileInfo(dest);
      if (cancelled) return;

      if (info.exists && (info.size ?? 0) > 0 && (await isZip(dest))) {
        if (!cancelled) setLocalSrc(info.uri);
        return;
      }

      setStatus("Downloading EPUB…");
      const result = await downloadFile(remote, tmp);

      if (!result.uri) {
        await deleteAsync(tmp);
        if (!cancelled) setFatalError("Failed to download the EPUB.");
        return;
      }

      const tmpInfo = await getFileInfo(tmp);
      if ((tmpInfo.size ?? 0) <= 0 || !(await isZip(tmp))) {
        await deleteAsync(tmp);
        if (!cancelled) {
          setFatalError(
            "The downloaded file isn't a valid EPUB (the server may have returned an error page). Please try again.",
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
        setFatalError(error instanceof Error ? error.message : "Failed to download the EPUB.");
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
        <Text style={{ color: colors.foreground }}>This library entry is invalid.</Text>
      </View>
    );
  }

  if (fatalError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="alert-circle" size={34} color={colors.destructive} />
        <Text style={[styles.title, { color: colors.foreground, marginTop: 16 }]}>
          Can't open the reader
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
          <Text style={[styles.buttonText, { color: colors.foreground }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!entryReady || !entry || !localSrc || !settingsLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 28 }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground, marginTop: 18 }]}>
          {entry?.book?.title ?? entry?.originalTitle ?? "Opening book"}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {isFetching && !entryReady ? "Loading library entry…" : status}
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
      targetQuote={targetQuote}
      myRooms={myRooms ?? []}
      selectedRoomId={selectedRoomId}
      onSelectRoom={setSelectedRoomId}
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
  scopeRow: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9,
    paddingVertical: 6,
  },
  scopeContent: { paddingHorizontal: 16, gap: 8 },
  scopeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 16,
    maxWidth: 200,
  },
  scopeChipText: { fontSize: 12, fontWeight: "700" },
});
