import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  username: string;
  avatarColor: string;
  size?: number;
}

export function UserAvatar({ username, avatarColor, size = 36 }: Props) {
  const colors = useColors();
  const initial = username.charAt(0).toUpperCase();

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
          { fontSize: size * 0.42, color: "#0E1117" },
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
