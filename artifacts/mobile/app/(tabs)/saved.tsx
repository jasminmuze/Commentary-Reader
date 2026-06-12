import React from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSavedComments,
  useLikeComment,
  useSaveComment,
  getGetSavedCommentsQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentCard } from "@/components/CommentCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import type { Comment } from "@workspace/api-client-react";

export default function SavedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const { data: saved, isLoading, refetch, isRefetching } = useGetSavedComments(
    user?.id ?? 0,
    { query: { enabled: !!user, queryKey: getGetSavedCommentsQueryKey(user?.id ?? 0) } }
  );

  const likeComment = useLikeComment();
  const saveComment = useSaveComment();

  const handleLike = (commentId: number) => {
    if (!user) return;
    likeComment.mutate(
      { commentId, data: { userId: user.id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSavedCommentsQueryKey(user.id) });
        },
      }
    );
  };

  const handleSave = (commentId: number) => {
    if (!user) return;
    saveComment.mutate(
      { commentId, data: { userId: user.id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSavedCommentsQueryKey(user.id) });
        },
      }
    );
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Saved</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Comments you've bookmarked
        </Text>
      </View>

      <FlatList<Comment>
        data={saved ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <CommentCard comment={item} onLike={handleLike} onSave={handleSave} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ gap: 12, paddingTop: 20 }}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={{ marginHorizontal: 16, gap: 8 }}>
                  <LoadingShimmer width="60%" height={14} />
                  <LoadingShimmer width="100%" height={14} />
                  <LoadingShimmer width="80%" height={14} />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="bookmark"
              title="No saved comments"
              subtitle="Tap the bookmark icon on any comment to save it here for later"
            />
          )
        }
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 80 }]}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  list: {
    paddingTop: 12,
    flexGrow: 1,
  },
});
