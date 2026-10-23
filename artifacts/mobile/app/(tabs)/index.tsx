import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserLibrary,
  useCreateLibraryEntry,
  getGetUserLibraryQueryKey,
} from "@workspace/api-client-react";
import type { LibraryEntry } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { EmptyState } from "@/components/EmptyState";
import { BookCardShimmer } from "@/components/LoadingShimmer";
import { apiUrl, uploadEpub } from "@/lib/api";

const EPUB_UPLOAD_TERMS_VERSION = "2026-10-24";

function epubUploadConsentKey(userId: number) {
  return `shelfmates:epub-upload-consent:${userId}:${EPUB_UPLOAD_TERMS_VERSION}`;
}

function LibraryCard({ entry, onOpen, onMatch }: {
  entry: LibraryEntry;
  onOpen: () => void;
  onMatch: () => void;
}) {
  const colors = useColors();
  const title = entry.book?.title ?? entry.originalTitle ?? "Untitled";
  const author = entry.book?.author ?? entry.originalAuthor ?? "Unknown author";
  const spineColor = entry.book?.coverColor ?? "#A08B76";
  const matched = !!entry.canonicalBookId;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      onPress={onOpen}
    >
      {entry.book?.coverUrl ? (
        <Image
          source={{ uri: apiUrl(`/api${entry.book.coverUrl}`) }}
          style={[styles.coverImage, { borderRadius: colors.radius }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.spine, { backgroundColor: spineColor, borderRadius: colors.radius }]}>
          <Text style={styles.spineTitle} numberOfLines={6}>{title}</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.cardAuthor, { color: colors.mutedForeground }]} numberOfLines={1}>{author}</Text>

        {matched ? (
          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: `${colors.primary}22` }]}>
              <Feather name="check-circle" size={12} color={colors.primary} />
              <Text style={[styles.chipText, { color: colors.primary }]}>Matched · {entry.book?.highlightCount ?? 0} highlights</Text>
            </View>
          </View>
        ) : (
          <Pressable onPress={onMatch} style={[styles.matchInline, { borderColor: colors.primary }]}>
            <Feather name="link" size={12} color={colors.primary} />
            <Text style={[styles.chipText, { color: colors.primary }]}>Match to a community book</Text>
          </Pressable>
        )}

        {entry.readingProgress != null && (
          <View style={styles.progressWrap}>
            <View style={[styles.progressTrack, { backgroundColor: colors.border + "60" }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${entry.readingProgress}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
              {entry.readingProgress}% read
            </Text>
          </View>
        )}
      </View>
      <View style={styles.openIcon}>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");

  const { data: library, isLoading, refetch, isRefetching } = useGetUserLibrary(
    user?.id ?? 0,
    { query: { enabled: !!user, queryKey: getGetUserLibraryQueryKey(user?.id ?? 0) } }
  );
  const createLibraryEntry = useCreateLibraryEntry();
  const [showUploadConsent, setShowUploadConsent] = useState(false);
  const [uploadConsentChecked, setUploadConsentChecked] = useState(false);
  const [checkingUploadConsent, setCheckingUploadConsent] = useState(false);
  const [savingUploadConsent, setSavingUploadConsent] = useState(false);

  const chooseAndUploadEpub = useCallback(async () => {
    if (!user || uploading) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/epub+zip", "*/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (!/\.epub$/i.test(asset.name ?? "")) {
        Alert.alert("EPUB files only", "Please choose a file with the .epub extension.");
        return;
      }
      setUploading(true);
      const uploadURL = await uploadEpub(asset.uri);
      createLibraryEntry.mutate(
        { data: { uploadURL } },
        {
          onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: getGetUserLibraryQueryKey(user.id) });
            if (data.match.status === "matched") {
              router.push(`/readium/${data.entry.id}`);
            } else {
              router.push(`/match/${data.entry.id}`);
            }
          },
          onError: () => {
            Alert.alert("Upload failed", "Couldn't add this to your library. Please try again.");
          },
          onSettled: () => setUploading(false),
        }
      );
    } catch (e) {
      setUploading(false);
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Couldn't upload the file.");
    }
  }, [user, uploading, createLibraryEntry, queryClient]);

  const handleUpload = useCallback(async () => {
    if (!user || uploading || checkingUploadConsent) return;
    setCheckingUploadConsent(true);
    try {
      const acceptedVersion = await AsyncStorage.getItem(epubUploadConsentKey(user.id));
      if (acceptedVersion === EPUB_UPLOAD_TERMS_VERSION) {
        await chooseAndUploadEpub();
      } else {
        setUploadConsentChecked(false);
        setShowUploadConsent(true);
      }
    } catch {
      Alert.alert(
        "Couldn't check upload terms",
        "Please try again before uploading an EPUB.",
      );
    } finally {
      setCheckingUploadConsent(false);
    }
  }, [user, uploading, checkingUploadConsent, chooseAndUploadEpub]);

  const confirmUploadConsent = useCallback(async () => {
    if (!user || !uploadConsentChecked || savingUploadConsent) return;
    setSavingUploadConsent(true);
    try {
      await AsyncStorage.setItem(
        epubUploadConsentKey(user.id),
        EPUB_UPLOAD_TERMS_VERSION,
      );
      setShowUploadConsent(false);
      await chooseAndUploadEpub();
    } catch {
      Alert.alert(
        "Couldn't save your confirmation",
        "Please try again before uploading an EPUB.",
      );
    } finally {
      setSavingUploadConsent(false);
    }
  }, [user, uploadConsentChecked, savingUploadConsent, chooseAndUploadEpub]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const trimmedSearch = search.trim().toLowerCase();
  const filteredLibrary = useMemo(() => {
    const entries = library ?? [];
    if (!trimmedSearch) return entries;
    return entries.filter((entry) => {
      const title = entry.book?.title ?? entry.originalTitle ?? "";
      const author = entry.book?.author ?? entry.originalAuthor ?? "";
      return (
        title.toLowerCase().includes(trimmedSearch) ||
        author.toLowerCase().includes(trimmedSearch)
      );
    });
  }, [library, trimmedSearch]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good reading,</Text>
          <Text style={[styles.username, { color: colors.foreground }]}>{user?.nickname?.trim() || user?.username || "Reader"}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.uploadBtn, { backgroundColor: colors.primary, opacity: pressed || uploading ? 0.8 : 1 }]}
          onPress={handleUpload}
          disabled={uploading || checkingUploadConsent}
        >
          {uploading || checkingUploadConsent ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather name="plus" size={22} color={colors.primaryForeground} />
          )}
        </Pressable>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search your library by title or author"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <Feather name="x-circle" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MY LIBRARY</Text>

      <FlatList<LibraryEntry>
        data={filteredLibrary}
        keyExtractor={(item, index) => String(item.id ?? index)}
        renderItem={({ item }) => (
          <LibraryCard
            entry={item}
            onOpen={() => router.push(`/readium/${item.id}`)}
            onMatch={() => router.push(`/match/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View>
              {[1, 2, 3].map((i) => <BookCardShimmer key={i} />)}
            </View>
          ) : trimmedSearch ? (
            <EmptyState
              icon="search"
              title="No books found"
              subtitle="No books in your library match that search"
            />
          ) : (
            <EmptyState
              icon="upload"
              title="Your library is empty"
              subtitle="Tap the + button in the top right to upload an EPUB and start reading"
            />
          )
        }
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={showUploadConsent}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowUploadConsent(false)}
      >
        <View style={styles.consentBackdrop}>
          <View
            style={[
              styles.consentSheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderTopLeftRadius: colors.radius + 10,
                borderTopRightRadius: colors.radius + 10,
                paddingBottom: Math.max(insets.bottom, 18),
              },
            ]}
            accessibilityViewIsModal
          >
            <View style={styles.consentHandleWrap}>
              <View style={[styles.consentHandle, { backgroundColor: colors.border }]} />
            </View>
            <View style={styles.consentHeader}>
              <View style={[styles.consentIcon, { backgroundColor: `${colors.primary}18` }]}>
                <Feather name="book-open" size={19} color={colors.primary} />
              </View>
              <View style={styles.consentHeaderCopy}>
                <Text style={[styles.consentTitle, { color: colors.foreground }]}>
                  Before you upload
                </Text>
                <Text style={[styles.consentSubtitle, { color: colors.mutedForeground }]}>
                  Please review these EPUB sharing rules.
                </Text>
              </View>
            </View>

            <ScrollView
              style={styles.consentScroll}
              contentContainerStyle={styles.consentScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.consentNotice, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.consentBody, { color: colors.foreground }]}>
                  Only upload EPUB files you have the rights and permissions to use and allow Shelfmates to store and process.
                </Text>
                <Text style={[styles.consentBody, { color: colors.foreground }]}>
                  Your original EPUB stays private to your account. Extracted book details and covers may appear in shared book information.
                </Text>
                <Text style={[styles.consentBody, { color: colors.foreground }]}>
                  Highlights and comments follow the audience you choose. Only share text you have permission to share.
                </Text>
              </View>

              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  setShowUploadConsent(false);
                  router.push("/terms-of-use");
                }}
                style={({ pressed }) => [
                  styles.termsLink,
                  { opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Text style={[styles.termsLinkText, { color: colors.primary }]}>
                  Read the full Terms of Use
                </Text>
                <Feather name="external-link" size={15} color={colors.primary} />
              </Pressable>

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: uploadConsentChecked }}
                onPress={() => setUploadConsentChecked((checked) => !checked)}
                style={styles.consentCheckboxRow}
              >
                <View
                  style={[
                    styles.consentCheckbox,
                    {
                      borderColor: uploadConsentChecked ? colors.primary : colors.mutedForeground,
                      backgroundColor: uploadConsentChecked ? colors.primary : "transparent",
                    },
                  ]}
                >
                  {uploadConsentChecked ? (
                    <Feather name="check" size={14} color={colors.primaryForeground} />
                  ) : null}
                </View>
                <Text style={[styles.consentCheckboxText, { color: colors.foreground }]}>
                  I confirm that I have these rights and agree to the Terms of Use.
                </Text>
              </Pressable>
            </ScrollView>

            <View style={styles.consentActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowUploadConsent(false)}
                disabled={savingUploadConsent}
                style={({ pressed }) => [
                  styles.consentCancelButton,
                  {
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    opacity: pressed || savingUploadConsent ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={[styles.consentCancelText, { color: colors.foreground }]}>
                  Not now
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void confirmUploadConsent()}
                disabled={!uploadConsentChecked || savingUploadConsent}
                style={({ pressed }) => [
                  styles.consentContinueButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity:
                      !uploadConsentChecked || savingUploadConsent || pressed
                        ? 0.55
                        : 1,
                  },
                ]}
              >
                {savingUploadConsent ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.consentContinueText, { color: colors.primaryForeground }]}>
                    Agree &amp; Continue
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  greeting: { fontSize: 13, fontWeight: "500" },
  username: { fontSize: 22, fontWeight: "700", letterSpacing: -0.5 },
  uploadBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 16,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  list: { flexGrow: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    overflow: "hidden",
    marginHorizontal: 16,
    marginVertical: 6,
  },
  coverImage: {
    width: 64,
    minHeight: 92,
    alignSelf: "stretch",
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  spine: {
    width: 64,
    minHeight: 92,
    paddingHorizontal: 8,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  spineTitle: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    lineHeight: 13,
  },
  cardInfo: { flex: 1, padding: 14, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
  cardAuthor: { fontSize: 13, fontWeight: "500" },
  chipRow: { flexDirection: "row", marginTop: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  matchInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  openIcon: { paddingRight: 10 },
  progressWrap: { marginTop: 8, gap: 4 },
  progressTrack: { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2 },
  progressLabel: { fontSize: 11, letterSpacing: -0.2 },
  consentBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20, 18, 16, 0.46)",
  },
  consentSheet: {
    maxHeight: "92%",
    borderTopWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  consentHandleWrap: { alignItems: "center", paddingVertical: 8 },
  consentHandle: { width: 38, height: 4, borderRadius: 2 },
  consentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
    paddingBottom: 18,
  },
  consentIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  consentHeaderCopy: { flex: 1, gap: 3 },
  consentTitle: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  consentSubtitle: { fontSize: 13, lineHeight: 18 },
  consentScroll: { flexShrink: 1 },
  consentScrollContent: { gap: 16, paddingBottom: 12 },
  consentNotice: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  consentBody: { fontSize: 14, lineHeight: 21 },
  termsLink: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
    minHeight: 32,
  },
  termsLinkText: { fontSize: 14, fontWeight: "600" },
  consentCheckboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 4,
  },
  consentCheckbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  consentCheckboxText: { flex: 1, fontSize: 14, lineHeight: 21 },
  consentActions: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 14,
    paddingBottom: 8,
  },
  consentCancelButton: {
    minHeight: 50,
    flex: 1,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  consentCancelText: { fontSize: 15, fontWeight: "600" },
  consentContinueButton: {
    minHeight: 50,
    flex: 1.35,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  consentContinueText: { fontSize: 15, fontWeight: "700" },
});
