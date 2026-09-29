import type { Response } from "express";

const GLOBAL_LOCK_NAMESPACE = 1_397_249_094;
const USER_LOCK_NAMESPACE = 1_397_249_095;

export type AccountLockMode = "shared" | "exclusive";
export type AdvisoryLockClient = {
  query: (
    statement: string,
    values: number[],
  ) => Promise<{ rows: Array<{ unlocked?: boolean }> }>;
  release: (err?: Error) => void;
};

export function accountRequestLockPlan(
  userId: number,
  mode: AccountLockMode,
): Array<{ namespace: number; key: number; mode: AccountLockMode }> {
  // Every request takes the global gate before its account lock. The global
  // shared gate allows unrelated writers concurrently; deletion takes it
  // exclusively to also fence writes by other users that reference this user.
  return [
    { namespace: GLOBAL_LOCK_NAMESPACE, key: 0, mode },
    { namespace: USER_LOCK_NAMESPACE, key: userId, mode },
  ];
}

export async function acquireAccountRequestLocksWithConnector(
  userId: number,
  mode: AccountLockMode,
  connect: () => Promise<AdvisoryLockClient>,
): Promise<() => Promise<void>> {
  const client = await connect();
  const acquired: Array<{ namespace: number; key: number; mode: AccountLockMode }> = [];
  const plan = accountRequestLockPlan(userId, mode);
  const lockFunction =
    mode === "shared" ? "pg_advisory_lock_shared" : "pg_advisory_lock";
  const unlockFunction =
    mode === "shared" ? "pg_advisory_unlock_shared" : "pg_advisory_unlock";

  try {
    for (const lock of plan) {
      await client.query(
        `SELECT ${lockFunction}($1::integer, $2::integer)`,
        [lock.namespace, lock.key],
      );
      acquired.push(lock);
    }
  } catch (err) {
    // The last query may have acquired its lock even if the client lost the
    // server response. Destroy the session so PostgreSQL releases every lock
    // instead of risking returning a still-locked connection to the pool.
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      for (const lock of [...acquired].reverse()) {
        const unlocked = await client.query(
          `SELECT ${unlockFunction}($1::integer, $2::integer) AS unlocked`,
          [lock.namespace, lock.key],
        );
        if (unlocked.rows[0]?.unlocked !== true) {
          throw new Error("PostgreSQL advisory lock was not held by its session");
        }
      }
      client.release();
    } catch (err) {
      client.release(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };
}

export function releaseAccountRequestLocksOnResponse(
  res: Pick<Response, "once" | "destroyed" | "writableEnded">,
  release: () => Promise<void>,
  onError: (err: unknown) => void,
): boolean {
  let started = false;
  const releaseOnce = () => {
    if (started) return;
    started = true;
    void release().catch(onError);
  };
  if (res.destroyed || res.writableEnded) {
    releaseOnce();
    return false;
  }
  res.once("finish", releaseOnce);
  res.once("close", releaseOnce);
  return true;
}