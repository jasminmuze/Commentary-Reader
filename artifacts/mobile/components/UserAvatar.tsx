import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useColors } from "@/hooks/useColors";
import { apiUrl } from "@/lib/api";

interface Props {
  username: string;
  avatarColor: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  size?: number;
}

export function UserAvatar({
  username,
  avatarColor,
  nickname,
  avatarUrl,
  size = 36,
}: Props) {
  const colors = useColors();
  const displayName = nickname?.trim() || username;
  const initial = displayName.charAt(0).toUpperCase();

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: apiUrl(`/api${avatarUrl}`) }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.muted,
        }}
        contentFit="cover"
        transition={100}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: avatarColor,
        },
      ]}
    >
      <Text
        style={[
          styles.initial,
          { fontSize: size * 0.42, color: "#2C2621" },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    fontWeight: "700",
  },
});
