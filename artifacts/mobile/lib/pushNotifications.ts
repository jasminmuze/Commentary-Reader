import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

export const PUSH_TOKEN_KEY = "bookmarks_push_token";

/**
 * Remote push is only available in a real dev/EAS build on a physical
 * device — not on web and not in Expo Go (SDK 53+ removed remote push there).
 */
export function isPushSupported(): boolean {
  if (Platform.OS === "web") return false;
  if (Constants.appOwnership === "expo") return false;
  if (Constants.executionEnvironment === "storeClient") return false;
  return true;
}

/**
 * Requests notification permission and returns the device's Expo push token,
 * or null when unsupported (web / Expo Go / simulator) or permission denied.
 * Also sets up the Android notification channel and a foreground handler.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!isPushSupported()) return null;

  // Dynamic imports keep the native module out of web/Expo Go code paths.
  const Device = await import("expo-device");
  if (!Device.isDevice) return null;

  const Notifications = await import("expo-notifications");

  // Show banners even while the app is foregrounded.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "알림",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenResponse.data;
}

/** Persists the registered token so a future logout can unregister it. */
export async function rememberPushToken(token: string): Promise<void> {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
}

/** Returns the locally remembered push token (if any) and forgets it. */
export async function takeRememberedPushToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (token) await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  return token;
}
