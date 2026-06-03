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
import { useCreateUser } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

const USER_ID_KEY = "bookmarks_user_id";

interface CurrentUser {
  id: number;
  username: string;
  avatarColor: string;
}

interface UserContextType {
  user: CurrentUser | null;
  isInitialized: boolean;
  setUser: (user: CurrentUser) => void;
}

const UserContext = createContext<UserContextType>({
  user: null,
  isInitialized: false,
  setUser: () => {},
});

export function useUser() {
  return useContext(UserContext);
}

function OnboardingScreen({ onComplete }: { onComplete: (user: CurrentUser) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const createUser = useCreateUser();

  const handleSubmit = useCallback(async () => {
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setError("Username must be at least 2 characters");
      return;
    }
    if (trimmed.length > 30) {
      setError("Username must be 30 characters or less");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setError("Only letters, numbers, and underscores allowed");
      return;
    }
    setError("");

    createUser.mutate(
      { data: { username: trimmed } },
      {
        onSuccess: async (user) => {
          await AsyncStorage.setItem(USER_ID_KEY, String(user.id));
          onComplete({ id: user.id, username: user.username, avatarColor: user.avatarColor });
        },
        onError: () => {
          setError("Something went wrong. Try a different username.");
        },
      }
    );
  }, [username, createUser, onComplete]);

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
          Read together. Discover what others think about the passages that moved them.
        </Text>

        <View style={styles.onboardingForm}>
          <Text style={[styles.onboardingLabel, { color: colors.mutedForeground }]}>
            Choose your username
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
            placeholder="e.g. bookworm42"
            placeholderTextColor={colors.mutedForeground}
            value={username}
            onChangeText={(t) => { setUsername(t); setError(""); }}
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
                opacity: pressed || createUser.isPending ? 0.8 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={createUser.isPending}
          >
            {createUser.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.onboardingButtonText, { color: colors.primaryForeground }]}>
                Start Reading
              </Text>
            )}
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
          const res = await fetch(`/api/users/${storedId}`);
          if (res.ok) {
            const data = await res.json();
            setUserState({ id: data.id, username: data.username, avatarColor: data.avatarColor });
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

  if (!isInitialized) {
    return null;
  }

  if (!user) {
    return <OnboardingScreen onComplete={setUser} />;
  }

  return (
    <UserContext.Provider value={{ user, isInitialized, setUser }}>
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
});
