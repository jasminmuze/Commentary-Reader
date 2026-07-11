import React, { useCallback } from "react";
import {
  Alert,
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
import { navigateToQuote } from "@/lib/quoteNavigation";
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
      { commentId },
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
      { commentId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSavedCommentsQueryKey(user.id) });
        },
      }
    );
  };

  // 저장한 댓글 탭: 항목을 탭하면 책이 서재에 있을 때 리더가 해당 문장에서
  // 열리고, 없으면 책 상세로 이동한다 (분기는 navigateToQuote 가 처리).
  const handleOpenInBook = useCallback((comment: Comment) => {
    navigateToQuote(comment.quoteId).catch(() => {
      Alert.alert(
        "이동할 수 없어요",
        "문장 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    });
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>저장됨</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          북마크한 댓글 · 탭하면 책 속 문장으로 이동해요
        </Text>
      </View>

      <FlatList<Comment>
        data={saved ?? []}
        keyExtractor={(item, index) => String(item.id ?? index)}
        renderItem={({ item }) => (
          <CommentCard
            comment={item}
            onLike={handleLike}
            onSave={handleSave}
            onPress={handleOpenInBook}
          />
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
              title="저장한 댓글이 없어요"
              subtitle="댓글의 북마크 아이콘을 탭하면 여기에 저장돼요"
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
