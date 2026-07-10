import { useCallback, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { getAuthToken } from "@workspace/api-client-react";

/**
 * File-system helpers built on `expo-file-system/legacy` (Expo SDK 54 moved
 * the classic API behind the `/legacy` entrypoint).
 *
 * The Readium reader screen uses these helpers to download and cache the
 * EPUB locally (with the auth token attached) before handing the file path
 * to the native reader view.
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
    (
      fileUri: string,
      options?: { encoding?: "utf8" | "base64"; position?: number; length?: number },
    ) => FileSystem.readAsStringAsync(fileUri, options as never),
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

  const moveAsync = useCallback(async (from: string, to: string) => {
    await FileSystem.moveAsync({ from, to });
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
    moveAsync,
    downloadFile,
    getFileInfo,
  };
}
