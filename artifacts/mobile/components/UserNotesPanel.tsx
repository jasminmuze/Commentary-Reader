import React from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useGetQuoteComments,
  getGetQuoteCommentsQueryKey,
} from "@workspace/api-client-react";
import type { Quote, Comment } from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  quotes: Quote[];
  userId: number;
  cfiByQuoteId: Map<number, string>;
  onNavigate: (cfi: string) => void;
  onClose: () => void;
}

function QuoteNoteRow({
  quote,
  userId,
  cfi,
  onNavigate,
  onClose,
}: {
  quote: Quote;
  userId: number;
  cfi: string | undefined;
  onNavigate: (cfi: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();

  const { data: comments } = useGetQuoteComments(quote.id, undefined, {
    query: {
      queryKey: getGetQuoteCommentsQueryKey(quote.id),
    },
  });
  const myComment = comments?.find((c: Comment) => c.userId === userId);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { opacity: pressed ? 0.6 : 1, borderBottomColor: colors.border + "30" },
      ]}
      onPress={() => {
        if (cfi) onNavigate(cfi);
        onClose();
      }}
    >
      <View
        style={[styles.quoteBar, { backgroundColor: colors.primary + "99" }]}
      />
      <View style={styles.content}>
        <Text
          style={[styles.quoteText, { color: colors.foreground }]}
          numberOfLines={4}
        >
          {quote.text}
        </Text>
        {myComment ? (
          <View style={styles.commentBox}>
            <Text style={[styles.commentLabel, { color: colors.primary }]}>
              내 코멘트
            </Text>
            <Text
              style={[styles.commentText, { color: colors.mutedForeground }]}
              numberOfLines={3}
            >
              {myComment.text}
            </Text>
            <Text style={[styles.date, { color: colors.mutedForeground }]}>
              {new Date(myComment.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
        ) : null}
        {!cfi ? (
          <Text style={[styles.noNav, { color: colors.mutedForeground + "80" }]}>
            위치 정보 없음
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function UserNotesPanel({
  visible,
  quotes,
  userId,
  cfiByQuoteId,
  onNavigate,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.panel,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 8,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View
          style={[styles.header, { borderBottomColor: colors.border + "80" }]}
        >
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            내 하이라이트
          </Text>
          <Pressable onPress={onClose} hitSlop={16} style={styles.closeBtn}>
            <Text style={[styles.closeTxt, { color: colors.mutedForeground }]}>
              닫기
            </Text>
          </Pressable>
        </View>

        {quotes.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            아직 남긴 하이라이트나 메모가 없어요.
          </Text>
        ) : (
          <FlatList
            data={quotes}
            keyExtractor={(q) => String(q.id)}
            renderItem={({ item }) => (
              <QuoteNoteRow
                quote={item}
                userId={userId}
                cfi={cfiByQuoteId.get(item.id)}
                onNavigate={onNavigate}
                onClose={onClose}
              />
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#00000040",
  },
  panel: {
    maxHeight: "70%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeTxt: { fontSize: 14 },
  row: {
    flexDirection: "row",
    paddingVertical: 14,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quoteBar: {
    width: 3,
    borderRadius: 2,
    marginHorizontal: 14,
    alignSelf: "stretch",
    minHeight: 20,
  },
  content: { flex: 1 },
  quoteText: { fontSize: 14, lineHeight: 21 },
  commentBox: { marginTop: 8 },
  commentLabel: { fontSize: 11, fontWeight: "600", marginBottom: 3 },
  commentText: { fontSize: 13, lineHeight: 19 },
  date: { fontSize: 11, marginTop: 4 },
  noNav: { fontSize: 11, marginTop: 6 },
  empty: {
    textAlign: "center",
    paddingVertical: 48,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 24,
  },
});
