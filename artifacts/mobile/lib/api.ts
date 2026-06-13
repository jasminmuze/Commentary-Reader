import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "bookmarks_token";
const domain = process.env.EXPO_PUBLIC_DOMAIN;

/** Absolute base URL for the API server (Expo runs outside the web proxy). */
export const API_BASE = domain ? `https://${domain}` : "";

/** Prefix a relative API/object path with the absolute base URL. */
export function apiUrl(path: string): string {
  if (!path) return API_BASE;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Returns Authorization header for direct fetch calls. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Upload an EPUB file using the two-step presigned URL flow:
 * 1. Ask the API server for a presigned PUT URL (requires auth).
 * 2. PUT the file bytes directly to that URL (Google Cloud Storage).
 *
 * Returns the presigned upload URL, which the caller passes to POST /api/library
 * (the server normalizes it into a stable object path).
 *
 * On web, asset.uri is a blob URL — use fetch+PUT directly.
 * On native, use FileSystem.uploadAsync (expo-file-system).
 */
export async function uploadEpub(fileUri: string): Promise<string> {
  const auth = await authHeaders();
  const res = await fetch(apiUrl("/api/objects/upload"), {
    method: "POST",
    headers: auth,
  });
  if (!res.ok) {
    throw new Error(`Failed to request upload URL (${res.status})`);
  }
  const { uploadURL } = (await res.json()) as { uploadURL: string };

  if (Platform.OS === "web") {
    const blob = await (await fetch(fileUri)).blob();
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": "application/epub+zip" },
    });
    if (!putRes.ok) {
      throw new Error(`Upload failed (${putRes.status})`);
    }
  } else {
    const result = await FileSystem.uploadAsync(uploadURL, fileUri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": "application/epub+zip" },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Upload failed (${result.status})`);
    }
  }

  return uploadURL;
}
