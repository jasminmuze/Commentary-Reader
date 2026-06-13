import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ReaderTheme = "paper" | "sepia" | "gray" | "dark" | "oled" | "forest";
export type ReaderFont = "serif" | "sans" | "georgia";
export type LineSpacing = "compact" | "normal" | "wide";
export type MarginSize = "narrow" | "normal" | "wide";
export type HighlightStyle =
  | "yellow" | "green" | "blue" | "pink" | "purple" | "orange" | "underline";
export type ScrollMode = "vertical" | "paged";

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  fontSize: number;
  lineSpacing: LineSpacing;
  margin: MarginSize;
  highlightStyle: HighlightStyle;
  scrollMode: ScrollMode;
}

const STORAGE_KEY = "@reader_settings_v1";

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "paper",
  font: "georgia",
  fontSize: 19,
  lineSpacing: "normal",
  margin: "normal",
  highlightStyle: "yellow",
  scrollMode: "vertical",
};

export const THEME_CONFIGS: Record<
  ReaderTheme,
  { bg: string; fg: string; label: string }
> = {
  paper:  { bg: "#FAF7F2", fg: "#221A10", label: "Paper" },
  sepia:  { bg: "#F4ECD8", fg: "#3B2B1A", label: "Sepia" },
  gray:   { bg: "#EBEBEB", fg: "#222222", label: "Gray" },
  dark:   { bg: "#1E1E1E", fg: "#E0E0E0", label: "Dark" },
  oled:   { bg: "#000000", fg: "#FFFFFF", label: "OLED" },
  forest: { bg: "#1A2E1A", fg: "#C8E6C9", label: "Forest" },
};

export const FONT_CONFIGS: Record<ReaderFont, { css: string; label: string }> = {
  serif:   { css: "Georgia, 'Times New Roman', serif",           label: "Serif" },
  sans:    { css: "-apple-system, 'Helvetica Neue', sans-serif", label: "Sans" },
  georgia: { css: "Georgia, serif",                              label: "Georgia" },
};

export const LINE_SPACING_LABELS: Record<LineSpacing, string> = {
  compact: "좁게",
  normal:  "기본",
  wide:    "넓게",
};

export const LINE_SPACING_VALUES: Record<LineSpacing, string> = {
  compact: "1.4",
  normal:  "1.85",
  wide:    "2.2",
};

export const MARGIN_LABELS: Record<MarginSize, string> = {
  narrow: "좁게",
  normal: "기본",
  wide:   "넓게",
};

export const MARGIN_VALUES: Record<MarginSize, string> = {
  narrow: "8px",
  normal: "24px",
  wide:   "48px",
};

export const HIGHLIGHT_STYLE_CONFIGS: Record<
  HighlightStyle,
  { color: string; annotationType: "highlight" | "underline"; label: string }
> = {
  yellow:    { color: "#F9E04B", annotationType: "highlight", label: "노랑" },
  green:     { color: "#86EFAC", annotationType: "highlight", label: "초록" },
  blue:      { color: "#93C5FD", annotationType: "highlight", label: "파랑" },
  pink:      { color: "#F9A8D4", annotationType: "highlight", label: "핑크" },
  purple:    { color: "#C4B5FD", annotationType: "highlight", label: "보라" },
  orange:    { color: "#FCA96A", annotationType: "highlight", label: "주황" },
  underline: { color: "#D4891A", annotationType: "underline", label: "밑줄" },
};

export const FONT_SIZES = [14, 16, 18, 19, 21, 23, 26] as const;

export function buildReaderTheme(s: ReaderSettings) {
  const theme = THEME_CONFIGS[s.theme];
  const font = FONT_CONFIGS[s.font];
  return {
    body: {
      background: theme.bg,
      "font-family": font.css,
      "font-size": `${s.fontSize}px`,
      "line-height": LINE_SPACING_VALUES[s.lineSpacing],
      color: theme.fg,
      padding: `0 ${MARGIN_VALUES[s.margin]}`,
    },
    p: { "margin-bottom": "0.6em" },
  };
}

export function buildCssScript(s: ReaderSettings): string {
  const theme = THEME_CONFIGS[s.theme];
  const font = FONT_CONFIGS[s.font];
  const margin = MARGIN_VALUES[s.margin];
  const line = LINE_SPACING_VALUES[s.lineSpacing];
  const fontEscaped = font.css.replace(/'/g, "\\'");
  const css =
    `body{background:${theme.bg}!important;color:${theme.fg}!important;` +
    `font-family:${fontEscaped}!important;font-size:${s.fontSize}px!important;` +
    `line-height:${line}!important;padding:0 ${margin}!important;}` +
    `p{margin-bottom:0.6em;}`;
  return (
    `(function(){` +
    `var e=document.getElementById('_rs');` +
    `if(!e){e=document.createElement('style');e.id='_rs';document.head.appendChild(e);}` +
    `e.textContent=${JSON.stringify(css)};` +
    `true;` +
    `})();`
  );
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const saved = JSON.parse(raw) as Partial<ReaderSettings>;
            const merged = { ...DEFAULT_SETTINGS, ...saved };
            setSettings(merged);
            settingsRef.current = merged;
          } catch {
            /* ignore */
          }
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    settingsRef.current = DEFAULT_SETTINGS;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS)).catch(
      () => {}
    );
  }, []);

  return { settings, settingsRef, update, reset, loaded };
}
