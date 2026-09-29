import { asc, eq, lte } from "drizzle-orm";
import { accountObjectCleanupJobsTable, db } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage.js";
import { logger } from "./logger.js";

const CLEANUP_BATCH_SIZE = 20;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

function describeFailures(failures: unknown[]): string {
  return failures
    .map((failure) => (failure instanceof Error ? failure.message : String(failure)))
    .join("; ")
    .slice(0, 2000);
}

async function runJob(job: typeof accountObjectCleanupJobsTable.$inferSelect): Promise<void> {
  try {
    const failures = await new ObjectStorageService().deleteOwnedObjects(job.objectPaths);
    if (failures.length) {
      throw new Error(describeFailures(failures));
    }
    await db
      .delete(accountObjectCleanupJobsTable)
      .where(eq(accountObjectCleanupJobsTable.id, job.id));
  } catch (err) {
    const attemptCount = job.attemptCount + 1;
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      30_000 * 2 ** Math.min(attemptCount - 1, 10),
    );
    try {
      await db
        .update(accountObjectCleanupJobsTable)
        .set({
          attemptCount,
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
        })
        .where(eq(accountObjectCleanupJobsTable.id, job.id));
    } catch (updateErr) {
      logger.error(
        { err: updateErr, jobId: job.id },
        "Could not persist object-cleanup retry schedule",
      );
    }
    logger.error(
      { err, jobId: job.id, attemptCount },
      "Account object cleanup failed; durable retry retained",
    );
  }
}

export async function processAccountObjectCleanupJob(jobId: number): Promise<boolean> {
  const [job] = await db
    .select()
    .from(accountObjectCleanupJobsTable)
    .where(eq(accountObjectCleanupJobsTable.id, jobId))
    .limit(1);
  if (job) await runJob(job);
  const [remaining] = await db
    .select({ id: accountObjectCleanupJobsTable.id })
    .from(accountObjectCleanupJobsTable)
    .where(eq(accountObjectCleanupJobsTable.id, jobId))
    .limit(1);
  return Boolean(remaining);
}

export async function processPendingAccountObjectCleanupJobs(): Promise<void> {
  try {
    const jobs = await db
      .select()
      .from(accountObjectCleanupJobsTable)
      .where(lte(accountObjectCleanupJobsTable.nextAttemptAt, new Date()))
      .orderBy(asc(accountObjectCleanupJobsTable.id))
      .limit(CLEANUP_BATCH_SIZE);
    for (const job of jobs) await runJob(job);
  } catch (err) {
    logger.error({ err }, "Could not scan pending account object-cleanup jobs");
  }
}

export function startAccountObjectCleanupWorker(): void {
  const timer = setInterval(() => {
    void processPendingAccountObjectCleanupJobs();
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
  void processPendingAccountObjectCleanupJobs();
}