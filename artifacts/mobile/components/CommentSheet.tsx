import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetQuoteComments,
  useCreateComment,
  useLikeComment,
  useSaveComment,
  getGetQuoteCommentsQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentCard } from "./CommentCard";
import { EmptyState } from "./EmptyState";
import { LoadingShimmer } from "./LoadingShimmer";
import type { Comment } from "@workspace/api-client-react";

type FilterType = "best" | "friends";

interface Props {
  visible: boolean;
  quoteId: number | null;
  quoteText: string;
  onClose: () => void;
  onCommentSaved?: () => void;
}

export function CommentSheet({ visible, quoteId, quoteText, onClose, onCommentSaved }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("best");
  const [commentText, setCommentText] = useState("");
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const { data: comments, isLoading } = useGetQuoteComments(
    quoteId ?? 0,
    { filter },
    {
      query: {
        enabled: !!quoteId && visible,
        queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0, { filter }),
      },
    }
  );

  const createComment = useCreateComment();
  const likeComment = useLikeComment();
  const saveComment = useSaveComment();

  const handleLike = useCallback((commentId: number) => {
    likeComment.mutate(
      { commentId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0, { filter }) });
        },
      }
    );
  }, [likeComment, queryClient, quoteId, filter]);

  const handleSave = useCallback((commentId: number) => {
    saveComment.mutate(
      { commentId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0, { filter }) });
        },
      }
    );
  }, [saveComment, queryClient, quoteId, filter]);

  const handleSubmit = useCallback(() => {
    if (!user || !quoteId || !commentText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createComment.mutate(
      { quoteId, data: { text: commentText.trim() } },
      {
        onSuccess: () => {
          setCommentText("");
          Keyboard.dismiss();
          queryClient.invalidateQueries({ queryKey: getGetQuoteCommentsQueryKey(quoteId, { filter: "best" }) });
          queryClient.invalidateQueries({ queryKey: getGetQuoteCommentsQueryKey(quoteId, { filter: "friends" }) });
          onCommentSaved?.();
        },
      }
    );
  }, [user, quoteId, commentText, createComment, queryClient, onCommentSaved]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        style={styles.kvWrapper}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>

          <View style={[styles.passageExcerpt, { borderColor: colors.border, borderLeftColor: colors.primary }]}>
            <Text
              style={[styles.passageText, { color: colors.mutedForeground }]}
              numberOfLines={3}
            >
              {quoteText}
            </Text>
          </View>

          <View style={[styles.tabs, { borderColor: colors.border }]}>
            {(["best", "friends"] as FilterType[]).map((f) => (
              <Pressable
                key={f}
                style={[
                  styles.tab,
                  filter === f && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                ]}
                onPress={() => setFilter(f)}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: filter === f ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {f === "best" ? "Best" : "Friends"}
                </Text>
              </Pressable>
            ))}
          </View>

          <FlatList<Comment>
            style={styles.list}
            data={comments ?? []}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <CommentCard comment={item} onLike={handleLike} onSave={handleSave} />
            )}
            ListEmptyComponent={
              isLoading ? (
                <View style={{ gap: 10, paddingTop: 10 }}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={{ marginHorizontal: 16, gap: 8 }}>
                      <LoadingShimmer width="60%" height={13} />
                      <LoadingShimmer width="100%" height={13} />
                      <LoadingShimmer width="85%" height={13} />
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState
                  icon={filter === "friends" ? "users" : "message-circle"}
                  title={filter === "friends" ? "No friends' comments" : "No comments yet"}
                  subtitle={
                    filter === "friends"
                      ? "Add friends to see their thoughts on this quote"
                      : "Be the first to share your thoughts"
                  }
                />
              )
            }
            contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          />

          <View
            style={[
              styles.inputRow,
              {
                borderColor: colors.border,
                paddingBottom: bottomPad + 8,
              },
            ]}
          >
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="Add your thought..."
              placeholderTextColor={colors.mutedForeground}
              value={commentText}
              onChangeText={setCommentText}
              multiline
              maxLength={500}
            />
            <Pressable
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: commentText.trim() ? colors.primary : colors.muted,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              onPress={handleSubmit}
              disabled={!commentText.trim() || createComment.isPending}
            >
              <Feather name="send" size={18} color={commentText.trim() ? colors.primaryForeground : colors.mutedForeground} />
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  kvWrapper: {
    flex: 1,
    justifyContent: "flex-end",
    pointerEvents: "box-none",
  },
  sheet: {
    height: "75%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: "hidden",
  },
  handleRow: {
    alignItems: "center",
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  passageExcerpt: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingLeft: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderWidth: 0,
  },
  passageText: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
  },
  sendBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
});
