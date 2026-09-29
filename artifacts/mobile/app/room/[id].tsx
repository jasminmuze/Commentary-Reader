import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRoom,
  useGetRoomFeed,
  useJoinRoom,
  useLeaveRoom,
  useRemoveRoomMember,
  useInviteToRoom,
  useUpdateRoom,
  useGetFriends,
  useAcceptRoomInvite,
  useDeclineRoomInvite,
  getGetRoomQueryKey,
  getGetRoomFeedQueryKey,
  getGetFriendsQueryKey,
  getGetMyRoomsQueryKey,
  getGetBookRoomsQueryKey,
  getGetNotificationsQueryKey,
  useLikeComment,
  useLikeHighlight,
  ApiError,
} from "@workspace/api-client-react";
import type { RoomDetail, RoomFeedItem, RoomMemberInfo, User } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { EmptyState } from "@/components/EmptyState";
import { CommentSheet } from "@/components/CommentSheet";
import { navigateToQuote } from "@/lib/quoteNavigation";

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// A room feed entry. Blurred when the author was further into the book than
// the viewer (spoiler guard) until explicitly revealed.
function FeedRow({
  item,
  myProgress,
  colors,
  onPress,
  onToggleLike,
  onOpenComments,
}: {
  item: RoomFeedItem;
  myProgress: number | null;
  colors: ReturnType<typeof useColors>;
  onPress: (item: RoomFeedItem) => void;
  onToggleLike: (item: RoomFeedItem) => void;
  onOpenComments: (item: RoomFeedItem) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const guarded =
    !revealed &&
    ((item.authorProgress !== null &&
      myProgress !== null &&
      item.authorProgress > myProgress) ||
      item.containsSpoilers);

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.feedRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.feedHead}>
        <UserAvatar
          username={item.username}
          nickname={item.nickname}
          avatarUrl={item.avatarUrl}
          avatarColor={item.avatarColor}
          size={26}
        />
        <Text style={[styles.feedUser, { color: colors.foreground }]}>
          {item.nickname?.trim() || item.username}
        </Text>
        <Text style={[styles.feedAction, { color: colors.mutedForeground }]}>
          {item.type === "highlight" ? "highlighted" : "commented"}
        </Text>
        {item.authorProgress !== null ? (
          <Text style={[styles.feedProgress, { color: colors.mutedForeground }]}>
            at {item.authorProgress}%
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Text style={[styles.feedTime, { color: colors.mutedForeground }]}>
          {timeAgo(item.createdAt)}
        </Text>
      </View>

      {guarded ? (
        <Pressable
          onPress={() => setRevealed(true)}
          style={[
            styles.spoilerCover,
            { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: colors.radius },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Ahead of you — tap to reveal"
        >
          <Feather name="eye-off" size={14} color={colors.mutedForeground} />
          <Text style={[styles.spoilerCoverText, { color: colors.mutedForeground }]}>
            {item.containsSpoilers ? "Spoiler — tap to reveal" : "Ahead of your progress — tap to reveal"}
          </Text>
        </Pressable>
      ) : (
        <>
          <View style={[styles.feedQuote, { borderLeftColor: colors.primary }]}>
            <Text style={[styles.feedQuoteText, { color: colors.mutedForeground }]} numberOfLines={3}>
              “{item.quoteText}”
            </Text>
          </View>
          {item.commentText ? (
            <Text style={[styles.feedComment, { color: colors.foreground }]}>{item.commentText}</Text>
          ) : null}
        </>
      )}

      <View style={styles.feedActions}>
        <Pressable
          onPress={() => onToggleLike(item)}
          hitSlop={10}
          style={({ pressed }) => [styles.feedActionBtn, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={item.likedByMe ? "Unlike" : "Like"}
        >
          <Feather
            name="heart"
            size={15}
            color={item.likedByMe ? colors.primary : colors.mutedForeground}
          />
          {item.likeCount > 0 ? (
            <Text
              style={[
                styles.feedActionText,
                {
                  color: item.likedByMe ? colors.primary : colors.mutedForeground,
                  fontWeight: item.likedByMe ? "700" : "500",
                },
              ]}
            >
              {item.likeCount}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => onOpenComments(item)}
          hitSlop={10}
          style={({ pressed }) => [styles.feedActionBtn, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Comments"
        >
          <Feather name="message-circle" size={15} color={colors.mutedForeground} />
          <Text style={[styles.feedActionText, { color: colors.mutedForeground }]}>Comment</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function MemberRow({
  member,
  isOwnerViewing,
  onKick,
  colors,
}: {
  member: RoomMemberInfo;
  isOwnerViewing: boolean;
  onKick: (member: RoomMemberInfo) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const progress = member.readingProgress;
  return (
    <Pressable style={styles.memberRow} onPress={() => router.push(`/user/${member.userId}`)}>
      <UserAvatar
        username={member.username}
        nickname={member.nickname}
        avatarUrl={member.avatarUrl}
        avatarColor={member.avatarColor}
        size={34}
      />
      <View style={{ flex: 1 }}>
        <View style={styles.memberNameRow}>
          <Text style={[styles.memberName, { color: colors.foreground }]}>
            {member.nickname?.trim() || member.username}
          </Text>
          {member.role === "owner" ? (
            <View style={[styles.ownerBadge, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
              <Text style={[styles.ownerBadgeText, { color: colors.mutedForeground }]}>OWNER</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress ?? 0}%` as `${number}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
            {progress !== null ? `${progress}%` : "—"}
          </Text>
        </View>
      </View>
      {isOwnerViewing && member.role !== "owner" ? (
        <Pressable onPress={() => onKick(member)} hitSlop={8} style={styles.kickBtn}>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export default function RoomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = parseInt(id ?? "0", 10);

  const [inviteVisible, setInviteVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPublic, setEditPublic] = useState(true);
  const [invitedIds, setInvitedIds] = useState<Set<number>>(new Set());

  const { data: room, isLoading, error } = useGetRoom(roomId, {
    query: { enabled: !!roomId, queryKey: getGetRoomQueryKey(roomId) },
  });

  const isMember = room?.isMember === true;
  const isOwner = room?.myRole === "owner";

  const { data: feed } = useGetRoomFeed(roomId, {
    query: { enabled: !!roomId && isMember, queryKey: getGetRoomFeedQueryKey(roomId) },
  });

  // ── Feed row interactions: like, open comments, jump to the passage ──────
  const likeHighlight = useLikeHighlight();
  const likeComment = useLikeComment();
  const [commentTarget, setCommentTarget] = useState<RoomFeedItem | null>(null);

  // Patches one room-feed item in the cache (optimistic like toggle).
  const patchFeedItem = useCallback(
    (type: RoomFeedItem["type"], itemId: number, patch: (it: RoomFeedItem) => RoomFeedItem) => {
      queryClient.setQueryData<RoomFeedItem[]>(
        getGetRoomFeedQueryKey(roomId),
        (old) => old?.map((it) => (it.type === type && it.id === itemId ? patch(it) : it)),
      );
    },
    [queryClient, roomId],
  );

  const handleToggleLike = useCallback(
    (item: RoomFeedItem) => {
      const wasLiked = item.likedByMe;
      patchFeedItem(item.type, item.id, (it) => ({
        ...it,
        likedByMe: !wasLiked,
        likeCount: Math.max(0, it.likeCount + (wasLiked ? -1 : 1)),
      }));
      const revert = () =>
        patchFeedItem(item.type, item.id, (it) => ({
          ...it,
          likedByMe: wasLiked,
          likeCount: Math.max(0, it.likeCount + (wasLiked ? 1 : -1)),
        }));
      const reconcile = (result: { liked: boolean; likeCount: number }) =>
        patchFeedItem(item.type, item.id, (it) => ({
          ...it,
          likedByMe: result.liked,
          likeCount: result.likeCount,
        }));
      if (item.type === "highlight") {
        likeHighlight.mutate({ highlightId: item.id }, { onSuccess: reconcile, onError: revert });
      } else {
        likeComment.mutate({ commentId: item.id }, { onSuccess: reconcile, onError: revert });
      }
    },
    [patchFeedItem, likeHighlight, likeComment],
  );

  const handleOpenFeedItem = useCallback(
    (item: RoomFeedItem) => {
      navigateToQuote(item.quoteId, {
        onFallback: () => {
          if (room?.canonicalBookId) router.push(`/book/${room.canonicalBookId}`);
        },
      }).catch(() => {
        Alert.alert("Can't open this", "Couldn't load the passage. Please try again in a moment.");
      });
    },
    [room?.canonicalBookId],
  );

  const { data: friends } = useGetFriends(user?.id ?? 0, {
    query: {
      enabled: !!user?.id && inviteVisible,
      queryKey: getGetFriendsQueryKey(user?.id ?? 0),
    },
  });

  const joinRoom = useJoinRoom();
  const leaveRoom = useLeaveRoom();
  const removeMember = useRemoveRoomMember();
  const inviteToRoom = useInviteToRoom();
  const updateRoom = useUpdateRoom();
  const acceptInvite = useAcceptRoomInvite();
  const declineInvite = useDeclineRoomInvite();

  const invalidateRoom = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) });
    queryClient.invalidateQueries({ queryKey: getGetRoomFeedQueryKey(roomId) });
    queryClient.invalidateQueries({ queryKey: getGetMyRoomsQueryKey() });
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey(user.id) });
    }
    if (room?.canonicalBookId) {
      queryClient.invalidateQueries({ queryKey: getGetBookRoomsQueryKey(room.canonicalBookId) });
    }
  }, [queryClient, roomId, room?.canonicalBookId, user?.id]);

  const handleAcceptInvite = useCallback(() => {
    acceptInvite.mutate(
      { roomId },
      {
        onSuccess: invalidateRoom,
        onError: (err) => {
          // The invite may have been withdrawn or already resolved — refresh.
          invalidateRoom();
          if (err instanceof ApiError && err.status === 404) {
            Alert.alert("Invite unavailable", "This invite is no longer pending.");
          } else {
            Alert.alert("Couldn't accept", "Please try again in a moment.");
          }
        },
      },
    );
  }, [acceptInvite, roomId, invalidateRoom]);

  const handleDeclineInvite = useCallback(() => {
    declineInvite.mutate(
      { roomId },
      {
        onSuccess: () => {
          invalidateRoom();
          router.back();
        },
        onError: () => {
          invalidateRoom();
          Alert.alert("Couldn't decline", "Please try again in a moment.");
        },
      },
    );
  }, [declineInvite, roomId, invalidateRoom]);

  const handleJoin = useCallback(() => {
    joinRoom.mutate(
      { roomId },
      {
        onSuccess: invalidateRoom,
        onError: () => Alert.alert("Couldn't join", "Please try again in a moment."),
      },
    );
  }, [joinRoom, roomId, invalidateRoom]);

  const handleLeave = useCallback(() => {
    Alert.alert("Leave this room?", "You can rejoin a public room at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () =>
          leaveRoom.mutate(
            { roomId },
            {
              onSuccess: () => {
                invalidateRoom();
                router.back();
              },
              onError: () => Alert.alert("Couldn't leave", "Please try again in a moment."),
            },
          ),
      },
    ]);
  }, [leaveRoom, roomId, invalidateRoom]);

  const handleKick = useCallback(
    (member: RoomMemberInfo) => {
      Alert.alert("Remove member?", `Remove ${member.username} from this room?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            removeMember.mutate(
              { roomId, userId: member.userId },
              {
                onSuccess: invalidateRoom,
                onError: () => Alert.alert("Couldn't remove", "Please try again in a moment."),
              },
            ),
        },
      ]);
    },
    [removeMember, roomId, invalidateRoom],
  );

  const handleInvite = useCallback(
    (friend: User) => {
      inviteToRoom.mutate(
        { roomId, data: { userId: friend.id } },
        {
          onSuccess: () => {
            setInvitedIds((prev) => new Set(prev).add(friend.id));
          },
          onError: (err) => {
            if (err instanceof ApiError && err.status === 409) {
              setInvitedIds((prev) => new Set(prev).add(friend.id));
            } else {
              Alert.alert("Couldn't invite", "Please try again in a moment.");
            }
          },
        },
      );
    },
    [inviteToRoom, roomId],
  );

  const openEdit = useCallback(() => {
    if (!room) return;
    setEditName(room.name);
    setEditDescription(room.description);
    setEditPublic(room.isPublic);
    setEditVisible(true);
  }, [room]);

  const handleSaveEdit = useCallback(() => {
    if (!editName.trim()) return;
    updateRoom.mutate(
      {
        roomId,
        data: {
          name: editName.trim(),
          description: editDescription.trim(),
          isPublic: editPublic,
        },
      },
      {
        onSuccess: () => {
          invalidateRoom();
          setEditVisible(false);
        },
        onError: () => Alert.alert("Couldn't save", "Please try again in a moment."),
      },
    );
  }, [updateRoom, roomId, editName, editDescription, editPublic, invalidateRoom]);

  const memberIds = useMemo(
    () => new Set((room?.members ?? []).map((m) => m.userId)),
    [room?.members],
  );
  const invitableFriends = (friends ?? []).filter((f) => !memberIds.has(f.id));

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {room?.name ?? "Reading room"}
          </Text>
          {room ? (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {room.isPublic ? "Public room" : "Private room"} · {room.memberCount}{" "}
              {room.memberCount === 1 ? "member" : "members"}
            </Text>
          ) : null}
        </View>
        {isOwner ? (
          <Pressable onPress={openEdit} hitSlop={8} style={styles.headerAction}>
            <Feather name="edit-2" size={18} color={colors.foreground} />
          </Pressable>
        ) : null}
        {isMember && !isOwner ? (
          <Pressable onPress={handleLeave} hitSlop={8} style={styles.headerAction}>
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : notFound || !room ? (
        <EmptyState
          icon="lock"
          title="Room not available"
          subtitle="This room is private or no longer exists"
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Book banner */}
          <Pressable
            onPress={() => router.push(`/book/${room.canonicalBookId}`)}
            style={[
              styles.bookBanner,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <View style={[styles.bookCover, { backgroundColor: room.coverColor }]}>
              <Text style={styles.bookCoverText} numberOfLines={3}>
                {room.bookTitle}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bookTitle, { color: colors.foreground }]} numberOfLines={2}>
                {room.bookTitle}
              </Text>
              <Text style={[styles.bookAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>
                {room.bookAuthor}
              </Text>
              {room.description ? (
                <Text style={[styles.roomDesc, { color: colors.mutedForeground }]} numberOfLines={3}>
                  {room.description}
                </Text>
              ) : null}
            </View>
          </Pressable>

          {/* Join / read actions */}
          {!isMember ? (
            room.invitePending ? (
              <View style={styles.inviteActionsWrap}>
                <Text style={[styles.pendingLine, { color: colors.mutedForeground }]}>
                  You&apos;ve been invited to this room.
                </Text>
                <View style={styles.inviteActionsRow}>
                  <Pressable
                    onPress={handleAcceptInvite}
                    disabled={acceptInvite.isPending || declineInvite.isPending}
                    style={({ pressed }) => [
                      styles.joinBtn,
                      styles.inviteActionBtn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: colors.radius,
                        opacity: pressed || acceptInvite.isPending ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Feather name="check" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.joinBtnText, { color: colors.primaryForeground }]}>
                      Accept invite
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDeclineInvite}
                    disabled={acceptInvite.isPending || declineInvite.isPending}
                    style={({ pressed }) => [
                      styles.joinBtn,
                      styles.inviteActionBtn,
                      {
                        backgroundColor: colors.card,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: colors.radius,
                        opacity: pressed || declineInvite.isPending ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Feather name="x" size={16} color={colors.mutedForeground} />
                    <Text style={[styles.joinBtnText, { color: colors.mutedForeground }]}>
                      Decline
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : room.isPublic ? (
              <Pressable
                onPress={handleJoin}
                disabled={joinRoom.isPending}
                style={({ pressed }) => [
                  styles.joinBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed || joinRoom.isPending ? 0.8 : 1,
                  },
                ]}
              >
                <Feather name="user-plus" size={16} color={colors.primaryForeground} />
                <Text style={[styles.joinBtnText, { color: colors.primaryForeground }]}>
                  Join room
                </Text>
              </Pressable>
            ) : null
          ) : room.myLibraryId ? (
            <Pressable
              onPress={() => router.push(`/readium/${room.myLibraryId}`)}
              style={({ pressed }) => [
                styles.joinBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather name="book-open" size={16} color={colors.primaryForeground} />
              <Text style={[styles.joinBtnText, { color: colors.primaryForeground }]}>
                Continue reading
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.pendingLine, { color: colors.mutedForeground }]}>
              Upload or match this book in your library to read along with the room.
            </Text>
          )}

          {isMember && !isOwner ? (
            <Pressable
              onPress={handleLeave}
              disabled={leaveRoom.isPending}
              style={({ pressed }) => [
                styles.leaveBtn,
                {
                  borderColor: colors.destructive,
                  borderRadius: colors.radius,
                  opacity: pressed || leaveRoom.isPending ? 0.65 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Leave reading room"
              testID="leave-reading-room"
            >
              <Feather name="log-out" size={15} color={colors.destructive} />
              <Text style={[styles.leaveBtnText, { color: colors.destructive }]}>
                Leave reading room
              </Text>
            </Pressable>
          ) : null}

          {/* Members */}
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MEMBERS</Text>
            {isMember ? (
              <Pressable
                onPress={() => {
                  setInvitedIds(new Set());
                  setInviteVisible(true);
                }}
                hitSlop={8}
                style={styles.inviteLink}
              >
                <Feather name="user-plus" size={13} color={colors.primary} />
                <Text style={[styles.inviteLinkText, { color: colors.primary }]}>Invite friends</Text>
              </Pressable>
            ) : null}
          </View>
          <View
            style={[
              styles.membersCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            {room.members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                isOwnerViewing={isOwner}
                onKick={handleKick}
                colors={colors}
              />
            ))}
          </View>

          {/* Feed */}
          {isMember ? (
            <>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginHorizontal: 20, marginTop: 24, marginBottom: 10 }]}>
                ROOM ACTIVITY
              </Text>
              {(feed ?? []).length === 0 ? (
                <Text style={[styles.emptyLine, { color: colors.mutedForeground }]}>
                  No activity yet. Highlight or comment in room scope while reading to share it here.
                </Text>
              ) : (
                (feed ?? []).map((item) => (
                  <FeedRow
                    key={`${item.type}-${item.id}`}
                    item={item}
                    myProgress={room.myReadingProgress}
                    colors={colors}
                    onPress={handleOpenFeedItem}
                    onToggleLike={handleToggleLike}
                    onOpenComments={setCommentTarget}
                  />
                ))
              )}
            </>
          ) : (
            <Text style={[styles.emptyLine, { color: colors.mutedForeground, marginTop: 24 }]}>
              Join this room to see members' highlights and discussion.
            </Text>
          )}
        </ScrollView>
      )}

      {/* Invite friends modal */}
      <Modal visible={inviteVisible} transparent animationType="fade" onRequestClose={() => setInviteVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setInviteVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Invite friends</Text>
            <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
              Friends you invite get a notification and can accept or decline.
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {invitableFriends.length === 0 ? (
                <Text style={[styles.emptyLine, { color: colors.mutedForeground, marginHorizontal: 0, marginTop: 12 }]}>
                  No friends to invite — everyone is already in, or add friends first.
                </Text>
              ) : (
                invitableFriends.map((f) => {
                  const invited = invitedIds.has(f.id);
                  return (
                    <View key={f.id} style={styles.inviteRow}>
                      <UserAvatar
                        username={f.username}
                        nickname={f.nickname}
                        avatarUrl={f.avatarUrl}
                        avatarColor={f.avatarColor}
                        size={32}
                      />
                      <Text style={[styles.memberName, { color: colors.foreground, flex: 1 }]}>
                        {f.nickname?.trim() || f.username}
                      </Text>
                      <Pressable
                        onPress={() => handleInvite(f)}
                        disabled={invited || inviteToRoom.isPending}
                        style={[
                          styles.inviteBtn,
                          {
                            backgroundColor: invited ? colors.muted : colors.primary,
                            borderRadius: colors.radius,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.inviteBtnText,
                            { color: invited ? colors.mutedForeground : colors.primaryForeground },
                          ]}
                        >
                          {invited ? "Invited" : "Invite"}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={() => setInviteVisible(false)} style={styles.modalClose}>
              <Text style={[styles.modalCloseText, { color: colors.mutedForeground }]}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Room-scoped comments for a tapped feed item */}
      <CommentSheet
        visible={commentTarget !== null}
        quoteId={commentTarget?.quoteId ?? null}
        quoteText={commentTarget?.quoteText ?? ""}
        onClose={() => setCommentTarget(null)}
        roomId={roomId}
        myProgress={room?.myReadingProgress ?? null}
        onCommentSaved={() => {
          void queryClient.invalidateQueries({ queryKey: getGetRoomFeedQueryKey(roomId) });
        }}
      />

      {/* Owner edit modal */}
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setEditVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit room</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="Room name"
              placeholderTextColor={colors.mutedForeground}
              value={editName}
              onChangeText={setEditName}
              maxLength={80}
            />
            <TextInput
              style={[
                styles.modalInput,
                { minHeight: 70, textAlignVertical: "top" },
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="Description"
              placeholderTextColor={colors.mutedForeground}
              value={editDescription}
              onChangeText={setEditDescription}
              maxLength={500}
              multiline
            />
            <View style={styles.modalSwitchRow}>
              <Text style={[styles.switchLabel, { color: colors.foreground, flex: 1 }]}>
                Public room
              </Text>
              <Switch
                value={editPublic}
                onValueChange={setEditPublic}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
            <Pressable
              onPress={handleSaveEdit}
              disabled={!editName.trim() || updateRoom.isPending}
              style={({ pressed }) => [
                styles.joinBtn,
                {
                  backgroundColor: editName.trim() ? colors.primary : colors.muted,
                  borderRadius: colors.radius,
                  marginHorizontal: 0,
                  marginTop: 16,
                  opacity: pressed || updateRoom.isPending ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.joinBtnText,
                  { color: editName.trim() ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Save changes
              </Text>
            </Pressable>
            <Pressable onPress={() => setEditVisible(false)} style={styles.modalClose}>
              <Text style={[styles.modalCloseText, { color: colors.mutedForeground }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerAction: { padding: 6 },
  bookBanner: {
    flexDirection: "row",
    gap: 14,
    margin: 16,
    padding: 14,
    borderWidth: 1,
  },
  bookCover: {
    width: 56,
    height: 82,
    borderRadius: 6,
    padding: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  bookCoverText: {
    fontSize: 8,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
  },
  bookTitle: { fontSize: 15, fontWeight: "700" },
  bookAuthor: { fontSize: 12, marginTop: 2 },
  roomDesc: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    marginHorizontal: 16,
  },
  joinBtnText: { fontSize: 14, fontWeight: "700" },
  leaveBtn: {
    height: 42,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  leaveBtnText: { fontSize: 13, fontWeight: "700" },
  inviteActionsWrap: { gap: 12 },
  inviteActionsRow: { flexDirection: "row", gap: 10, marginHorizontal: 16 },
  inviteActionBtn: { flex: 1, marginHorizontal: 0 },
  pendingLine: {
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 20,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  inviteLink: { flexDirection: "row", alignItems: "center", gap: 5 },
  inviteLinkText: { fontSize: 12, fontWeight: "700" },
  membersCard: {
    marginHorizontal: 16,
    borderWidth: 1,
    paddingVertical: 4,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  memberName: { fontSize: 14, fontWeight: "600" },
  ownerBadge: { paddingHorizontal: 6, paddingVertical: 2 },
  ownerBadgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 11, fontWeight: "600", width: 34, textAlign: "right" },
  kickBtn: { padding: 6 },
  feedRow: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderWidth: 1,
    gap: 8,
  },
  feedHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  feedUser: { fontSize: 13, fontWeight: "700" },
  feedAction: { fontSize: 12 },
  feedProgress: { fontSize: 11 },
  feedTime: { fontSize: 11 },
  feedQuote: { borderLeftWidth: 2, paddingLeft: 10 },
  feedQuoteText: { fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  feedComment: { fontSize: 14, lineHeight: 20 },
  feedActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginTop: 10,
  },
  feedActionBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  feedActionText: { fontSize: 12, fontWeight: "500" },
  spoilerCover: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  spoilerCoverText: { fontSize: 13, fontWeight: "600" },
  emptyLine: { fontSize: 13, lineHeight: 18, marginHorizontal: 20 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { borderWidth: 1, padding: 18 },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  modalSub: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  inviteBtn: { paddingHorizontal: 14, paddingVertical: 7 },
  inviteBtnText: { fontSize: 12, fontWeight: "700" },
  modalClose: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  modalCloseText: { fontSize: 13, fontWeight: "600" },
  modalInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 12,
  },
  modalSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
  },
  switchLabel: { fontSize: 14, fontWeight: "600" },
});
