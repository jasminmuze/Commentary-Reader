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

// ── @mention autocomplete helpers ────────────────────────────────────────────

/**
 * Returns the partial username being typed after a trailing "@" (e.g. "j" for
 * "nice @j"), "" right after typing "@", or null when no mention is active.
 */
function activeMentionQuery(text: string): string | null {
  const m = /(^|\s)@(\S*)$/.exec(text);
  return m ? (m[2] ?? "") : null;
}

/** Replaces the trailing partial "@..." token with the completed mention. */
function completeMentionText(text: string, username: string): string {
  return text.replace(/(^|\s)@\S*$/, `$1@${username} `);
}

/** Candidates whose username starts with the partial query (case-insensitive). */
function mentionSuggestions(
  candidates: (string | null | undefined)[],
  text: string,
  selfUsername?: string,
): string[] {
  const query = activeMentionQuery(text);
  if (query === null) return [];
  const lower = query.toLowerCase();
  return Array.from(
    new Set(candidates.filter((u): u is string => !!u && u !== selfUsername)),
  ).filter((u) => u.toLowerCase().startsWith(lower) && u.toLowerCase() !== lower);
}

// "Contains spoilers" checkbox shown on its own row below the visibility
// options in both compose bars (main comment + reply). Visually distinct from
// the visibility chips: spoiler flags the content, not who can see it.
function SpoilerCheckbox({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onToggle}
      style={styles.spoilerCheckRow}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel="Contains spoilers"
    >
      <View
        style={[
          styles.spoilerCheckBox,
          {
            backgroundColor: active ? colors.accent : "transparent",
            borderColor: active ? colors.accent : colors.border,
          },
        ]}
      >
        {active ? (
          <Feather name="check" size={12} color={colors.accentForeground} />
        ) : null}
      </View>
      <Text
        style={[
          styles.spoilerCheckLabel,
          { color: active ? colors.foreground : colors.mutedForeground },
        ]}
      >
        Contains spoilers
      </Text>
    </Pressable>
  );
}

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
  /** When set, the sheet opens directly on this comment's reply thread. */
  initialReplyThread?: Comment | null;
  /** When set, the sheet shows only this reading room's comments and posts into it. */
  roomId?: number | null;
  /** Viewer's reading progress (0-100) — used for the room spoiler guard. */
  myProgress?: number | null;
}

// Room spoiler guard: blur content written by someone further into the book
// than the viewer, until explicitly revealed.
function ProgressGuard({
  authorProgress,
  myProgress,
  children,
}: {
  authorProgress: number | null | undefined;
  myProgress: number | null | undefined;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const [revealed, setRevealed] = useState(false);
  const guarded =
    !revealed &&
    authorProgress !== null &&
    authorProgress !== undefined &&
    myProgress !== null &&
    myProgress !== undefined &&
    authorProgress > myProgress;
  if (!guarded) return <>{children}</>;
  return (
    <Pressable
      onPress={() => setRevealed(true)}
      style={[
        styles.spoilerCover,
        {
          backgroundColor: colors.muted,
          borderColor: colors.border,
          borderRadius: colors.radius,
          marginHorizontal: 16,
          marginVertical: 6,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Ahead of your progress — tap to reveal"
    >
      <Feather name="eye-off" size={14} color={colors.mutedForeground} />
      <Text style={[styles.spoilerCoverText, { color: colors.mutedForeground }]}>
        Ahead of your progress ({authorProgress}%) — tap to reveal
      </Text>
    </Pressable>
  );
}

// ── Reply thread sub-view ────────────────────────────────────────────────────

interface ReplyThreadProps {
  parentComment: Comment;
  onBack: () => void;
  bottomPad: number;
  roomId?: number | null;
  myProgress?: number | null;
}

function ReplyThread({ parentComment, onBack, bottomPad, roomId, myProgress }: ReplyThreadProps) {
  const colors = useColors();
  const { user } = useUser();
  const queryClient = useQueryClient();
  // Spoiler parent comment: blurred for everyone but the author until tapped.
  const [parentSpoilerRevealed, setParentSpoilerRevealed] = useState(false);
  const parentSpoilerHidden =
    parentComment.containsSpoilers === true &&
    user?.id !== parentComment.userId &&
    !parentSpoilerRevealed;
  const [replyText, setReplyText] = useState(`@${parentComment.username} `);
  const [visibility, setVisibility] = useState<Visibility>(
    user?.defaultVisibility ?? "public",
  );
  const [containsSpoilers, setContainsSpoilers] = useState(false);
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

  // @mention autocomplete: suggest thread participants matching the partial
  // "@..." the user is typing (shown only while a mention is being typed).
  const suggestions = mentionSuggestions(
    [parentComment.username, ...(replies ?? []).map((r) => r.username)],
    replyText,
    user?.username,
  );

  const handleSubmit = useCallback(() => {
    if (!user || !replyText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createReply.mutate(
      {
        commentId: parentComment.id,
        data: {
          text: replyText.trim(),
          visibility,
          containsSpoilers,
          ...(roomId
            ? { roomId, ...(myProgress !== null && myProgress !== undefined ? { authorProgress: myProgress } : {}) }
            : {}),
        },
      },
      {
        onSuccess: () => {
          setReplyText(`@${parentComment.username} `);
          setContainsSpoilers(false);
          Keyboard.dismiss();
          queryClient.invalidateQueries({
            queryKey: getGetCommentRepliesQueryKey(parentComment.id),
          });
          // Refresh parent comment list so replyCount updates.
          queryClient.invalidateQueries({ queryKey: ["getQuoteComments"] });
        },
      },
    );
  }, [user, replyText, visibility, containsSpoilers, createReply, parentComment, queryClient, roomId, myProgress]);

  const handleMentionChip = (username: string) => {
    setReplyText((prev) => completeMentionText(prev, username));
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
          <View style={styles.parentUserRow}>
            <Text style={[styles.parentUser, { color: colors.primary }]}>
              @{parentComment.username}
            </Text>
            {parentComment.containsSpoilers ? (
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
          </View>
          {parentSpoilerHidden ? (
            <Pressable
              onPress={() => setParentSpoilerRevealed(true)}
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
            <Text style={[styles.parentText, { color: colors.foreground }]}>
              {parentComment.text}
            </Text>
          )}
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

      {/* Mention suggestions (shown while typing "@...") */}
      {suggestions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.chipsScroll, { borderColor: colors.border }]}
          contentContainerStyle={styles.chipsContent}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map((username) => (
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
          {roomId ? (
            <View
              style={[
                styles.visChip,
                {
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather name="users" size={12} color={colors.mutedForeground} />
              <Text style={[styles.visChipText, { color: colors.mutedForeground }]}>
                Room members
              </Text>
            </View>
          ) : (
            VISIBILITY_OPTIONS.map((opt) => {
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
            })
          )}
        </View>
        <SpoilerCheckbox
          active={containsSpoilers}
          onToggle={() => setContainsSpoilers((prev) => !prev)}
        />
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

export function CommentSheet({
  visible,
  quoteId,
  quoteText,
  onClose,
  onCommentSaved,
  initialReplyThread,
  roomId,
  myProgress,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("best");
  const [commentText, setCommentText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(user?.defaultVisibility ?? "public");
  const [containsSpoilers, setContainsSpoilers] = useState(false);
  const [replyThread, setReplyThread] = useState<Comment | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Reset reply thread when sheet closes; jump straight into the requested
  // thread (e.g. from a tapped notification) when it opens.
  useEffect(() => {
    if (!visible) {
      setReplyThread(null);
    } else if (initialReplyThread) {
      setReplyThread(initialReplyThread);
    }
  }, [visible, initialReplyThread]);

  useEffect(() => {
    if (visible) {
      setVisibility(user?.defaultVisibility ?? "public");
      setContainsSpoilers(false);
    }
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

  const listParams = roomId ? { filter, roomId } : { filter };
  const { data: comments, isLoading } = useGetQuoteComments(
    quoteId ?? 0,
    listParams,
    {
      query: {
        enabled: !!quoteId && visible,
        queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0, listParams),
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
              queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0),
            });
          },
        },
      );
    },
    [likeComment, queryClient, quoteId],
  );

  const handleSave = useCallback(
    (commentId: number) => {
      saveComment.mutate(
        { commentId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetQuoteCommentsQueryKey(quoteId ?? 0),
            });
          },
        },
      );
    },
    [saveComment, queryClient, quoteId],
  );

  // @mention autocomplete: suggest quote commenters matching the partial
  // "@..." the user is typing (shown only while a mention is being typed).
  const suggestions = mentionSuggestions(
    (comments ?? []).map((c) => c.username),
    commentText,
    user?.username,
  );

  const handleMentionChip = useCallback((username: string) => {
    setCommentText((prev) => completeMentionText(prev, username));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!user || !quoteId || !commentText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createComment.mutate(
      {
        quoteId,
        data: {
          text: commentText.trim(),
          visibility,
          containsSpoilers,
          ...(roomId
            ? { roomId, ...(myProgress !== null && myProgress !== undefined ? { authorProgress: myProgress } : {}) }
            : {}),
        },
      },
      {
        onSuccess: () => {
          setCommentText("");
          setContainsSpoilers(false);
          Keyboard.dismiss();
          queryClient.invalidateQueries({
            queryKey: getGetQuoteCommentsQueryKey(quoteId),
          });
          onCommentSaved?.(visibility);
        },
      },
    );
  }, [user, quoteId, commentText, visibility, containsSpoilers, createComment, queryClient, onCommentSaved, roomId, myProgress]);

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
              // Remount when switching threads so per-thread state (draft text,
              // spoiler reveal) never leaks between different parent comments.
              key={replyThread.id}
              parentComment={replyThread}
              onBack={() => setReplyThread(null)}
              bottomPad={bottomPad}
              roomId={roomId}
              myProgress={myProgress}
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
                  <ProgressGuard
                    authorProgress={roomId ? item.authorProgress : null}
                    myProgress={myProgress}
                  >
                    <CommentCard
                      comment={item}
                      onLike={handleLike}
                      onSave={handleSave}
                      onReply={setReplyThread}
                    />
                  </ProgressGuard>
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

              {suggestions.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={[styles.chipsScroll, { borderColor: colors.border }]}
                  contentContainerStyle={styles.chipsContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {suggestions.map((username) => (
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
                  {roomId ? (
                    <View
                      style={[
                        styles.visChip,
                        {
                          backgroundColor: colors.muted,
                          borderColor: colors.border,
                          borderRadius: colors.radius,
                        },
                      ]}
                    >
                      <Feather name="users" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.visChipText, { color: colors.mutedForeground }]}>
                        Room members
                      </Text>
                    </View>
                  ) : (
                    VISIBILITY_OPTIONS.map((opt) => {
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
                    })
                  )}
                </View>
                <SpoilerCheckbox
                  active={containsSpoilers}
                  onToggle={() => setContainsSpoilers((prev) => !prev)}
                />
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
  spoilerCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  spoilerCheckBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  spoilerCheckLabel: {
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
  parentUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  spoilerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
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
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  spoilerCoverText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
