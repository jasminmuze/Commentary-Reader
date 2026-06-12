import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { Book } from "@workspace/api-client-react";

interface Props {
  book: Book;
  onPress: () => void;
}

export function BookCard({ book, onPress }: Props) {
  const colors = useColors();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.spine, { backgroundColor: book.coverColor, borderRadius: colors.radius }]}>
        <Text style={styles.spineTitle} numberOfLines={6}>
          {book.title}
        </Text>
        <Text style={styles.spineAuthor} numberOfLines={2}>
          {book.author}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={[styles.author, { color: colors.mutedForeground }]}>
          {book.author}
        </Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>
          {book.description}
        </Text>
        <View style={styles.footer}>
          <Feather name="edit-3" size={13} color={colors.primary} />
          <Text style={[styles.passages, { color: colors.mutedForeground }]}>
            {book.highlightCount}
          </Text>
          <Feather name="message-circle" size={13} color={colors.mutedForeground} style={{ marginLeft: 12 }} />
          <Text style={[styles.passages, { color: colors.mutedForeground }]}>
            {book.commentCount}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderWidth: 1,
    overflow: "hidden",
    marginHorizontal: 16,
    marginVertical: 6,
  },
  spine: {
    width: 80,
    paddingHorizontal: 10,
    paddingVertical: 14,
    justifyContent: "space-between",
    alignItems: "center",
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  spineTitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    lineHeight: 14,
  },
  spineAuthor: {
    fontSize: 9,
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    marginTop: 4,
  },
  info: {
    flex: 1,
    padding: 14,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  author: {
    fontSize: 13,
    fontWeight: "500",
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },
  passages: {
    fontSize: 12,
  },
});
