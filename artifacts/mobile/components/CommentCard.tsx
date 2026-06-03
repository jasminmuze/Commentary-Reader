import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { UserAvatar } from "./UserAvatar";
import type { Comment } from "@workspace/api-client-react";

interface Props {
  comment: Comment;
  onLike: (commentId: number) => void;
  onSave: (commentId: number) => void;
  compact?: boolean;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  return `${Math.floor(diffDays / 30)}mo`;
}

export function CommentCard({ comment, onLike, onSave, compact = false }: Props) {
  const colors = useColors();

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLike(comment.id);
  };

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSave(comment.id);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <UserAvatar username={comment.username} avatarColor={comment.avatarColor} size={32} />
        <View style={styles.headerText}>
          <Text style={[styles.username, { color: colors.foreground }]}>
            {comment.username}
          </Text>
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {timeAgo(comment.createdAt)}
          </Text>
        </View>
      </View>

      <Text style={[styles.text, { color: colors.foreground }]}>
        {comment.text}
      </Text>

      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={handleLike}>
          <Feather
            name="heart"
            size={16}
            color={comment.likedByMe ? colors.primary : colors.mutedForeground}
          />
          <Text
            style={[
              styles.actionCount,
              { color: comment.likedByMe ? colors.primary : colors.mutedForeground },
            ]}
          >
            {comment.likeCount}
          </Text>
        </Pressable>

        <Pressable style={styles.action} onPress={handleSave}>
          <Feather
            name="bookmark"
            size={16}
            color={comment.savedByMe ? colors.accent : colors.mutedForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 5,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  username: {
    fontSize: 13,
    fontWeight: "700",
  },
  time: {
    fontSize: 11,
  },
  text: {
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 2,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  actionCount: {
    fontSize: 13,
    fontWeight: "600",
  },
});
