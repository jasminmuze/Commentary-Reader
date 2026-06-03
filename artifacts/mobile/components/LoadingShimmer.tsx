import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: object;
}

export function LoadingShimmer({ width = "100%", height = 16, borderRadius = 6, style }: Props) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: colors.muted, opacity },
        style,
      ]}
    />
  );
}

export function BookCardShimmer() {
  const colors = useColors();
  return (
    <View style={[styles.shimmerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.shimmerSpine, { backgroundColor: colors.muted }]} />
      <View style={styles.shimmerInfo}>
        <LoadingShimmer width="70%" height={18} />
        <LoadingShimmer width="45%" height={13} />
        <LoadingShimmer width="100%" height={13} />
        <LoadingShimmer width="90%" height={13} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shimmerCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    marginVertical: 6,
    height: 120,
    gap: 0,
  },
  shimmerSpine: {
    width: 80,
  },
  shimmerInfo: {
    flex: 1,
    padding: 14,
    gap: 8,
    justifyContent: "center",
  },
});
