import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
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
  setAuthTokenGetter,
  ApiError,
} from "@workspace/api-client-react";
import type { Visibility } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
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
  avatarColor: string;
  defaultVisibility: Visibility;
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

function AuthScreen({ onComplete }: { onComplete: (user: CurrentUser) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<AuthMode>("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const createUser = useCreateUser();
  const loginUser = useLoginUser();

  const isPending = createUser.isPending || loginUser.isPending;

  const persistAndComplete = useCallback(
    async (user: {
      id: number;
      username: string;
      avatarColor: string;
      defaultVisibility?: Visibility;
      token?: string;
    }) => {
      await AsyncStorage.setItem(USER_ID_KEY, String(user.id));
      if (user.token) {
        await AsyncStorage.setItem(TOKEN_KEY, user.token);
      }
      onComplete({
        id: user.id,
        username: user.username,
        avatarColor: user.avatarColor,
        defaultVisibility: user.defaultVisibility ?? "public",
      });
    },
    [onComplete],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setError("사용자 이름은 2자 이상이어야 해요");
      return;
    }
    if (trimmed.length > 30) {
      setError("사용자 이름은 30자 이하여야 해요");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setError("영문, 숫자, 밑줄(_)만 사용할 수 있어요");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요");
      return;
    }
    if (mode === "login" && password.length === 0) {
      setError("비밀번호를 입력해 주세요");
      return;
    }
    setError("");

    const mutation = mode === "signup" ? createUser : loginUser;
    mutation.mutate(
      { data: { username: trimmed, password } },
      {
        onSuccess: (user) => {
          void persistAndComplete(user);
        },
        onError: (err: unknown) => {
          if (err instanceof ApiError) {
            if (err.status === 409) {
              setError("이미 사용 중인 이름이에요. 로그인하시겠어요?");
              return;
            }
            if (err.status === 401) {
              setError("이름 또는 비밀번호가 올바르지 않아요");
              return;
            }
          }
          setError("문제가 발생했어요. 잠시 후 다시 시도해 주세요.");
        },
      },
    );
  }, [username, password, mode, createUser, loginUser, persistAndComplete]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <KeyboardAvoidingView
      style={[styles.onboardingContainer, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.onboardingContent, { paddingTop: topInset + 40 }]}>
        <View style={[styles.onboardingIcon, { backgroundColor: colors.primary }]}>
          <Text style={styles.onboardingIconText}>B</Text>
        </View>
        <Text style={[styles.onboardingTitle, { color: colors.foreground }]}>
          Bookmarks
        </Text>
        <Text style={[styles.onboardingSubtitle, { color: colors.mutedForeground }]}>
          함께 읽어요. 마음을 움직인 문장에 남긴 다른 독자들의 생각을 만나 보세요.
        </Text>

        <View style={styles.onboardingForm}>
          <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
            사용자 이름
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
            placeholder="예: bookworm42"
            placeholderTextColor={colors.mutedForeground}
            value={username}
            onChangeText={(t) => { setUsername(t); setError(""); }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
            비밀번호
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
            placeholder={mode === "signup" ? "8자 이상" : "비밀번호"}
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
                {mode === "signup" ? "가입하고 읽기 시작" : "로그인"}
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
                ? "이미 계정이 있나요? 로그인"
                : "계정이 없나요? 회원가입"}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
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
            setUserState({ id: data.id, username: data.username, avatarColor: data.avatarColor, defaultVisibility: data.defaultVisibility ?? "public" });
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
    await AsyncStorage.multiRemove([USER_ID_KEY, TOKEN_KEY, PUSH_TOKEN_KEY]);
    setUserState(null);
  }, [user]);

  if (!isInitialized) {
    return null;
  }

  if (!user) {
    return <AuthScreen onComplete={setUser} />;
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
    color: "#0E1117",
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
