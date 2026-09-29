import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { UserAvatar } from "@/components/UserAvatar";
import { FeedbackModal } from "@/components/FeedbackModal";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  useUpdateUserSettings,
  useGetAvatarUploadUrl,
  useSetAvatar,
  useRemoveAvatar,
  useSendVerificationEmail,
  useConfirmEmailVerification,
  useDeleteUserAccount,
  ApiError,
} from "@workspace/api-client-react";
import type { Visibility, FeedbackInputType } from "@workspace/api-client-react";

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
  const { user, setUser, logout } = useUser();
  const queryClient = useQueryClient();
  const updateSettings = useUpdateUserSettings();
  const deleteUserAccount = useDeleteUserAccount();
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const getUploadUrl = useGetAvatarUploadUrl();
  const setAvatar = useSetAvatar();
  const removeAvatar = useRemoveAvatar();
  const sendVerification = useSendVerificationEmail();
  const confirmVerification = useConfirmEmailVerification();

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyMessage, setVerifyMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [feedbackType, setFeedbackType] = useState<FeedbackInputType | null>(null);

  type UserResponse = {
    id: number;
    username: string;
    nickname?: string | null;
    avatarUrl?: string | null;
    email?: string | null;
    emailVerified?: boolean;
    avatarColor: string;
    defaultVisibility?: Visibility;
  };

  const applyUserResponse = (data: UserResponse) => {
    if (!user) return;
    setUser({
      ...user,
      nickname: data.nickname ?? null,
      avatarUrl: data.avatarUrl ?? null,
      email: data.email ?? user.email,
      emailVerified: data.emailVerified ?? user.emailVerified,
      defaultVisibility: data.defaultVisibility ?? user.defaultVisibility,
    });
  };

  const notify = (title: string, message: string) => {
    if (Platform.OS === "web") return;
    Alert.alert(title, message);
  };

  const pickAndUploadAvatar = async () => {
    if (!user || avatarBusy) return;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      setAvatarBusy(true);

      const { uploadURL } = await getUploadUrl.mutateAsync({ userId: user.id });

      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      } else {
        const result = await FileSystem.uploadAsync(uploadURL, asset.uri, {
          httpMethod: "PUT",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        });
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Upload failed (${result.status})`);
        }
      }

      const updated = await setAvatar.mutateAsync({
        userId: user.id,
        data: { uploadURL },
      });
      applyUserResponse(updated);
    } catch {
      notify("Photo upload failed", "Something went wrong while uploading your photo. Please try again.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarPress = () => {
    if (!user || avatarBusy) return;
    if (Platform.OS === "web" || !user.avatarUrl) {
      void pickAndUploadAvatar();
      return;
    }
    Alert.alert("Profile photo", undefined, [
      { text: "Choose new photo", onPress: () => void pickAndUploadAvatar() },
      {
        text: "Remove photo",
        style: "destructive",
        onPress: () => {
          setAvatarBusy(true);
          removeAvatar.mutate(
            { userId: user.id },
            {
              onSuccess: (updated) => applyUserResponse(updated),
              onSettled: () => setAvatarBusy(false),
            },
          );
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const startNicknameEdit = () => {
    if (!user) return;
    setNicknameDraft(user.nickname ?? "");
    setEditingNickname(true);
  };

  const saveNickname = () => {
    if (!user || nicknameSaving) return;
    const trimmed = nicknameDraft.trim();
    if (trimmed.length > 30) return;
    setNicknameSaving(true);
    updateSettings.mutate(
      { userId: user.id, data: { nickname: trimmed } },
      {
        onSuccess: (updated) => {
          applyUserResponse(updated);
          setEditingNickname(false);
        },
        onError: () => notify("Save failed", "Could not save your nickname. Please try again."),
        onSettled: () => setNicknameSaving(false),
      },
    );
  };

  const handleResendVerification = () => {
    if (!user || sendVerification.isPending) return;
    setVerifyMessage(null);
    sendVerification.mutate(
      { userId: user.id },
      {
        onSuccess: () =>
          setVerifyMessage({ text: "Verification email sent. Check your inbox.", error: false }),
        onError: (err: unknown) => {
          if (err instanceof ApiError && err.status === 429) {
            setVerifyMessage({ text: "Email sent recently — try again in a minute.", error: true });
          } else if (err instanceof ApiError && err.status === 502) {
            setVerifyMessage({ text: "Could not send the email right now. Try again later.", error: true });
          } else {
            setVerifyMessage({ text: "Something went wrong. Please try again.", error: true });
          }
        },
      },
    );
  };

  const handleConfirmCode = () => {
    if (!user || confirmVerification.isPending) return;
    const code = verifyCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setVerifyMessage({ text: "Enter the 6-digit code from the email.", error: true });
      return;
    }
    setVerifyMessage(null);
    confirmVerification.mutate(
      { userId: user.id, data: { code } },
      {
        onSuccess: (updated) => {
          applyUserResponse(updated);
          setVerifyCode("");
          setVerifyMessage({ text: "Email verified!", error: false });
        },
        onError: (err: unknown) => {
          if (err instanceof ApiError && err.status === 400) {
            setVerifyMessage({ text: "That code is incorrect or expired. Try resending the email.", error: true });
          } else {
            setVerifyMessage({ text: "Something went wrong. Please try again.", error: true });
          }
        },
      },
    );
  };

  const performLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      void performLogout();
      return;
    }
    Alert.alert("Log out", "Are you sure you want to log out? Push notifications to this device will also stop.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void performLogout() },
    ]);
  };

  const openDeleteAccount = () => {
    setDeletePassword("");
    setDeleteConfirmed(false);
    setDeleteError("");
    setDeleteModalVisible(true);
  };

  const handleDeleteAccount = async () => {
    if (!user || !deletePassword || !deleteConfirmed || deleteUserAccount.isPending) return;
    setDeleteError("");
    let objectCleanupPending = false;
    try {
      const result = await deleteUserAccount.mutateAsync({
        userId: user.id,
        data: { password: deletePassword },
      });
      objectCleanupPending = result.objectCleanupPending;
    } catch (error) {
      setDeleteError(
        error instanceof ApiError && error.status === 401
          ? "That password is incorrect. Your account is still active."
          : "We couldn't delete your account. Please try again. Your session is still active.",
      );
      setDeletePassword("");
      return;
    }

    // From this point on the server has confirmed permanent deletion. Failures
    // in local cleanup must never be reported as a failed account deletion.
    setDeletePassword("");
    setDeleteModalVisible(false);
    const cleanupWarnings: string[] = [];
    try {
      queryClient.clear();
    } catch {
      cleanupWarnings.push("The app couldn't clear all cached data.");
    }
    try {
      await logout();
    } catch {
      cleanupWarnings.push("The app couldn't clear all saved sign-in data.");
    }
    try {
      router.replace("/");
    } catch {
      cleanupWarnings.push("The app couldn't return to the sign-in screen; please restart Shelfmates.");
    }

    if (objectCleanupPending) {
      cleanupWarnings.push("Some account-owned files could not be removed. Please contact support.");
    }
    if (cleanupWarnings.length > 0) {
      Alert.alert(
        "Account deleted",
        `Your account was permanently deleted. ${cleanupWarnings.join(" ")}`,
      );
    }
  };

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

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
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
        <Pressable
          onPress={handleAvatarPress}
          disabled={avatarBusy}
          style={({ pressed }) => [{ opacity: pressed || avatarBusy ? 0.6 : 1 }]}
        >
          <UserAvatar
            username={user?.username ?? ""}
            nickname={user?.nickname}
            avatarUrl={user?.avatarUrl}
            avatarColor={user?.avatarColor ?? colors.primary}
            size={72}
          />
          <View
            style={[
              styles.avatarBadge,
              { backgroundColor: colors.primary, borderColor: colors.background },
            ]}
          >
            {avatarBusy ? (
              <ActivityIndicator size={12} color={colors.primaryForeground} />
            ) : (
              <Feather name="camera" size={12} color={colors.primaryForeground} />
            )}
          </View>
        </Pressable>

        {editingNickname ? (
          <View style={styles.nicknameEditRow}>
            <TextInput
              style={[
                styles.nicknameInput,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="Nickname (leave empty to clear)"
              placeholderTextColor={colors.mutedForeground}
              value={nicknameDraft}
              onChangeText={setNicknameDraft}
              maxLength={30}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveNickname}
            />
            <Pressable
              onPress={saveNickname}
              disabled={nicknameSaving}
              style={[styles.nicknameAction, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            >
              {nicknameSaving ? (
                <ActivityIndicator size={14} color={colors.primaryForeground} />
              ) : (
                <Feather name="check" size={16} color={colors.primaryForeground} />
              )}
            </Pressable>
            <Pressable
              onPress={() => setEditingNickname(false)}
              style={[styles.nicknameAction, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={startNicknameEdit} style={styles.nameRow}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>
              {user?.nickname?.trim() || user?.username}
            </Text>
            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
        <Text style={[styles.profileSince, { color: colors.mutedForeground }]}>
          @{user?.username} · Member since {memberSince}
        </Text>
      </View>

      {/* Email verification */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>EMAIL</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, gap: 12 }]}>
          <View style={styles.emailRow}>
            <View
              style={[
                styles.visIcon,
                {
                  backgroundColor: user?.emailVerified ? colors.primary : colors.muted,
                  borderRadius: 8,
                },
              ]}
            >
              <Feather
                name={user?.emailVerified ? "check-circle" : "mail"}
                size={16}
                color={user?.emailVerified ? colors.primaryForeground : colors.mutedForeground}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.visLabel, { color: colors.foreground }]}>
                {user?.email ?? "No email on file"}
              </Text>
              <Text style={[styles.visDesc, { color: user?.emailVerified ? colors.primary : colors.mutedForeground }]}>
                {user?.emailVerified ? "Verified" : "Not verified yet"}
              </Text>
            </View>
          </View>

          {user?.email && !user.emailVerified ? (
            <>
              <View style={styles.verifyRow}>
                <TextInput
                  style={[
                    styles.verifyInput,
                    {
                      backgroundColor: colors.background,
                      color: colors.foreground,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                  placeholder="6-digit code"
                  placeholderTextColor={colors.mutedForeground}
                  value={verifyCode}
                  onChangeText={(t) => {
                    setVerifyCode(t.replace(/[^0-9]/g, "").slice(0, 6));
                    setVerifyMessage(null);
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <Pressable
                  onPress={handleConfirmCode}
                  disabled={confirmVerification.isPending}
                  style={({ pressed }) => [
                    styles.verifyButton,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: colors.radius,
                      opacity: pressed || confirmVerification.isPending ? 0.7 : 1,
                    },
                  ]}
                >
                  {confirmVerification.isPending ? (
                    <ActivityIndicator size={14} color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.verifyButtonText, { color: colors.primaryForeground }]}>Verify</Text>
                  )}
                </Pressable>
              </View>
              <Pressable onPress={handleResendVerification} disabled={sendVerification.isPending}>
                <Text style={[styles.resendText, { color: colors.primary, opacity: sendVerification.isPending ? 0.5 : 1 }]}>
                  {sendVerification.isPending ? "Sending..." : "Resend verification email"}
                </Text>
              </Pressable>
            </>
          ) : null}

          {verifyMessage ? (
            <Text
              style={[
                styles.visDesc,
                { color: verifyMessage.error ? colors.destructive : colors.primary },
              ]}
            >
              {verifyMessage.text}
            </Text>
          ) : null}
        </View>
      </View>

      {/* My records */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>My activity</Text>
        <Pressable
          onPress={() => router.push("/records")}
          style={({ pressed }) => [
            styles.card,
            styles.recordsButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.visIcon,
              { backgroundColor: colors.primary, borderRadius: 8 },
            ]}
          >
            <Feather name="book-open" size={16} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.visLabel, { color: colors.foreground }]}>My records</Text>
            <Text style={[styles.visDesc, { color: colors.mutedForeground }]}>
              Highlights, comments, and saves by book
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Notification settings */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Notifications</Text>
        <Pressable
          onPress={() => router.push("/notification-settings")}
          style={({ pressed }) => [
            styles.card,
            styles.recordsButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.visIcon,
              { backgroundColor: colors.primary, borderRadius: 8 },
            ]}
          >
            <Feather name="bell" size={16} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.visLabel, { color: colors.foreground }]}>Notification settings</Text>
            <Text style={[styles.visDesc, { color: colors.mutedForeground }]}>
              Choose which notifications you receive
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>
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
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ABOUT SHELFMATES</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.aboutText, { color: colors.foreground }]}>
            Shelfmates is a social reading app that lets you discover what others think about the passages that moved them most. Text glows brighter where more readers have commented — explore those highlights to find the best thoughts.
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

      {/* Support */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SUPPORT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, gap: 4, padding: 6 }]}>
          <Pressable
            onPress={() => setFeedbackType("feedback")}
            style={({ pressed }) => [
              styles.visRow,
              { borderRadius: colors.radius, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={[styles.visIcon, { backgroundColor: colors.muted, borderRadius: 8 }]}>
              <Feather name="message-circle" size={16} color={colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.visLabel, { color: colors.foreground }]}>Send Feedback</Text>
              <Text style={[styles.visDesc, { color: colors.mutedForeground }]}>
                Share ideas or suggestions
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={() => setFeedbackType("bug")}
            style={({ pressed }) => [
              styles.visRow,
              { borderRadius: colors.radius, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={[styles.visIcon, { backgroundColor: colors.muted, borderRadius: 8 }]}>
              <Feather name="alert-circle" size={16} color={colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.visLabel, { color: colors.foreground }]}>Report a Bug</Text>
              <Text style={[styles.visDesc, { color: colors.mutedForeground }]}>
                Tell us when something breaks
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <FeedbackModal
        visible={feedbackType !== null}
        type={feedbackType ?? "feedback"}
        onClose={() => setFeedbackType(null)}
      />

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleteUserAccount.isPending) setDeleteModalVisible(false);
        }}
      >
        <View style={[styles.deleteOverlay, { backgroundColor: "rgba(0, 0, 0, 0.55)" }]}>
          <KeyboardAwareScrollViewCompat
            contentContainerStyle={styles.deleteModalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View
              accessibilityViewIsModal
              style={[
                styles.deleteModal,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View style={styles.deleteModalHeading}>
                <Feather name="alert-triangle" size={22} color={colors.destructive} />
                <Text style={[styles.deleteModalTitle, { color: colors.foreground }]}>
                  Permanently delete your account?
                </Text>
              </View>
              <Text style={[styles.deleteModalText, { color: colors.mutedForeground }]}>
                This is irreversible. Your account and associated content will be permanently deleted and cannot be restored.
              </Text>
              <Text style={[styles.deleteModalLabel, { color: colors.foreground }]}>
                Enter your password to continue
              </Text>
              <TextInput
                style={[
                  styles.deletePasswordInput,
                  {
                    backgroundColor: colors.card,
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                accessibilityLabel="Account password"
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                value={deletePassword}
                onChangeText={(value) => {
                  setDeletePassword(value);
                  setDeleteError("");
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleDeleteAccount}
                editable={!deleteUserAccount.isPending}
              />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: deleteConfirmed, disabled: deleteUserAccount.isPending }}
                accessibilityLabel="I understand this action is permanent and cannot be undone"
                onPress={() => setDeleteConfirmed((confirmed) => !confirmed)}
                disabled={deleteUserAccount.isPending}
                style={styles.deleteConfirmRow}
              >
                <View
                  style={[
                    styles.deleteCheckbox,
                    {
                      borderColor: deleteConfirmed ? colors.destructive : colors.border,
                      backgroundColor: deleteConfirmed ? colors.destructive : "transparent",
                    },
                  ]}
                >
                  {deleteConfirmed ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
                </View>
                <Text style={[styles.deleteConfirmText, { color: colors.foreground }]}>
                  I understand this action is permanent and cannot be undone.
                </Text>
              </Pressable>
              {deleteError ? (
                <Text accessibilityRole="alert" style={[styles.deleteError, { color: colors.destructive }]}>
                  {deleteError}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Permanently delete my account"
                disabled={!deletePassword || !deleteConfirmed || deleteUserAccount.isPending}
                onPress={() => void handleDeleteAccount()}
                style={({ pressed }) => [
                  styles.deleteActionButton,
                  {
                    backgroundColor: colors.destructive,
                    borderRadius: colors.radius,
                    opacity: pressed || !deletePassword || !deleteConfirmed || deleteUserAccount.isPending ? 0.65 : 1,
                  },
                ]}
              >
                {deleteUserAccount.isPending ? (
                  <ActivityIndicator size={16} color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.deleteActionText, { color: colors.primaryForeground }]}>
                    Permanently delete account
                  </Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDeletePassword("");
                  setDeleteModalVisible(false);
                }}
                disabled={deleteUserAccount.isPending}
                style={styles.deleteCancelButton}
              >
                <Text style={[styles.deleteCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </View>
          </KeyboardAwareScrollViewCompat>
        </View>
      </Modal>

      {/* Account */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Privacy policy"
          onPress={() => void Linking.openURL(`https://${process.env.EXPO_PUBLIC_DOMAIN}/privacy-policy`)}
          style={({ pressed }) => [
            styles.card,
            styles.logoutButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.6 : 1,
              marginBottom: 12,
            },
          ]}
        >
          <Feather name="shield" size={18} color={colors.foreground} />
          <Text style={[styles.logoutText, { color: colors.foreground }]}>Privacy policy</Text>
          <Feather name="external-link" size={16} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          style={({ pressed }) => [
            styles.card,
            styles.logoutButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed || loggingOut ? 0.6 : 1,
            },
          ]}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>
            {loggingOut ? "Logging out..." : "Log out"}
          </Text>
        </Pressable>
        <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
          Logging out stops push notifications to this device.
        </Text>
      </View>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.destructive }]}>DANGER ZONE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.visDesc, { color: colors.mutedForeground, marginTop: 0, marginBottom: 12 }]}>
            Permanently delete your account and associated content.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            onPress={openDeleteAccount}
            disabled={deleteUserAccount.isPending}
            style={({ pressed }) => [
              styles.deleteEntryButton,
              {
                backgroundColor: colors.destructive,
                borderRadius: colors.radius,
                opacity: pressed || deleteUserAccount.isPending ? 0.65 : 1,
              },
            ]}
          >
            <Feather name="trash-2" size={16} color={colors.primaryForeground} />
            <Text style={[styles.deleteActionText, { color: colors.primaryForeground }]}>Delete account</Text>
          </Pressable>
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
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  nicknameEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    width: "100%",
  },
  nicknameInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  nicknameAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  verifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  verifyInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 16,
    letterSpacing: 2,
    borderWidth: 1,
  },
  verifyButton: {
    height: 44,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  verifyButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  resendText: {
    fontSize: 13,
    fontWeight: "600",
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
  recordsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "600",
  },
  deleteOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  deleteModalScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 24,
  },
  deleteModal: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  deleteModalHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  deleteModalTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: "700",
  },
  deleteModalText: {
    fontSize: 14,
    lineHeight: 21,
  },
  deleteModalLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },
  deletePasswordInput: {
    height: 48,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 1,
  },
  deleteConfirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  deleteCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteConfirmText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  deleteError: {
    fontSize: 13,
    lineHeight: 18,
  },
  deleteEntryButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  deleteActionButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  deleteActionText: {
    fontSize: 14,
    fontWeight: "700",
  },
  deleteCancelButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteCancelText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
