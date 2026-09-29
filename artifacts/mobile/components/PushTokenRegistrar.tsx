import { useEffect, useRef } from "react";
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
    if (registeredForUserId.current === user.id) return;
    registeredForUserId.current = user.id;

    let cancelled = false;
    (async () => {
      try {
        const token = await registerForPushNotificationsAsync();
        if (!token || cancelled) return;
        await registerPushToken.mutateAsync({
          userId: user.id,
          data: { token },
        });
        await rememberPushToken(token);
      } catch {
        // Best-effort: allow a retry on next login if registration failed.
        if (registeredForUserId.current === user.id) {
          registeredForUserId.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return null;
}
