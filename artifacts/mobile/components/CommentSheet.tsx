import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
  useGetCommentReplies,
  useCreateReply,
  getGetQuoteCommentsQueryKey,
  getGetCommentRepliesQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentCard } from "./CommentCard";
import { EmptyState } from "./EmptyState";
import { LoadingShimmer } from "./LoadingShimmer";
import type { Comment, Visibility } from "@workspace/api-client-react";

type FilterType = "best" | "friends";

const VISIBILITY_OPTIONS: {
  value: Visibility;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { value: "public", label: "Public", icon: "globe" },
  { value: "friends", label: "Friends", icon: "users" },
  { value: "private", label: "Private", icon: "lock" },
];

interface Props {
  visible: boolean;
  quoteId: number | null;
  quoteText: string;
  onClose: () => void;
  onCommentSaved?: (visibility: Visibility) => void;
}

// ── Reply thread sub-view ────────────────────────────────────────────────────

interface ReplyThreadProps {
  parentComment: Comment;
  onBack: () => void;
  bottomPad: number;
}

function ReplyThread({ parentComment, onBack, bottomPad }: ReplyThreadProps) {
  const colors = useColors();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState(`@${parentComment.username} `);
  const [visibility, setVisibility] = useState<Visibility>(
    user?.defaultVisibility ?? "public",
  );
  const inputRef = useRef<TextInput>(null);

  const { data: replies, isLoading } = useGetCommentReplies(
    parentComment.id,
    {
      query: {
        queryKey: getGetCommentRepliesQueryKey(parentComment.id),
        enabled: true,
      },
    },
  );

  const createReply = useCreateReply();

  // Extract unique @mention candidates from thread participants (excluding self).
  const participants = Array.from(
    new Set(
      [parentComment.username, ...(replies ?? []).map((r) => r.username)].filter(
        (u) => u !== user?.username,
      ),
    ),
  );

  const handleSubmit = useCallback(() => {
    if (!user || !replyText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createReply.mutate(
      {
        commentId: parentComment.id,
        data: { text: replyText.trim(), visibility },
      },
      {
        onSuccess: () => {
          setReplyText(`@${parentComment.username} `);
          Keyboard.dismiss();
          queryClient.invalidateQueries({
            queryKey: getGetCommentRepliesQueryKey(parentComment.id),
          });
          // Refresh parent comment list so replyCount updates.
          queryClient.invalidateQueries({ queryKey: ["getQuoteComments"] });
        },
      },
    );
  }, [user, replyText, visibility, createReply, parentComment, queryClient]);

  const handleMentionChip = (username: string) => {
    const mention = `@${username} `;
    if (replyText.includes(mention)) return;
    setReplyText((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${mention}` : mention;
    });
    inputRef.current?.focus();
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Thread header */}
      <View style={[styles.threadHeader, { borderColor: colors.border }]}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.threadTitle, { color: colors.foreground }]}>
          {(replies?.length ?? 0) > 0
            ? `${replies!.length} ${replies!.length === 1 ? "reply" : "replies"}`
            : "Replies"}
        </Text>
      </View>

      {/* Parent comment (static) */}
      <View
        style={[
          styles.parentCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <View style={styles.parentMeta}>
          <Text style={[styles.parentUser, { color: colors.primary }]}>
            @{parentComment.username}
          </Text>
          <Text style={[styles.parentText, { color: colors.foreground }]}>
            {parentComment.text}
          </Text>
        </View>
      </View>

      {/* Replies list */}
      {isLoading ? (
        <View style={{ gap: 8, padding: 16 }}>
          {[1, 2].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <LoadingShimmer width="50%" height={12} />
              <LoadingShimmer width="90%" height={12} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList<Comment>
          style={{ flex: 1 }}
          data={replies ?? []}
          keyExtractor={(item, index) => String(item.id ?? index)}
          renderItem={({ item }) => (
            <CommentCard
              comment={item}
              onLike={() => {}}
              onSave={() => {}}
              isReply
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="message-square"
              title="No replies yet"
              subtitle="Be the first to reply"
            />
          }
          contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Mention chips */}
      {participants.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.chipsScroll, { borderColor: colors.border }]}
          contentContainerStyle={styles.chipsContent}
          keyboardShouldPersistTaps="handled"
        >
          {participants.map((username) => (
            <Pressable
              key={username}
              onPress={() => handleMentionChip(username)}
              style={({ pressed }) => [
                styles.mentionChip,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.mentionChipText, { color: colors.primary }]}>
                @{username}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Reply compose */}
      <View
        style={[
          styles.inputBar,
          {
            borderColor: colors.border,
            paddingBottom: bottomPad + 8,
          },
        ]}
      >
        <View style={styles.visibilityRow}>
          {VISIBILITY_OPTIONS.map((opt) => {
            const active = visibility === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setVisibility(opt.value)}
                style={[
                  styles.visChip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Feather
                  name={opt.icon}
                  size={12}
                  color={active ? colors.primaryForeground : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.visChipText,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            placeholder={`Reply to @${parentComment.username}...`}
            placeholderTextColor={colors.mutedForeground}
            value={replyText}
            onChangeText={setReplyText}
            multiline
            maxLength={500}
            autoFocus
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: replyText.trim() ? colors.primary : colors.muted,
                borderRadius: colors.radius,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={!replyText.trim() || createReply.isPending}
          >
            <Feather
              name="send"
              size={18}
              color={replyText.trim() ? colors.primaryForeground : colors.mutedForeground}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Main CommentSheet ────────────────────────────────────────────────────────

export function CommentSheet({ visible, quoteId, quoteText, onClose, onCommentSaved }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("best");
  const [commentText, setCommentText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(user?.defaultVisibility ?? "public");
  const [replyThread, setReplyThread] = useState<Comment | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Reset reply thread when sheet closes.
  useEffect(() => {
    if (!visible) setReplyThread(null);
  }, [visible]);

  useEffect(() => {
    if (visible) setVisibility(user?.defaultVisibility ?? "public");
  }, [visible, user?.defaultVisibility]);

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
    },
  );

  const createComment = useCreateComment();
  const likeComment = useLikeComment();
  const saveComment = useSaveComment();

  const handleLike = useCallback(
    (commentId: number) => {
      likeComment.mutate(
        { commentId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0, { filter }),
            });
          },
        },
      );
    },
    [likeComment, queryClient, quoteId, filter],
  );

  const handleSave = useCallback(
    (commentId: number) => {
      saveComment.mutate(
        { commentId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0, { filter }),
            });
          },
        },
      );
    },
    [saveComment, queryClient, quoteId, filter],
  );

  const handleSubmit = useCallback(() => {
    if (!user || !quoteId || !commentText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createComment.mutate(
      { quoteId, data: { text: commentText.trim(), visibility } },
      {
        onSuccess: () => {
          setCommentText("");
          Keyboard.dismiss();
          queryClient.invalidateQueries({
            queryKey: getGetQuoteCommentsQueryKey(quoteId, { filter: "best" }),
          });
          queryClient.invalidateQueries({
            queryKey: getGetQuoteCommentsQueryKey(quoteId, { filter: "friends" }),
          });
          onCommentSaved?.(visibility);
        },
      },
    );
  }, [user, quoteId, commentText, visibility, createComment, queryClient, onCommentSaved]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={replyThread ? undefined : onClose}>
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
          {/* ── Reply thread view ── */}
          {replyThread ? (
            <ReplyThread
              parentComment={replyThread}
              onBack={() => setReplyThread(null)}
              bottomPad={bottomPad}
            />
          ) : (
            /* ── Main comment list view ── */
            <>
              <View style={styles.handleRow}>
                <View style={[styles.handle, { backgroundColor: colors.border }]} />
              </View>

              <View
                style={[
                  styles.passageExcerpt,
                  { borderColor: colors.border, borderLeftColor: colors.primary },
                ]}
              >
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
                      filter === f && {
                        borderBottomColor: colors.primary,
                        borderBottomWidth: 2,
                      },
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
                keyExtractor={(item, index) => String(item.id ?? index)}
                renderItem={({ item }) => (
                  <CommentCard
                    comment={item}
                    onLike={handleLike}
                    onSave={handleSave}
                    onReply={setReplyThread}
                  />
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
                      title={
                        filter === "friends" ? "No friends' comments" : "No comments yet"
                      }
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
                  styles.inputBar,
                  {
                    borderColor: colors.border,
                    paddingBottom: bottomPad + 8,
                  },
                ]}
              >
                <View style={styles.visibilityRow}>
                  {VISIBILITY_OPTIONS.map((opt) => {
                    const active = visibility === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setVisibility(opt.value)}
                        style={[
                          styles.visChip,
                          {
                            backgroundColor: active ? colors.primary : colors.card,
                            borderColor: active ? colors.primary : colors.border,
                            borderRadius: colors.radius,
                          },
                        ]}
                      >
                        <Feather
                          name={opt.icon}
                          size={12}
                          color={
                            active ? colors.primaryForeground : colors.mutedForeground
                          }
                        />
                        <Text
                          style={[
                            styles.visChipText,
                            {
                              color: active
                                ? colors.primaryForeground
                                : colors.mutedForeground,
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.inputRow}>
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
                    <Feather
                      name="send"
                      size={18}
                      color={
                        commentText.trim()
                          ? colors.primaryForeground
                          : colors.mutedForeground
                      }
                    />
                  </Pressable>
                </View>
              </View>
            </>
          )}
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
  inputBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 10,
  },
  visibilityRow: {
    flexDirection: "row",
    gap: 8,
  },
  visChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  visChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
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
  // Reply thread styles
  threadHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: {
    padding: 2,
  },
  threadTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  parentCard: {
    marginHorizontal: 16,
    marginVertical: 10,
    padding: 12,
    borderWidth: 1,
    gap: 4,
  },
  parentMeta: {
    gap: 4,
  },
  parentUser: {
    fontSize: 12,
    fontWeight: "700",
  },
  parentText: {
    fontSize: 13,
    lineHeight: 19,
  },
  chipsScroll: {
    borderTopWidth: 1,
    maxHeight: 48,
  },
  chipsContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  mentionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  mentionChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
