import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useRegisterPushToken } from "@workspace/api-client-react";

import { useUser } from "@/context/UserContext";
import {
  isPushSupported,
  registerForPushNotificationsAsync,
  rememberPushToken,
} from "@/lib/pushNotifications";

/**
 * Invisible component that, once a user is logged in, asks for notification
 * permission, fetches the device's Expo push token, and registers it with the
 * server. No-ops on web / Expo Go / simulators. Best-effort: failures are
 * silent — pushes are a progressive enhancement over in-app notifications.
 */
export function PushTokenRegistrar() {
  const { user } = useUser();
  const registerPushToken = useRegisterPushToken();
  const registeredForUserId = useRef<number | null>(null);

  useEffect(() => {
    if (!user || !isPushSupported()) return;

    let cancelled = false;
    let registering = false;
    let retryAfter = 0;

    const registerToken = async () => {
      if (
        cancelled ||
        registering ||
        registeredForUserId.current === user.id ||
        Date.now() < retryAfter
      ) {
        return;
      }
      registering = true;
      retryAfter = Date.now() + 60_000;
      try {
        const token = await registerForPushNotificationsAsync();
        if (!token || cancelled) return;
        await registerPushToken.mutateAsync({
          userId: user.id,
          data: { token },
        });
        await rememberPushToken(token);
        registeredForUserId.current = user.id;
      } catch {
        // A later foreground retry can recover from transient network or
        // notification-service failures without requiring the user to log in
        // again. Never block the in-app notification feed on push delivery.
      } finally {
        registering = false;
      }
    };

    void registerToken();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerToken();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [user?.id, registerPushToken.mutateAsync]);

  return null;
}
