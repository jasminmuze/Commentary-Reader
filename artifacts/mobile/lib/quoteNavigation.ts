import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { getQuoteReaderContext } from "@workspace/api-client-react";

/** 네이티브 Readium 리더를 쓸 수 있는 환경인지 (Android 개발/EAS 빌드에서만). */
export function canUseNativeReader(): boolean {
  if (Platform.OS !== "android" || Constants.appOwnership === "expo") return false;
  const host = NativeModules.NativeReadiumHost as
    | { findQuoteLocators?: unknown }
    | undefined;
  return typeof host?.findQuoteLocators === "function";
}

/**
 * 저장한 댓글/알림에서 인용(quote)을 탭했을 때의 이동 분기.
 * - 책이 내 서재에 있고 네이티브 리더 사용 가능 → 리더를 해당 문장 딥링크로 열기
 * - 그 외 → onFallback 이 있으면 호출, 없으면 책 상세 화면으로 이동
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
