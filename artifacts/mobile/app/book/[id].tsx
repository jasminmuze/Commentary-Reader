import React, { useCallback, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetBook } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { CommentSheet } from "@/components/CommentSheet";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import type { Passage } from "@workspace/api-client-react";

function HighlightedPassage({
  passage,
  onPress,
  colors,
}: {
  passage: Passage;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const hasComments = passage.commentCount > 0;
  const bgColor =
    passage.highlightIntensity > 0
      ? `rgba(212, 137, 26, ${passage.highlightIntensity * 0.35})`
      : "transparent";
  const borderColor =
    passage.highlightIntensity > 0
      ? `rgba(212, 137, 26, ${passage.highlightIntensity * 0.7})`
      : "transparent";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.passage,
        {
          backgroundColor: pressed ? `rgba(212, 137, 26, ${(passage.highlightIntensity + 0.1) * 0.4})` : bgColor,
          borderLeftColor: borderColor,
          borderLeftWidth: passage.highlightIntensity > 0 ? 3 : 0,
          paddingLeft: passage.highlightIntensity > 0 ? 13 : 16,
        },
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.passageText,
          { color: colors.foreground },
        ]}
      >
        {passage.text}
      </Text>
      {hasComments && (
        <View style={styles.commentBadge}>
          <Feather name="message-circle" size={11} color={colors.primary} />
          <Text style={[styles.commentCount, { color: colors.primary }]}>
            {passage.commentCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function BookReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = parseInt(id ?? "0", 10);

  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const { data: book, isLoading } = useGetBook(bookId, { userId: user?.id }, {
    query: { enabled: !!bookId },
  });

  const handlePassagePress = useCallback((passage: Passage) => {
    setSelectedPassage(passage);
    setSheetVisible(true);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setSheetVisible(false);
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {book?.title ?? ""}
          </Text>
          <Text style={[styles.headerAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>
            {book?.author ?? ""}
          </Text>
        </View>
      </View>

      {/* Hint */}
      <View style={[styles.hint, { borderBottomColor: colors.border }]}>
        <Feather name="info" size={12} color={colors.mutedForeground} />
        <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
          Tap any highlighted passage to read comments
        </Text>
      </View>

      {isLoading ? (
        <View style={{ gap: 16, padding: 20 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ gap: 8 }}>
              <LoadingShimmer width="100%" height={14} />
              <LoadingShimmer width="95%" height={14} />
              <LoadingShimmer width="88%" height={14} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList<Passage>
          data={book?.passages ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <HighlightedPassage
              passage={item}
              onPress={() => handlePassagePress(item)}
              colors={colors}
            />
          )}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: bottomPad + 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <CommentSheet
        visible={sheetVisible}
        passageId={selectedPassage?.id ?? null}
        passageText={selectedPassage?.text ?? ""}
        onClose={handleCloseSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  headerAuthor: {
    fontSize: 13,
    marginTop: 1,
  },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
  },
  hintText: {
    fontSize: 12,
  },
  passage: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginVertical: 1,
    gap: 6,
  },
  passageText: {
    fontSize: 16,
    lineHeight: 27,
    letterSpacing: 0.1,
  },
  commentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  commentCount: {
    fontSize: 12,
    fontWeight: "700",
  },
});
