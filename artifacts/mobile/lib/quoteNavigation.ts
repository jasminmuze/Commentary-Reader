import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { getQuoteReaderContext } from "@workspace/api-client-react";

/** Whether the environment can use the native Readium reader (Android dev/EAS builds only). */
export function canUseNativeReader(): boolean {
  if (Platform.OS !== "android" || Constants.appOwnership === "expo") return false;
  const host = NativeModules.NativeReadiumHost as
    | { findQuoteLocators?: unknown }
    | undefined;
  return typeof host?.findQuoteLocators === "function";
}

/**
 * Navigation branch for when a quote is tapped from a saved comment/notification.
 * - Book is in the library and the native reader is available -> open the reader deep-linked to the passage
 * - Otherwise -> call onFallback if provided, or navigate to the book detail screen
 */
export async function navigateToQuote(
  quoteId: number,
  options?: { onFallback?: () => void },
): Promise<void> {
  const ctx = await getQuoteReaderContext(quoteId);
  if (ctx.libraryId != null && canUseNativeReader()) {
    router.push({
      pathname: "/readium/[libraryId]",
      params: {
        libraryId: String(ctx.libraryId),
        quoteId: String(ctx.quoteId),
        quoteText: ctx.quoteText,
      },
    });
    return;
  }
  if (options?.onFallback) {
    options.onFallback();
    return;
  }
  router.push(`/book/${ctx.canonicalBookId}`);
}
