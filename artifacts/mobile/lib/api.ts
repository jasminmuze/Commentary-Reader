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

/** Collapse whitespace and truncate a response body for use in error messages. */
function summarizeBody(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
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
  if (!API_BASE) {
    throw new Error(
      "API base URL is not configured (EXPO_PUBLIC_DOMAIN is missing). " +
        "Restart the Expo dev server so it injects the Replit domain.",
    );
  }

  const auth = await authHeaders();
  const url = apiUrl("/api/objects/upload");
  const res = await fetch(url, {
    method: "POST",
    headers: { ...auth, Accept: "application/json" },
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `Failed to request upload URL (${res.status}): ${summarizeBody(raw)}`,
    );
  }

  let uploadURL: string | undefined;
  try {
    ({ uploadURL } = JSON.parse(raw) as { uploadURL?: string });
  } catch {
    const contentType = res.headers.get("content-type") ?? "unknown";
    throw new Error(
      `Expected JSON from ${url} but received ${contentType}. ` +
        `The request likely hit the wrong host (got HTML, not the API). ` +
        `Body: ${summarizeBody(raw)}`,
    );
  }

  if (!uploadURL) {
    throw new Error(`Upload URL missing in response from ${url}`);
  }

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

/**
 * Resolve a Book.coverUrl into a loadable image URI.
 * Accepts absolute provider URLs (http upgraded to https) or stored object
 * paths like /public-objects/... (served under /api). Returns null otherwise.
 */
export function bookCoverUrl(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  const value = coverUrl.trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (/^http:\/\//i.test(value)) return value.replace(/^http:/i, "https:");
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/api/")) return apiUrl(value);
  if (value.startsWith("/")) return apiUrl(`/api${value}`);
  return null;
}
