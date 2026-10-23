import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useCreateUser,
  useLoginUser,
  useSendVerificationEmail,
  useConfirmEmailVerification,
  useRequestPasswordReset,
  useConfirmPasswordReset,
  setAuthTokenGetter,
  ApiError,
} from "@workspace/api-client-react";
import type { Visibility } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { apiUrl } from "@/lib/api";
import { PUSH_TOKEN_KEY, takeRememberedPushToken } from "@/lib/pushNotifications";

const USER_ID_KEY = "bookmarks_user_id";
const TOKEN_KEY = "bookmarks_token";

// Register the token getter once at module load so all customFetch calls
// automatically include the Authorization: Bearer header.
setAuthTokenGetter(() => AsyncStorage.getItem(TOKEN_KEY));

interface CurrentUser {
  id: number;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
  avatarColor: string;
  defaultVisibility: Visibility;
  createdAt: string | null;
}

interface UserContextType {
  user: CurrentUser | null;
  isInitialized: boolean;
  setUser: (user: CurrentUser) => void;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  isInitialized: false,
  setUser: () => {},
  logout: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

type AuthMode = "signup" | "login";

function AuthScreen({
  onComplete,
  initialPendingUser = null,
  onLogout,
}: {
  onComplete: (user: CurrentUser) => void;
  initialPendingUser?: CurrentUser | null;
  onLogout: () => Promise<void>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<AuthMode>("signup");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const createUser = useCreateUser();
  const loginUser = useLoginUser();
  const sendVerification = useSendVerificationEmail();
  const confirmVerification = useConfirmEmailVerification();

  // After signup we pause on a verification step before entering the app.
  const [pendingUser, setPendingUser] = useState<CurrentUser | null>(initialPendingUser);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyMessage, setVerifyMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const requestReset = useRequestPasswordReset();
  const confirmReset = useConfirmPasswordReset();

  // Forgot password flow: null = not active; "request" = enter email;
  // "confirm" = enter code + new password.
  const [resetStep, setResetStep] = useState<null | "request" | "confirm">(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<{ text: string; error: boolean } | null>(null);

  const isPending = createUser.isPending || loginUser.isPending;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResendCooldown((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const toCurrentUser = useCallback(
    (user: {
      id: number;
      username: string;
      nickname?: string | null;
      avatarUrl?: string | null;
      email?: string | null;
      emailVerified?: boolean;
      avatarColor: string;
      defaultVisibility?: Visibility;
      createdAt?: string | Date;
    }): CurrentUser => ({
      id: user.id,
      username: user.username,
      nickname: user.nickname ?? null,
      avatarUrl: user.avatarUrl ?? null,
      email: user.email ?? null,
      emailVerified: user.emailVerified ?? false,
      avatarColor: user.avatarColor,
      defaultVisibility: user.defaultVisibility ?? "public",
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    }),
    [],
  );

  const persistCredentials = useCallback(async (id: number, token?: string) => {
    await AsyncStorage.setItem(USER_ID_KEY, String(id));
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    }
  }, []);

  const persistAndComplete = useCallback(
    async (user: Parameters<typeof toCurrentUser>[0] & { token?: string }) => {
      await persistCredentials(user.id, user.token);
      onComplete(toCurrentUser(user));
    },
    [onComplete, toCurrentUser, persistCredentials],
  );

  // Signup already triggers a best-effort verification email on the server.
  // Keep the credentials so the user can verify without leaving this gate.
  const startVerificationStep = useCallback(
    async (user: Parameters<typeof toCurrentUser>[0] & { token?: string }) => {
      await persistCredentials(user.id, user.token);
      const current = toCurrentUser(user);
      setPendingUser(current);
      setVerifyMessage({
        text: "Enter the 6-digit code sent to your email. If it doesn't arrive, resend it below.",
        error: false,
      });
    },
    [persistCredentials, toCurrentUser],
  );

  const handleVerifyCode = useCallback(() => {
    if (!pendingUser) return;
    const code = verifyCode.trim();
    if (code.length !== 6) {
      setVerifyMessage({ text: "Enter the 6-digit code from the email.", error: true });
      return;
    }
    setVerifyMessage(null);
    confirmVerification.mutate(
      { userId: pendingUser.id, data: { code } },
      {
        onSuccess: () => {
          onComplete({ ...pendingUser, emailVerified: true });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 400) {
            const errorText = (err.data as { error?: string } | null)?.error ?? "";
            setVerifyMessage({
              text: errorText.toLowerCase().includes("expired")
                ? "That code has expired. Resend a new code and try again."
                : "That code is incorrect. Check it and try again.",
              error: true,
            });
          } else {
            setVerifyMessage({ text: "Something went wrong. Please try again.", error: true });
          }
        },
      },
    );
  }, [pendingUser, verifyCode, confirmVerification, onComplete]);

  const handleResend = useCallback(() => {
    if (!pendingUser || resendCooldown > 0) return;
    setVerifyMessage(null);
    sendVerification.mutate(
      { userId: pendingUser.id },
      {
        onSuccess: () => {
          setResendCooldown(60);
          setVerifyMessage({ text: "Verification email sent. Check your inbox.", error: false });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 429) {
            setResendCooldown(60);
            setVerifyMessage({ text: "Email sent recently — try again in a minute.", error: true });
          } else {
            setVerifyMessage({
              text: "Could not send the email right now. Try again later.",
              error: true,
            });
          }
        },
      },
    );
  }, [pendingUser, resendCooldown, sendVerification]);

  const handleRequestReset = useCallback(() => {
    const trimmedEmail = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setResetMessage({ text: "Please enter a valid email address.", error: true });
      return;
    }
    setResetMessage(null);
    requestReset.mutate(
      { data: { email: trimmedEmail } },
      {
        onSuccess: () => {
          setResetStep("confirm");
          setResetMessage({
            text: "If that email is registered and verified, we've sent a 6-digit code.",
            error: false,
          });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 429) {
            setResetMessage({ text: "Reset email sent recently — try again in a minute.", error: true });
          } else if (err instanceof ApiError && err.status === 502) {
            setResetMessage({ text: "Couldn't send the email right now. Please try again.", error: true });
          } else {
            setResetMessage({ text: "Something went wrong. Please try again.", error: true });
          }
        },
      },
    );
  }, [resetEmail, requestReset]);

  const handleConfirmReset = useCallback(() => {
    const trimmedEmail = resetEmail.trim().toLowerCase();
    const code = resetCode.trim();
    if (code.length !== 6) {
      setResetMessage({ text: "Enter the 6-digit code from the email.", error: true });
      return;
    }
    if (resetNewPassword.length < 8) {
      setResetMessage({ text: "New password must be at least 8 characters.", error: true });
      return;
    }
    setResetMessage(null);
    confirmReset.mutate(
      { data: { email: trimmedEmail, code, newPassword: resetNewPassword } },
      {
        onSuccess: (user) => {
          void persistAndComplete(user as Parameters<typeof persistAndComplete>[0]);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 400) {
            setResetMessage({ text: "That code is incorrect or has expired. Request a new one.", error: true });
          } else {
            setResetMessage({ text: "Something went wrong. Please try again.", error: true });
          }
        },
      },
    );
  }, [resetEmail, resetCode, resetNewPassword, confirmReset, persistAndComplete]);

  const handleSubmit = useCallback(async () => {
    const trimmed = username.trim();
    if (mode === "signup") {
      if (trimmed.length < 2) {
        setError("Username must be at least 2 characters");
        return;
      }
      if (trimmed.length > 30) {
        setError("Username must be 30 characters or fewer");
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
        setError("Only letters, numbers, and underscores (_) are allowed");
        return;
      }
    } else {
      if (trimmed.length === 0) {
        setError("Please enter your username or email");
        return;
      }
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (mode === "signup") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError("Please enter a valid email address");
        return;
      }
      if (nickname.trim().length > 30) {
        setError("Nickname must be 30 characters or fewer");
        return;
      }
    }
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (mode === "login" && password.length === 0) {
      setError("Please enter your password");
      return;
    }
    setError("");

    const onError = (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          const body = JSON.stringify(err.data ?? "");
          setError(
            body.includes("Email")
              ? "That email is already in use. Want to log in instead?"
              : "That username is already taken. Want to log in instead?",
          );
          return;
        }
        if (err.status === 401) {
          setError("Incorrect username or password");
          return;
        }
      }
      setError("Something went wrong. Please try again in a moment.");
    };
    const onSuccess = (user: Parameters<typeof persistAndComplete>[0]) => {
      void persistAndComplete(user);
    };

    if (mode === "signup") {
      const trimmedNickname = nickname.trim();
      createUser.mutate(
        {
          data: {
            username: trimmed,
            email: trimmedEmail,
            ...(trimmedNickname ? { nickname: trimmedNickname } : {}),
            password,
          },
        },
        {
          onSuccess: (user) => {
            void startVerificationStep(user);
          },
          onError,
        },
      );
    } else {
      loginUser.mutate(
        { data: { identifier: trimmed, password } },
        {
          onSuccess: async (user) => {
            if (!user.emailVerified && user.email) {
              await persistCredentials(user.id, user.token);
              setPendingUser(toCurrentUser(user));
              setVerifyMessage({
                text: "Enter the 6-digit code sent to your email. If it doesn't arrive, resend it below.",
                error: false,
              });
              return;
            }
            onSuccess(user);
          },
          onError,
        },
      );
    }
  }, [username, email, nickname, password, mode, createUser, loginUser, persistAndComplete, startVerificationStep, persistCredentials, toCurrentUser]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  if (resetStep === "request") {
    return (
      <KeyboardAwareScrollViewCompat
        style={[styles.onboardingContainer, { backgroundColor: colors.background }]}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
        bottomOffset={72}
      >
        <View style={[styles.onboardingContent, { paddingTop: topInset + 40 }]}>
          <View style={[styles.onboardingIcon, { backgroundColor: colors.primary }]}>
            <Text style={styles.onboardingIconText}>S</Text>
          </View>
          <Text style={[styles.onboardingTitle, { color: colors.foreground }]}>
            Reset password
          </Text>
          <Text style={[styles.onboardingSubtitle, { color: colors.mutedForeground }]}>
            Enter your account email and we'll send you a reset code.
          </Text>

          <View style={styles.onboardingForm}>
            <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>Email</Text>
            <TextInput
              style={[
                styles.onboardingInput,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: resetMessage?.error ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              value={resetEmail}
              onChangeText={(t) => { setResetEmail(t); setResetMessage(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={handleRequestReset}
            />
            {resetMessage ? (
              <Text
                style={[
                  styles.onboardingError,
                  { color: resetMessage.error ? colors.destructive : colors.primary },
                ]}
              >
                {resetMessage.text}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.onboardingButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed || requestReset.isPending ? 0.8 : 1,
                },
              ]}
              onPress={handleRequestReset}
              disabled={requestReset.isPending}
            >
              {requestReset.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.onboardingButtonText, { color: colors.primaryForeground }]}>
                  Send reset code
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.modeToggle}
              onPress={() => { setResetStep(null); setResetMessage(null); }}
            >
              <Text style={[styles.modeToggleText, { color: colors.mutedForeground }]}>
                Back to log in
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    );
  }

  if (resetStep === "confirm") {
    return (
      <KeyboardAwareScrollViewCompat
        style={[styles.onboardingContainer, { backgroundColor: colors.background }]}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
        bottomOffset={72}
      >
        <View style={[styles.onboardingContent, { paddingTop: topInset + 40 }]}>
          <View style={[styles.onboardingIcon, { backgroundColor: colors.primary }]}>
            <Text style={styles.onboardingIconText}>S</Text>
          </View>
          <Text style={[styles.onboardingTitle, { color: colors.foreground }]}>
            Check your email
          </Text>
          <Text style={[styles.onboardingSubtitle, { color: colors.mutedForeground }]}>
            Enter the 6-digit code we sent to{"\n"}
            {resetEmail || "your email"}, then choose a new password.
          </Text>

          <View style={styles.onboardingForm}>
            <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
              Reset code
            </Text>
            <TextInput
              style={[
                styles.onboardingInput,
                styles.codeInput,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: resetMessage?.error ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              value={resetCode}
              onChangeText={(t) => {
                setResetCode(t.replace(/[^0-9]/g, "").slice(0, 6));
                setResetMessage(null);
              }}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="next"
            />

            <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
              New password
            </Text>
            <TextInput
              style={[
                styles.onboardingInput,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: resetMessage?.error ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.mutedForeground}
              value={resetNewPassword}
              onChangeText={(t) => { setResetNewPassword(t); setResetMessage(null); }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleConfirmReset}
            />
            {resetMessage ? (
              <Text
                style={[
                  styles.onboardingError,
                  { color: resetMessage.error ? colors.destructive : colors.primary },
                ]}
              >
                {resetMessage.text}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.onboardingButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed || confirmReset.isPending ? 0.8 : 1,
                },
              ]}
              onPress={handleConfirmReset}
              disabled={confirmReset.isPending}
            >
              {confirmReset.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.onboardingButtonText, { color: colors.primaryForeground }]}>
                  Reset password
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.modeToggle}
              onPress={() => { setResetStep("request"); setResetMessage(null); setResetCode(""); setResetNewPassword(""); }}
            >
              <Text style={[styles.modeToggleText, { color: colors.primary }]}>
                Resend code
              </Text>
            </Pressable>

            <Pressable
              style={styles.modeToggle}
              onPress={() => { setResetStep(null); setResetMessage(null); }}
            >
              <Text style={[styles.modeToggleText, { color: colors.mutedForeground }]}>
                Back to log in
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    );
  }

  if (pendingUser) {
    return (
      <KeyboardAwareScrollViewCompat
        style={[styles.onboardingContainer, { backgroundColor: colors.background }]}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
        bottomOffset={72}
      >
        <View style={[styles.onboardingContent, { paddingTop: topInset + 40 }]}>
          <View style={[styles.onboardingIcon, { backgroundColor: colors.primary }]}>
            <Text style={styles.onboardingIconText}>S</Text>
          </View>
          <Text style={[styles.onboardingTitle, { color: colors.foreground }]}>
            Check your email
          </Text>
          <Text style={[styles.onboardingSubtitle, { color: colors.mutedForeground }]}>
            We sent a 6-digit verification code to{"\n"}
            {pendingUser.email ?? "your email"}
          </Text>

          <View style={styles.onboardingForm}>
            <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
              Verification code
            </Text>
            <TextInput
              style={[
                styles.onboardingInput,
                styles.codeInput,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: verifyMessage?.error ? colors.destructive : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              value={verifyCode}
              onChangeText={(t) => {
                setVerifyCode(t.replace(/[^0-9]/g, "").slice(0, 6));
                setVerifyMessage(null);
              }}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleVerifyCode}
            />
            {verifyMessage ? (
              <Text
                style={[
                  styles.onboardingError,
                  { color: verifyMessage.error ? colors.destructive : colors.primary },
                ]}
              >
                {verifyMessage.text}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.onboardingButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed || confirmVerification.isPending ? 0.8 : 1,
                },
              ]}
              onPress={handleVerifyCode}
              disabled={confirmVerification.isPending}
            >
              {confirmVerification.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.onboardingButtonText, { color: colors.primaryForeground }]}>
                  Verify email
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.modeToggle}
              onPress={handleResend}
              disabled={sendVerification.isPending || resendCooldown > 0}
            >
              <Text
                style={[
                  styles.modeToggleText,
                  {
                    color: colors.primary,
                    opacity: sendVerification.isPending || resendCooldown > 0 ? 0.5 : 1,
                  },
                ]}
              >
                {sendVerification.isPending
                  ? "Sending..."
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend code"}
              </Text>
            </Pressable>

            <Pressable style={styles.modeToggle} onPress={() => void onLogout()}>
              <Text style={[styles.modeToggleText, { color: colors.mutedForeground }]}>
                Log out
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    );
  }

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.onboardingContainer, { backgroundColor: colors.background }]}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
      bottomOffset={72}
    >
      <View style={[styles.onboardingContent, { paddingTop: topInset + 40 }]}>
        <View style={[styles.onboardingIcon, { backgroundColor: colors.primary }]}>
          <Text style={styles.onboardingIconText}>S</Text>
        </View>
        <Text style={[styles.onboardingTitle, { color: colors.foreground }]}>
          Shelfmates
        </Text>
        <Text style={[styles.onboardingSubtitle, { color: colors.mutedForeground }]}>
          Read together. Discover what other readers thought about the passages that moved them.
        </Text>

        <View style={styles.onboardingForm}>
          <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
            {mode === "login" ? "Username or email" : "Username"}
          </Text>
          <TextInput
            style={[
              styles.onboardingInput,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: error ? colors.destructive : colors.border,
                borderRadius: colors.radius,
              },
            ]}
            placeholder={mode === "login" ? "Username or email" : "e.g. bookworm42"}
            placeholderTextColor={colors.mutedForeground}
            value={username}
            onChangeText={(t) => { setUsername(t); setError(""); }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={mode === "login" ? "email-address" : "default"}
            returnKeyType="next"
          />

          {mode === "signup" ? (
            <>
              <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
                Email
              </Text>
              <TextInput
                style={[
                  styles.onboardingInput,
                  {
                    backgroundColor: colors.card,
                    color: colors.foreground,
                    borderColor: error ? colors.destructive : colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />

              <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
                Nickname (optional)
              </Text>
              <TextInput
                style={[
                  styles.onboardingInput,
                  {
                    backgroundColor: colors.card,
                    color: colors.foreground,
                    borderColor: error ? colors.destructive : colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                placeholder="How your name appears to others"
                placeholderTextColor={colors.mutedForeground}
                value={nickname}
                onChangeText={(t) => { setNickname(t); setError(""); }}
                autoCorrect={false}
                returnKeyType="next"
              />
            </>
          ) : null}

          <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
            Password
          </Text>
          <TextInput
            style={[
              styles.onboardingInput,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: error ? colors.destructive : colors.border,
                borderRadius: colors.radius,
              },
            ]}
            placeholder={mode === "signup" ? "At least 8 characters" : "Password"}
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(""); }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          {error ? (
            <Text style={[styles.onboardingError, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.onboardingButton,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed || isPending ? 0.8 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={isPending}
          >
            {isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.onboardingButtonText, { color: colors.primaryForeground }]}>
                {mode === "signup" ? "Sign up and start reading" : "Log in"}
              </Text>
            )}
          </Pressable>

          <Pressable
            style={styles.modeToggle}
            onPress={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setError("");
            }}
          >
            <Text style={[styles.modeToggleText, { color: colors.mutedForeground }]}>
              {mode === "signup"
                ? "Already have an account? Log in"
                : "Don't have an account? Sign up"}
            </Text>
          </Pressable>

          {mode === "login" ? (
            <Pressable
              style={styles.modeToggle}
              onPress={() => {
                setResetStep("request");
                setResetMessage(null);
                setResetEmail("");
                setResetCode("");
                setResetNewPassword("");
              }}
            >
              <Text style={[styles.modeToggleText, { color: colors.mutedForeground }]}>
                Forgot password?
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<CurrentUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(USER_ID_KEY).then(async (storedId) => {
      if (storedId) {
        try {
          const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
          const headers: Record<string, string> = {};
          if (storedToken) headers["Authorization"] = `Bearer ${storedToken}`;
          const res = await fetch(apiUrl(`/api/users/${storedId}`), { headers });
          if (res.ok) {
            const data = await res.json();
            setUserState({
              id: data.id,
              username: data.username,
              nickname: data.nickname ?? null,
              avatarUrl: data.avatarUrl ?? null,
              email: data.email ?? null,
              emailVerified: data.emailVerified ?? false,
              avatarColor: data.avatarColor,
              defaultVisibility: data.defaultVisibility ?? "public",
              createdAt: data.createdAt ?? null,
            });
          } else if (res.status === 401) {
            // Expired/invalid token — clear stored credentials and show login.
            await AsyncStorage.multiRemove([USER_ID_KEY, TOKEN_KEY, PUSH_TOKEN_KEY]);
          }
        } catch {
          // ignore fetch errors, show onboarding
        }
      }
      setIsInitialized(true);
    });
  }, []);

  const setUser = useCallback((u: CurrentUser) => {
    setUserState(u);
  }, []);

  const logout = useCallback(async () => {
    // Unregister this device's push token first (best-effort) so the
    // logged-out account stops receiving pushes on this device.
    try {
      const [pushToken, authToken] = await Promise.all([
        takeRememberedPushToken(),
        AsyncStorage.getItem(TOKEN_KEY),
      ]);
      if (user && pushToken && authToken) {
        await fetch(apiUrl(`/api/users/${user.id}/push-tokens`), {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ token: pushToken }),
        });
      }
    } catch {
      // Best-effort: the server also prunes dead tokens on push failures,
      // and re-registration under another account reassigns the token.
    }
    setUserState(null);
    try {
      await AsyncStorage.multiRemove([USER_ID_KEY, TOKEN_KEY, PUSH_TOKEN_KEY]);
    } catch {
      // Try clearing each key independently if the batched operation fails.
      const removalResults = await Promise.allSettled(
        [USER_ID_KEY, TOKEN_KEY, PUSH_TOKEN_KEY].map((key) => AsyncStorage.removeItem(key)),
      );
      if (removalResults.some((result) => result.status === "rejected")) {
        throw new Error("Could not clear all local sign-in data.");
      }
    }
  }, [user]);

  if (!isInitialized) {
    return null;
  }

  if (!user || (user.email && !user.emailVerified)) {
    return (
      <AuthScreen
        onComplete={setUser}
        initialPendingUser={user}
        onLogout={logout}
      />
    );
  }

  return (
    <UserContext.Provider value={{ user, isInitialized, setUser, logout }}>
      {children}
    </UserContext.Provider>
  );
}

const styles = StyleSheet.create({
  onboardingContainer: {
    flex: 1,
  },
  onboardingContent: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  onboardingIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  onboardingIconText: {
    fontSize: 40,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  onboardingTitle: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  onboardingSubtitle: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 48,
  },
  onboardingForm: {
    width: "100%",
    gap: 12,
  },
  onboardingLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  onboardingInput: {
    height: 52,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  codeInput: {
    textAlign: "center",
    fontSize: 22,
    letterSpacing: 8,
    fontWeight: "700",
  },
  onboardingError: {
    fontSize: 13,
    marginTop: -4,
  },
  onboardingButton: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  onboardingButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  modeToggle: {
    alignItems: "center",
    paddingVertical: 12,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
