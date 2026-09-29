import { accountRequestLockPool } from "@workspace/db";
import {
  acquireAccountRequestLocksWithConnector,
  type AdvisoryLockClient,
  type AccountLockMode,
} from "./accountLockProtocol.js";

export {
  accountRequestLockPlan,
  releaseAccountRequestLocksOnResponse,
} from "./accountLockProtocol.js";

export function acquireAccountRequestLocks(
  userId: number,
  mode: AccountLockMode,
): Promise<() => Promise<void>> {
  return acquireAccountRequestLocksWithConnector(
    userId,
    mode,
    () =>
      accountRequestLockPool.connect() as unknown as Promise<AdvisoryLockClient>,
  );
}