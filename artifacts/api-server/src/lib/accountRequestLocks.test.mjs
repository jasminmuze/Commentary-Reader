import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  accountRequestLockPlan,
  acquireAccountRequestLocksWithConnector,
  releaseAccountRequestLocksOnResponse,
} from "./accountLockProtocol.ts";

test("mutation lock plan acquires global then per-user shared locks", () => {
  const plan = accountRequestLockPlan(42, "shared");
  assert.equal(plan.length, 2);
  assert.equal(plan[0].mode, "shared");
  assert.equal(plan[1].mode, "shared");
  assert.equal(plan[1].key, 42);
  assert.ok(plan[0].namespace < plan[1].namespace);
});

test("request lock releases per-user then global and only once", async () => {
  const queries = [];
  let releases = 0;
  const fakeClient = {
    async query(statement, values) {
      queries.push({ statement, values });
      return { rows: statement.includes("unlock") ? [{ unlocked: true }] : [{}] };
    },
    release() {
      releases += 1;
    },
  };
  const release = await acquireAccountRequestLocksWithConnector(42, "shared", async () => fakeClient);
  await release();
  await release();

  assert.match(queries[0].statement, /pg_advisory_lock_shared/);
  assert.match(queries[1].statement, /pg_advisory_lock_shared/);
  assert.match(queries[2].statement, /pg_advisory_unlock_shared/);
  assert.match(queries[3].statement, /pg_advisory_unlock_shared/);
  assert.deepEqual(queries[2].values, queries[1].values);
  assert.deepEqual(queries[3].values, queries[0].values);
  assert.equal(releases, 1);
});

test("account deletion uses exclusive global and per-user locks", async () => {
  const queries = [];
  const fakeClient = {
    async query(statement, values) {
      queries.push({ statement, values });
      return { rows: statement.includes("unlock") ? [{ unlocked: true }] : [{}] };
    },
    release() {},
  };
  const release = await acquireAccountRequestLocksWithConnector(9, "exclusive", async () => fakeClient);
  assert.match(queries[0].statement, /pg_advisory_lock\(/);
  assert.match(queries[1].statement, /pg_advisory_lock\(/);
  assert.doesNotMatch(queries[0].statement, /lock_shared/);
  await release();
});

test("failed lock acquisition destroys the possibly locked session", async () => {
  let releaseError;
  const fakeClient = {
    async query(statement) {
      if (statement.includes("pg_advisory_lock(")) {
        throw new Error("simulated connection failure");
      }
      return { rows: [{}] };
    },
    release(err) {
      releaseError = err;
    },
  };
  await assert.rejects(
    acquireAccountRequestLocksWithConnector(9, "exclusive", async () => fakeClient),
    /simulated connection failure/,
  );
  assert.match(releaseError.message, /simulated connection failure/);
});

test("response close and finish release a request lock only once", () => {
  const response = new EventEmitter();
  let releases = 0;
  releaseAccountRequestLocksOnResponse(response, async () => {
    releases += 1;
  }, (err) => {
    throw err;
  });
  response.emit("close");
  response.emit("finish");
  assert.equal(releases, 1);
});