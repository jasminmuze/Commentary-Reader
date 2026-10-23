import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetBlockedUsersQueryKey,
  useGetBlockedUsers,
  useUnblockUser,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";

export default function BlockedUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const blockedUsers = useGetBlockedUsers(user?.id ?? 0, {
    query: {
      enabled: Boolean(user),
      queryKey: getGetBlockedUsersQueryKey(user?.id ?? 0),
    },
  });
  const unblockUser = useUnblockUser();

  const confirmUnblock = (blockedUserId: number, name: string) => {
    if (!user) return;
    Alert.alert(
      `Unblock ${name}?`,
      "Their public activity will be visible again. You can block them later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: () =>
            unblockUser.mutate(
              { userId: user.id, blockedUserId },
              {
                onSuccess: async () => {
                  await queryClient.invalidateQueries({
                    queryKey: getGetBlockedUsersQueryKey(user.id),
                  });
                  await queryClient.invalidateQueries();
                },
                onError: () =>
                  Alert.alert("Couldn’t unblock account", "Please try again."),
              },
            ),
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top + 8 },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Blocked accounts</Text>
        <View style={styles.backButton} />
      </View>

      {blockedUsers.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : blockedUsers.isError ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Couldn’t load blocked accounts.
          </Text>
          <Pressable onPress={() => void blockedUsers.refetch()}>
            <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (blockedUsers.data?.length ?? 0) === 0 ? (
        <View style={styles.center}>
          <Feather name="slash" size={30} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            You haven’t blocked anyone.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {blockedUsers.data?.map((blocked) => {
            const name = blocked.nickname?.trim() || blocked.username;
            return (
              <View
                key={blocked.id}
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Pressable
                  onPress={() => router.push(`/user/${blocked.id}`)}
                  style={styles.identity}
                >
                  <UserAvatar
                    username={blocked.username}
                    nickname={blocked.nickname}
                    avatarUrl={blocked.avatarUrl}
                    avatarColor={blocked.avatarColor}
                    size={42}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={[styles.username, { color: colors.mutedForeground }]}>
                      @{blocked.username}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${name}`}
                  disabled={unblockUser.isPending}
                  onPress={() => confirmUnblock(blocked.id, name)}
                  style={({ pressed }) => [
                    styles.unblockButton,
                    {
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed || unblockUser.isPending ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.unblockText, { color: colors.foreground }]}>Unblock</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 36, alignItems: "flex-start" },
  title: { fontSize: 17, fontWeight: "700" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  emptyText: { fontSize: 14, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "700" },
  list: { padding: 16, gap: 10 },
  row: {
    minHeight: 68,
    padding: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  name: { fontSize: 14, fontWeight: "700" },
  username: { marginTop: 2, fontSize: 12 },
  unblockButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderWidth: 1,
  },
  unblockText: { fontSize: 12, fontWeight: "700" },
});
