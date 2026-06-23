import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { useUpdateUserSettings } from "@workspace/api-client-react";
import type { Visibility } from "@workspace/api-client-react";

const VISIBILITY_SETTINGS: {
  value: Visibility;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { value: "public", label: "Public", description: "Anyone can see your highlights and comments", icon: "globe" },
  { value: "friends", label: "Friends", description: "Only readers you both follow can see them", icon: "users" },
  { value: "private", label: "Private", description: "Only you can see them", icon: "lock" },
];

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useUser();
  const updateSettings = useUpdateUserSettings();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleVisibilityChange = (v: Visibility) => {
    if (!user || v === user.defaultVisibility) return;
    const prev = user.defaultVisibility;
    setUser({ ...user, defaultVisibility: v });
    updateSettings.mutate(
      { userId: user.id, data: { defaultVisibility: v } },
      { onError: () => setUser({ ...user, defaultVisibility: prev }) }
    );
  };

  const memberSince = user
    ? new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 80 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
      </View>

      {/* Avatar + name */}
      <View style={[styles.profileSection, { borderBottomColor: colors.border }]}>
        <UserAvatar
          username={user?.username ?? ""}
          avatarColor={user?.avatarColor ?? colors.primary}
          size={72}
        />
        <Text style={[styles.profileName, { color: colors.foreground }]}>
          {user?.username}
        </Text>
        <Text style={[styles.profileSince, { color: colors.mutedForeground }]}>
          Member since {memberSince}
        </Text>
      </View>

      {/* Default visibility */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>DEFAULT VISIBILITY</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, gap: 4, padding: 6 }]}>
          {VISIBILITY_SETTINGS.map((opt) => {
            const active = user?.defaultVisibility === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => handleVisibilityChange(opt.value)}
                style={[
                  styles.visRow,
                  { borderRadius: colors.radius, backgroundColor: active ? colors.muted : "transparent" },
                ]}
              >
                <View
                  style={[
                    styles.visIcon,
                    { backgroundColor: active ? colors.primary : colors.muted, borderRadius: 8 },
                  ]}
                >
                  <Feather
                    name={opt.icon}
                    size={16}
                    color={active ? colors.primaryForeground : colors.mutedForeground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.visLabel, { color: colors.foreground }]}>{opt.label}</Text>
                  <Text style={[styles.visDesc, { color: colors.mutedForeground }]}>{opt.description}</Text>
                </View>
                {active ? <Feather name="check" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          New highlights and comments use this by default. You can change it for each comment as you post.
        </Text>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ABOUT BOOKMARKS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.aboutText, { color: colors.foreground }]}>
            Bookmarks is a social reading app that lets you discover what others think about the passages that moved them most. Text glows brighter where more readers have commented — explore those highlights to find the best thoughts.
          </Text>
        </View>
      </View>

      {/* How highlights work */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>HOW HIGHLIGHTS WORK</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, gap: 12 }]}>
          {[
            { label: "No glow", subtitle: "No comments yet", intensity: 0 },
            { label: "Soft glow", subtitle: "1–2 comments", intensity: 0.2 },
            { label: "Warm glow", subtitle: "3–5 comments", intensity: 0.45 },
            { label: "Bright glow", subtitle: "6–10 comments", intensity: 0.65 },
            { label: "Blazing", subtitle: "11+ comments", intensity: 0.85 },
          ].map((item) => (
            <View key={item.label} style={styles.highlightRow}>
              <View
                style={[
                  styles.highlightSwatch,
                  {
                    backgroundColor: item.intensity > 0
                      ? `rgba(212, 137, 26, ${item.intensity})`
                      : colors.muted,
                    borderRadius: 4,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.highlightLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Text style={[styles.highlightSub, { color: colors.mutedForeground }]}>{item.subtitle}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
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
  profileSection: {
    alignItems: "center",
    paddingVertical: 32,
    borderBottomWidth: 1,
    gap: 8,
  },
  profileName: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  profileSince: {
    fontSize: 13,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    padding: 16,
    borderWidth: 1,
  },
  visRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  visIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  visLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  visDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    marginHorizontal: 4,
  },
  aboutText: {
    fontSize: 14,
    lineHeight: 22,
  },
  highlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  highlightSwatch: {
    width: 48,
    height: 24,
  },
  highlightLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  highlightSub: {
    fontSize: 12,
    marginTop: 1,
  },
});
