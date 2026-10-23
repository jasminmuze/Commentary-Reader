import React from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const sections = [
  {
    title: "1. EPUBs and your permissions",
    paragraphs: [
      "Only upload EPUB files that you have the legal rights and permissions to use and to let Shelfmates store and process. You are responsible for making sure your upload does not violate copyright or another person's rights.",
      "Buying or possessing an ebook file does not automatically give you permission to upload it to a service or share parts of it publicly. Do not upload unauthorized copies or bypass digital-rights protections.",
    ],
  },
  {
    title: "2. How Shelfmates handles uploaded EPUBs",
    paragraphs: [
      "Shelfmates stores your original EPUB privately for your account and processes it to provide reading, synchronization, and community-book matching features. We may extract information such as the title, author, ISBN, and cover image.",
      "Extracted book details and cover images may appear as shared book information in Shelfmates. Do not upload a file unless you have the rights and permissions needed for these uses.",
    ],
  },
  {
    title: "3. Highlights, comments, and sharing",
    paragraphs: [
      "Your highlights, comments, and replies are shown according to the audience you select. New highlights and comments may be public by default; review the visibility setting before posting.",
      "Share only excerpts and other material that you have permission to share. Other readers may be able to view, save, or refer to content that you make visible to them.",
    ],
  },
  {
    title: "4. Limited permission to operate the service",
    paragraphs: [
      "You grant Shelfmates a limited, non-exclusive, worldwide, royalty-free permission to host, store, back up, process, extract book information from, and deliver your EPUB as needed to provide the features described in these Terms. This permission also covers displaying extracted book information and any content you choose to share, according to its visibility setting.",
      "This permission is for operating Shelfmates. It does not transfer ownership of your ebook or other content to Shelfmates.",
    ],
  },
  {
    title: "5. Copyright reports and enforcement",
    paragraphs: [
      "If you believe content in Shelfmates infringes your copyright, report it in the app or email jasminmuze@gmail.com with enough information for us to identify the material. We may review reports and restrict or remove content when appropriate.",
      "We may limit or end access for accounts that repeatedly upload or share content without the necessary rights.",
    ],
  },
  {
    title: "6. Contact",
    paragraphs: [
      "Questions about these Terms or a copyright report can be sent to jasminmuze@gmail.com.",
    ],
  },
];

export default function TermsOfUseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Terms of Use
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 24) + 20 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.effectiveDate, { color: colors.mutedForeground }]}>
          Effective October 24, 2026
        </Text>
        <Text style={[styles.intro, { color: colors.foreground }]}>
          These Terms explain the permissions and responsibilities that apply when you upload EPUBs or share reading activity in Shelfmates.
        </Text>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {section.title}
            </Text>
            {section.paragraphs.map((paragraph) => (
              <Text
                key={paragraph}
                style={[styles.paragraph, { color: colors.mutedForeground }]}
              >
                {paragraph}
              </Text>
            ))}
          </View>
        ))}

        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL("mailto:jasminmuze@gmail.com")}
          style={({ pressed }) => [
            styles.contactLink,
            { opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Feather name="mail" size={16} color={colors.primary} />
          <Text style={[styles.contactText, { color: colors.primary }]}>
            Contact Shelfmates
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerSpacer: { width: 38 },
  content: { paddingHorizontal: 22, paddingTop: 22, gap: 16 },
  effectiveDate: { fontSize: 13, fontWeight: "500" },
  intro: { fontSize: 15, lineHeight: 23, fontWeight: "500" },
  section: { gap: 9, paddingTop: 8 },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  paragraph: { fontSize: 14, lineHeight: 22 },
  contactLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginTop: 4,
    minHeight: 40,
  },
  contactText: { fontSize: 14, fontWeight: "600" },
});
