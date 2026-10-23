import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "./UserAvatar";
import { ReportContentButton } from "./ReportContentButton";
import type { Comment } from "@workspace/api-client-react";

interface Props {
  comment: Comment;
  onLike: (commentId: number) => void;
  onSave: (commentId: number) => void;
  onReply?: (comment: Comment) => void;
  onPress?: (comment: Comment) => void;
  onEdit?: (comment: Comment) => void;
  onDelete?: (comment: Comment) => void;
  compact?: boolean;
  isReply?: boolean;
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

export function CommentCard({
  comment,
  onLike,
  onSave,
  onReply,
  onPress,
  onEdit,
  onDelete,
  compact = false,
  isReply = false,
}: Props) {
  const colors = useColors();
  const { user } = useUser();
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);

  const isAuthor = user?.id === comment.userId;
  const isSpoiler = comment.containsSpoilers === true;
  // Authors always see their own spoiler text (badge only); others must tap.
  const spoilerHidden = isSpoiler && !isAuthor && !spoilerRevealed;

  const handleReveal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSpoilerRevealed(true);
  };

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLike(comment.id);
  };

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSave(comment.id);
  };

  const handleReply = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply?.(comment);
  };

  const handleOwnerMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Comment options", undefined, [
      { text: "Edit", onPress: () => onEdit?.(comment) },
      { text: "Delete", style: "destructive", onPress: () => onDelete?.(comment) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Pressable
      onPress={onPress ? () => onPress(comment) : undefined}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
          marginLeft: isReply ? 32 : 16,
          opacity: pressed && onPress ? 0.7 : 1,
        },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => router.push(`/user/${comment.userId}`)}
        hitSlop={6}
      >
        <UserAvatar
          username={comment.username}
          nickname={comment.nickname}
          avatarUrl={comment.avatarUrl}
          avatarColor={comment.avatarColor}
          size={32}
        />
        <View style={styles.headerText}>
          <Text style={[styles.username, { color: colors.foreground }]}>
            {comment.nickname?.trim() || comment.username}
          </Text>
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {timeAgo(comment.createdAt)}
          </Text>
        </View>
        {isSpoiler ? (
          <View
            style={[
              styles.spoilerBadge,
              { backgroundColor: colors.muted, borderRadius: colors.radius },
            ]}
          >
            <Feather name="alert-triangle" size={10} color={colors.mutedForeground} />
            <Text style={[styles.spoilerBadgeText, { color: colors.mutedForeground }]}>
              Spoiler
            </Text>
          </View>
        ) : null}
        {comment.visibility !== "public" ? (
          <Feather
            name={
              comment.visibility === "private"
                ? "lock"
                : comment.visibility === "room"
                  ? "home"
                  : "users"
            }
            size={12}
            color={colors.mutedForeground}
          />
        ) : null}
        {isAuthor && (onEdit || onDelete) ? (
          <Pressable
            onPress={handleOwnerMenu}
            hitSlop={10}
            style={styles.ownerMenu}
            accessibilityRole="button"
            accessibilityLabel="Comment options"
            testID={`comment-options-${comment.id}`}
          >
            <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
        {!isAuthor ? (
          <ReportContentButton
            targetType="comment"
            targetId={comment.id}
            targetUserId={comment.userId}
          />
        ) : null}
      </Pressable>

      {spoilerHidden ? (
        <Pressable
          onPress={handleReveal}
          style={[
            styles.spoilerCover,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Spoiler — tap to reveal"
        >
          <Feather name="eye-off" size={14} color={colors.mutedForeground} />
          <Text style={[styles.spoilerCoverText, { color: colors.mutedForeground }]}>
            Spoiler — tap to reveal
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.text, { color: colors.foreground }]}>
          {comment.text}
        </Text>
      )}

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

        {onReply && !isReply ? (
          <Pressable style={styles.action} onPress={handleReply}>
            <Feather name="message-square" size={16} color={colors.mutedForeground} />
            {(comment.replyCount ?? 0) > 0 ? (
              <Text style={[styles.actionCount, { color: colors.mutedForeground }]}>
                {comment.replyCount}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    borderWidth: 1,
    gap: 10,
    marginRight: 16,
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
  ownerMenu: {
    padding: 4,
    marginLeft: 2,
  },
  spoilerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginRight: 6,
  },
  spoilerBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  spoilerCover: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  spoilerCoverText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
