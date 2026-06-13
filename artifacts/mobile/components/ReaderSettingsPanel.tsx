import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  THEME_CONFIGS,
  FONT_CONFIGS,
  LINE_SPACING_LABELS,
  HIGHLIGHT_STYLE_CONFIGS,
  FONT_SIZES,
  type ReaderSettings,
  type ReaderTheme,
  type ReaderFont,
  type LineSpacing,
  type HighlightStyle,
  type ScrollMode,
} from "@/hooks/useReaderSettings";

const PANEL_WIDTH = Math.min(Dimensions.get("window").width * 0.82, 320);
const THEMES = Object.keys(THEME_CONFIGS) as ReaderTheme[];
const FONTS = Object.keys(FONT_CONFIGS) as ReaderFont[];
const LINE_SPACINGS: LineSpacing[] = ["compact", "normal", "wide"];
const HIGHLIGHT_STYLES = Object.keys(HIGHLIGHT_STYLE_CONFIGS) as HighlightStyle[];

interface Props {
  visible: boolean;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
  onClose: () => void;
}

export function ReaderSettingsPanel({
  visible,
  settings,
  onChange,
  onReset,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(PANEL_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: PANEL_WIDTH,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const panelBg = colors.card ?? "#161B22";
  const selected = (active: boolean) => ({
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: active ? colors.primary + "22" : "transparent",
  });

  const fontIdx = FONT_SIZES.indexOf(settings.fontSize as typeof FONT_SIZES[number]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[styles.overlay]} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: panelBg,
              borderLeftColor: colors.border,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <View style={[styles.panelHeader, { borderBottomColor: colors.border + "60" }]}>
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>읽기 설정</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Section label="테마" colors={colors}>
              <View style={styles.themeRow}>
                {THEMES.map((t) => {
                  const cfg = THEME_CONFIGS[t];
                  const active = settings.theme === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => onChange({ theme: t })}
                      style={styles.themeItem}
                    >
                      <View
                        style={[
                          styles.themeCircle,
                          { backgroundColor: cfg.bg, borderColor: active ? colors.primary : colors.border + "80" },
                          active && styles.themeCircleActive,
                        ]}
                      >
                        {active && (
                          <Feather name="check" size={12} color={cfg.fg} />
                        )}
                      </View>
                      <Text style={[styles.themeLabel, { color: colors.mutedForeground }]}>
                        {cfg.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section label="글꼴" colors={colors}>
              <View style={styles.pillRow}>
                {FONTS.map((f) => {
                  const cfg = FONT_CONFIGS[f];
                  const active = settings.font === f;
                  return (
                    <Pressable
                      key={f}
                      onPress={() => onChange({ font: f })}
                      style={[styles.pill, selected(active), { borderColor: active ? colors.primary : colors.border }]}
                    >
                      <Text style={[
                        styles.pillText,
                        { color: active ? colors.primary : colors.foreground, fontFamily: f === "sans" ? undefined : "Georgia" },
                      ]}>
                        {cfg.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section label="글자 크기" colors={colors}>
              <View style={styles.fontSizeRow}>
                <Pressable
                  onPress={() => {
                    const idx = FONT_SIZES.indexOf(settings.fontSize as typeof FONT_SIZES[number]);
                    if (idx > 0) onChange({ fontSize: FONT_SIZES[idx - 1] });
                  }}
                  style={[styles.fontSizeBtn, { borderColor: colors.border }]}
                  hitSlop={8}
                >
                  <Text style={[styles.fontSizeBtnSmall, { color: colors.foreground }]}>A</Text>
                </Pressable>

                <View style={styles.fontSizeDots}>
                  {FONT_SIZES.map((sz, i) => (
                    <Pressable key={sz} onPress={() => onChange({ fontSize: sz })} hitSlop={6}>
                      <View
                        style={[
                          styles.dot,
                          {
                            backgroundColor: fontIdx === i ? colors.primary : colors.border,
                            width: fontIdx === i ? 10 : 6,
                            height: fontIdx === i ? 10 : 6,
                          },
                        ]}
                      />
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={() => {
                    const idx = FONT_SIZES.indexOf(settings.fontSize as typeof FONT_SIZES[number]);
                    if (idx < FONT_SIZES.length - 1) onChange({ fontSize: FONT_SIZES[idx + 1] });
                  }}
                  style={[styles.fontSizeBtn, { borderColor: colors.border }]}
                  hitSlop={8}
                >
                  <Text style={[styles.fontSizeBtnLarge, { color: colors.foreground }]}>A</Text>
                </Pressable>
              </View>
              <Text style={[styles.fontSizeValue, { color: colors.mutedForeground }]}>
                {settings.fontSize}px
              </Text>
            </Section>

            <Section label="줄 간격" colors={colors}>
              <SegmentedControl
                options={LINE_SPACINGS}
                labels={LINE_SPACINGS.map((k) => LINE_SPACING_LABELS[k])}
                selected={settings.lineSpacing}
                onSelect={(v) => onChange({ lineSpacing: v as LineSpacing })}
                colors={colors}
              />
            </Section>

            <Section label="하이라이트 색상" colors={colors}>
              <View style={styles.highlightRow}>
                {HIGHLIGHT_STYLES.map((hs) => {
                  const cfg = HIGHLIGHT_STYLE_CONFIGS[hs];
                  const active = settings.highlightStyle === hs;
                  if (hs === "underline") {
                    return (
                      <Pressable
                        key={hs}
                        onPress={() => onChange({ highlightStyle: hs })}
                        style={[
                          styles.hlCircle,
                          {
                            borderColor: active ? colors.primary : colors.border + "80",
                            backgroundColor: active ? colors.primary + "22" : colors.border + "30",
                          },
                        ]}
                      >
                        <View style={[styles.underlineIcon, { borderBottomColor: cfg.color }]}>
                          <Text style={{ fontSize: 10, color: colors.foreground }}>U</Text>
                        </View>
                        {active && (
                          <View style={[styles.hlCheck, { backgroundColor: colors.primary }]}>
                            <Feather name="check" size={7} color="#fff" />
                          </View>
                        )}
                      </Pressable>
                    );
                  }
                  return (
                    <Pressable
                      key={hs}
                      onPress={() => onChange({ highlightStyle: hs })}
                      style={[
                        styles.hlCircle,
                        {
                          backgroundColor: cfg.color,
                          borderColor: active ? colors.primary : "transparent",
                          borderWidth: active ? 2 : 1,
                        },
                      ]}
                    >
                      {active && (
                        <View style={[styles.hlCheck, { backgroundColor: colors.primary }]}>
                          <Feather name="check" size={7} color="#fff" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section label="스크롤 모드" colors={colors}>
              <SegmentedControl
                options={["vertical", "paged"] as ScrollMode[]}
                labels={["수직 스크롤", "페이지"]}
                selected={settings.scrollMode}
                onSelect={(v) => onChange({ scrollMode: v as ScrollMode })}
                colors={colors}
              />
            </Section>

            <Pressable
              onPress={onReset}
              style={[styles.resetBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.resetText, { color: colors.mutedForeground }]}>
                기본값으로 초기화
              </Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Section({
  label,
  children,
  colors,
}: {
  label: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

function SegmentedControl({
  options,
  labels,
  selected,
  onSelect,
  colors,
}: {
  options: string[];
  labels: string[];
  selected: string;
  onSelect: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.segmented, { borderColor: colors.border, backgroundColor: colors.border + "30" }]}>
      {options.map((opt, i) => {
        const active = selected === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onSelect(opt)}
            style={[
              styles.segment,
              active && { backgroundColor: colors.primary + "22" },
              i < options.length - 1 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: active ? colors.primary : colors.foreground },
                active && { fontWeight: "700" },
              ]}
            >
              {labels[i]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: 6,
    minWidth: 44,
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 4,
  },
  section: {
    paddingVertical: 14,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  themeRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  themeItem: {
    alignItems: "center",
    gap: 5,
  },
  themeCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  themeCircleActive: {
    borderWidth: 2,
  },
  themeLabel: {
    fontSize: 10,
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "500",
  },
  fontSizeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fontSizeBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fontSizeBtnSmall: {
    fontSize: 13,
    fontWeight: "600",
  },
  fontSizeBtnLarge: {
    fontSize: 18,
    fontWeight: "600",
  },
  fontSizeDots: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  dot: {
    borderRadius: 5,
  },
  fontSizeValue: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
  },
  segmented: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 13,
  },
  highlightRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  hlCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hlCheck: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  underlineIcon: {
    borderBottomWidth: 2,
    paddingHorizontal: 2,
  },
  resetBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  resetText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
