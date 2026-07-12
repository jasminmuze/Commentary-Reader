import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNotificationSettings,
  useUpdateNotificationSettings,
  getGetNotificationSettingsQueryKey,
} from "@workspace/api-client-react";
import type { NotificationSettings } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";

const SETTING_ROWS: {
  key: keyof NotificationSettings;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  {
    key: "likes",
    label: "Likes",
    description: "When someone likes your highlight or comment",
    icon: "heart",
  },
  {
    key: "replies",
    label: "Replies",
    description: "When someone replies to your comment",
    icon: "message-circle",
  },
  {
    key: "mentions",
    label: "Mentions",
    description: "When someone @mentions you",
    icon: "at-sign",
  },
  {
    key: "friends",
    label: "Friends",
    description: "Friend requests and accepted requests",
    icon: "users",
  },
];

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const userId = user?.id ?? 0;

  const queryKey = getGetNotificationSettingsQueryKey(userId);
  const { data, isLoading } = useGetNotificationSettings(userId, {
    query: { enabled: !!userId, queryKey },
  });

  const updateSettings = useUpdateNotificationSettings();

  const handleToggle = (key: keyof NotificationSettings, value: boolean) => {
    if (!data || !userId) return;
    const next: NotificationSettings = { ...data, [key]: value };
    // Optimistic: flip immediately, revert on error.
    queryClient.setQueryData<NotificationSettings>(queryKey, next);
    updateSettings.mutate(
      { userId, data: next },
      {
        onSuccess: (server) => {
          queryClient.setQueryData<NotificationSettings>(queryKey, server);
        },
        onError: () => {
          queryClient.setQueryData<NotificationSettings>(queryKey, data);
        },
      },
    );
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, borderBottomColor: colors.border },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Notifications
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          PUSH & IN-APP NOTIFICATIONS
        </Text>

        {isLoading || !data ? (
          <View style={{ gap: 14, paddingTop: 8 }}>
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={{ gap: 6 }}>
                <LoadingShimmer width="30%" height={14} />
                <LoadingShimmer width="70%" height={12} />
              </View>
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            {SETTING_ROWS.map((row, idx) => (
              <View
                key={row.key}
                style={[
                  styles.row,
                  idx < SETTING_ROWS.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: colors.muted, borderRadius: 8 },
                  ]}
                >
                  <Feather name={row.icon} size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                    {row.label}
                  </Text>
                  <Text
                    style={[styles.rowDesc, { color: colors.mutedForeground }]}
                  >
                    {row.description}
                  </Text>
                </View>
                <Switch
                  value={data[row.key]}
                  onValueChange={(v) => handleToggle(row.key, v)}
                  trackColor={{ false: colors.muted, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          Turning a type off stops both push notifications and in-app
          notifications for it.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  card: {
    borderWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  rowDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
});
