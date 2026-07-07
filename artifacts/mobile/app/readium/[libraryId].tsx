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
  const fs = useFileSystem();
  const queryClient = useQueryClient();
  const updateLocation = useUpdateReadingLocation();
  const { settings, loaded: settingsLoaded } = useReaderSettings();
  const params = useLocalSearchParams<{ libraryId?: string }>();
  const libraryId = Number(params.libraryId);
  const nativeReadium = useMemo(() => getNativeReadiumHost(), []);

  const openedRef = useRef(false);
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing EPUB...");

  const { data: entry, isFetching } = useGetLibraryEntry(libraryId, {
    query: {
      enabled: Number.isFinite(libraryId),
      queryKey: getGetLibraryEntryQueryKey(libraryId),
    },
  });

  useEffect(() => {
    if (!Number.isFinite(libraryId)) return;

    const locationSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.locationChanged",
      (event: NativeReadiumLocationEvent) => {
        if (event.libraryId !== libraryId || !event.location) return;
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
      },
    );

    const closedSub = DeviceEventEmitter.addListener(
      "NativeReadiumHost.closed",
      (event: NativeReadiumClosedEvent) => {
        if (event.libraryId === libraryId) router.back();
      },
    );

    return () => {
      locationSub.remove();
      closedSub.remove();
    };
  }, [libraryId, queryClient, updateLocation]);

  useEffect(() => {
    if (!entry || !fs.cacheDirectory || !nativeReadium) return;

    let cancelled = false;
    const remote = apiUrl(entry.epubUrl);
    const dest = `${fs.cacheDirectory}native_readium_epub_${libraryId}.epub`;

    (async () => {
      setStatus("Checking local EPUB cache...");
      const info = await fs.getFileInfo(dest);
      if (cancelled) return;

      if (info.exists) {
        setLocalSrc(info.uri);
        return;
      }

      setStatus("Downloading EPUB...");
      const result = await fs.downloadFile(remote, dest);
      if (cancelled) return;

      if (result.uri) {
        setLocalSrc(result.uri);
      } else {
        setDownloadError("EPUB download failed.");
      }
    })().catch((error) => {
      if (!cancelled) {
        setDownloadError(error instanceof Error ? error.message : "EPUB download failed.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [entry, fs, libraryId, nativeReadium]);

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
            openNativeReader();
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
