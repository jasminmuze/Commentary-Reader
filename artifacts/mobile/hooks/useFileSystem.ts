import { useCallback, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { getAuthToken } from "@workspace/api-client-react";

/**
 * Local re-implementation of `@epubjs-react-native/expo-file-system`'s
 * `useFileSystem`, but importing from `expo-file-system/legacy`.
 *
 * Expo SDK 54 moved the classic file-system API behind the `/legacy`
 * entrypoint; the published plugin imports from the package root and crashes at
 * runtime. The `Reader` component calls this hook and uses the returned helpers
 * to download and cache the EPUB locally before rendering it in the WebView.
 */
export function useFileSystem() {
  const [file, setFile] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [size] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const downloadFile = useCallback(async (fromUrl: string, toFile: string) => {
    try {
      setDownloading(true);
      setError(null);
      setSuccess(false);
      const token = await getAuthToken();
      const downloadOpts = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
      const result = await FileSystem.downloadAsync(fromUrl, toFile, downloadOpts);
      if (result.status >= 400) {
        throw new Error(`Download failed with status ${result.status}`);
      }
      const headers = (result.headers ?? {}) as Record<string, string>;
      const mimeType =
        headers["Content-Type"] ?? headers["content-type"] ?? null;
      setFile(result.uri);
      setSuccess(true);
      setProgress(1);
      return { uri: result.uri, mimeType };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
      return { uri: null, mimeType: null };
    } finally {
      setDownloading(false);
    }
  }, []);

  const getFileInfo = useCallback(async (fileUri: string) => {
    const info = await FileSystem.getInfoAsync(fileUri);
    return {
      uri: info.uri,
      exists: info.exists,
      isDirectory: info.exists ? info.isDirectory : false,
      size: info.exists ? info.size : undefined,
    };
  }, []);

  const readAsStringAsync = useCallback(
    (fileUri: string, options?: { encoding?: "utf8" | "base64" }) =>
      FileSystem.readAsStringAsync(fileUri, options as never),
    [],
  );

  const writeAsStringAsync = useCallback(
    (
      fileUri: string,
      contents: string,
      options?: { encoding?: "utf8" | "base64" },
    ) => FileSystem.writeAsStringAsync(fileUri, contents, options as never),
    [],
  );

  const deleteAsync = useCallback(async (fileUri: string) => {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }, []);

  return {
    file,
    progress,
    downloading,
    size,
    error,
    success,
    documentDirectory: FileSystem.documentDirectory,
    cacheDirectory: FileSystem.cacheDirectory,
    bundleDirectory: FileSystem.bundleDirectory ?? undefined,
    readAsStringAsync,
    writeAsStringAsync,
    deleteAsync,
    downloadFile,
    getFileInfo,
  };
}
