import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type ChapterPullState = {
  direction: "next" | "prev";
  progress: number;
  targetTitle: string | null;
};

/**
 * Overlay that appears in scroll mode when you keep pulling past the end/start of a chapter.
 * It fades in gradually in proportion to the native chapterPull event's progress (0~1+),
 * and once it crosses the threshold (1.0) it switches to the "release to go" state. It does not intercept touches.
 */
export function ChapterPullIndicator({
  state,
  topInset,
  bottomInset,
}: {
  state: ChapterPullState;
  topInset: number;
  bottomInset: number;
}) {
  const colors = useColors();
  const isNext = state.direction === "next";
  const clamped = Math.min(Math.max(state.progress, 0), 1);
  const armed = state.progress >= 1;

  const label = isNext
    ? armed
      ? "Release to go to the next chapter"
      : "Pull for next chapter"
    : armed
      ? "Release to go to the previous chapter"
      : "Pull for previous chapter";

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        isNext ? { bottom: bottomInset + 28 } : { top: topInset + 28 },
        {
          opacity: 0.2 + clamped * 0.8,
          transform: [{ translateY: (isNext ? 1 : -1) * (1 - clamped) * 18 }],
        },
      ]}
    >
      <View
        style={[
          styles.pill,
          {
            backgroundColor: colors.background,
            borderColor: armed ? colors.primary : colors.border,
          },
        ]}
      >
        <View style={{ transform: [{ rotate: armed ? "180deg" : "0deg" }] }}>
          <Feather
            name={isNext ? "arrow-up" : "arrow-down"}
            size={16}
            color={armed ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={styles.textWrap}>
          <Text
            style={[styles.label, { color: armed ? colors.primary : colors.foreground }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {state.targetTitle ? (
            <Text style={[styles.title, { color: colors.mutedForeground }]} numberOfLines={1}>
              {state.targetTitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border + "60" }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.round(clamped * 100)}%` as `${number}%`,
              backgroundColor: armed ? colors.primary : colors.mutedForeground,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "82%",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  textWrap: {
    flexShrink: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  title: {
    fontSize: 11,
    marginTop: 1,
    letterSpacing: -0.2,
  },
  track: {
    width: 72,
    height: 3,
    borderRadius: 1.5,
    marginTop: 8,
    overflow: "hidden",
  },
  fill: {
    height: 3,
    borderRadius: 1.5,
  },
});
