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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetLibraryEntryQueryKey,
  useGetLibraryEntry,
  useUpdateReadingLocation,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useFileSystem } from "@/hooks/useFileSystem";
import { useReaderSettings } from "@/hooks/useReaderSettings";
import { apiUrl } from "@/lib/api";

type NativeReadiumHostModule = {
  openReader(options: {
    libraryId: number;
    filePath: string;
    locatorJson?: string | null;
    settingsJson?: string | null;
    title?: string | null;
  }): Promise<void>;
};

type NativeReadiumLocationEvent = {
  libraryId: number;
  location: string;
  progress: number | null;
};

type NativeReadiumClosedEvent = {
  libraryId: number;
};

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

function getNativeReadiumHost(): NativeReadiumHostModule | null {
  if (Platform.OS !== "android" || isExpoGo()) return null;
  return (NativeModules.NativeReadiumHost as NativeReadiumHostModule | undefined) ?? null;
}

function nativeFilePath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

function percentFromProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function NativeReadiumUnavailableScreen() {
  const colors = useColors();

  return (
    <View style={[styles.center, { backgroundColor: colors.background, padding: 28 }]}>
      <Feather name="book-open" size={34} color={colors.primary} />
      <Text style={[styles.title, { color: colors.foreground, marginTop: 16 }]}>
        Android development build needed
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Native Readium runs inside the Android build. Expo Go and web preview can show the app shell,
        but the EPUB reader opens only after installing the development APK.
      </Text>
      <Pressable
        style={[styles.button, { borderColor: colors.border, marginTop: 20 }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={16} color={colors.foreground} />
        <Text style={[styles.buttonText, { color: colors.foreground }]}>Back</Text>
      </Pressable>
    </View>
  );
}

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
  const queryClient = useQueryClient();
  const updateLocation = useUpdateReadingLocation();
  const { settings, loaded: settingsLoaded, update: updateSettings } = useReaderSettings();
  const params = useLocalSearchParams<{ libraryId?: string }>();
  const libraryId = Number(params.libraryId);
  const nativeReadium = useMemo(() => getNativeReadiumHost(), []);

  const openedRef = useRef(false);
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing EPUB...");
  const [retryNonce, setRetryNonce] = useState(0);

  const { data: entry, isFetching } = useGetLibraryEntry(libraryId, {
    query: {
      enabled: Number.isFinite(libraryId),
      queryKey: getGetLibraryEntryQueryKey(libraryId),
    },
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLocationRef = useRef<NativeReadiumLocationEvent | null>(null);

  useEffect(() => {
    if (!Number.isFinite(libraryId)) return;

    const flushLocation = () => {
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
    };

    const locationSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.locationChanged",
      (event: NativeReadiumLocationEvent) => {
        if (event.libraryId !== libraryId || !event.location) return;
        // Debounce: the navigator emits a location on every scroll tick, which
        // would flood the server with one PUT per second otherwise.
        pendingLocationRef.current = event;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(flushLocation, 1200);
      },
    );

    const settingsSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.settingsChanged",
      (event: { libraryId: number; settings?: string }) => {
        if (event.libraryId !== libraryId || !event.settings) return;
        try {
          updateSettings(JSON.parse(event.settings));
        } catch {
          // ignore malformed settings payloads
        }
      },
    );

    const closedSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.closed",
      (event: NativeReadiumClosedEvent) => {
        if (event.libraryId === libraryId) router.back();
      },
    );

    const debugSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.debug",
      (event: { libraryId: number; message: string }) => {
        if (event.libraryId === libraryId) {
          console.log(`[NativeReadium] ${event.message}`);
        }
      },
    );

    const resourceFailSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.resourceLoadFailed",
      (event: { libraryId: number; href?: string; message?: string }) => {
        if (event.libraryId === libraryId) {
          console.warn(
            `[NativeReadium] resource load failed: ${event.href ?? "?"} — ${event.message ?? ""}`,
          );
        }
      },
    );

    return () => {
      // Flush any pending (debounced) location save so the last reading
      // position is not lost when the reader closes.
      flushLocation();
      locationSub.remove();
      settingsSub.remove();
      closedSub.remove();
      debugSub.remove();
      resourceFailSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, queryClient, updateLocation.mutate, updateSettings]);

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
      setStatus("Checking local EPUB cache...");
      const info = await getFileInfo(dest);
      if (cancelled) return;

      if (info.exists && (info.size ?? 0) > 0 && (await isZip(dest))) {
        if (!cancelled) setLocalSrc(info.uri);
        return;
      }

      setStatus("Downloading EPUB...");
      const result = await downloadFile(remote, tmp);

      if (!result.uri) {
        await deleteAsync(tmp);
        if (!cancelled) setDownloadError("EPUB download failed.");
        return;
      }

      const tmpInfo = await getFileInfo(tmp);
      if ((tmpInfo.size ?? 0) <= 0 || !(await isZip(tmp))) {
        await deleteAsync(tmp);
        if (!cancelled) {
          setDownloadError(
            "The downloaded file is not a valid EPUB (the server may have returned an error page). Try again.",
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
        setDownloadError(error instanceof Error ? error.message : "EPUB download failed.");
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

  const openNativeReader = useCallback(async () => {
    if (!entry || !localSrc || !nativeReadium || !settingsLoaded) return;

    try {
      setStatus("Opening native Readium reader...");
      await nativeReadium.openReader({
        libraryId,
        filePath: nativeFilePath(localSrc),
        locatorJson: entry.lastReadingLocation ?? null,
        settingsJson: JSON.stringify(settings),
        title: entry.book?.title ?? entry.originalTitle ?? "Book",
      });
      openedRef.current = true;
      setStatus("Reader is open.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open native reader.";
      setDownloadError(message);
    }
  }, [entry, libraryId, localSrc, nativeReadium, settings, settingsLoaded]);

  useEffect(() => {
    if (openedRef.current || !localSrc || !entry || !settingsLoaded) return;
    openNativeReader();
  }, [entry, localSrc, openNativeReader, settingsLoaded]);

  if (!nativeReadium) return <NativeReadiumUnavailableScreen />;

  if (!Number.isFinite(libraryId)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Text style={{ color: colors.foreground }}>Invalid library entry.</Text>
      </View>
    );
  }

  if (downloadError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="alert-circle" size={34} color="#FF6B6B" />
        <Text style={[styles.title, { color: colors.foreground, marginTop: 16 }]}>
          Reader could not open
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{downloadError}</Text>
        <Pressable
          style={[styles.button, { borderColor: colors.border, marginTop: 20 }]}
          onPress={() => {
            setDownloadError(null);
            openedRef.current = false;
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

  return (
    <View style={[styles.center, { backgroundColor: colors.background, padding: 28 }]}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.title, { color: colors.foreground, marginTop: 18 }]}>
        {entry?.book?.title ?? entry?.originalTitle ?? "Opening book"}
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {isFetching ? "Loading library entry..." : status}
      </Text>
      {openedRef.current ? (
        <Pressable
          style={[styles.button, { borderColor: colors.border, marginTop: 20 }]}
          onPress={openNativeReader}
        >
          <Feather name="book-open" size={16} color={colors.foreground} />
          <Text style={[styles.buttonText, { color: colors.foreground }]}>Reopen reader</Text>
        </Pressable>
      ) : null}
    </View>
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
});
