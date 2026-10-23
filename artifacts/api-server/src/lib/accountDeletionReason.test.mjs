import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { DeleteUserAccountBody } from "@workspace/api-zod";
import { accountDeletionFeedbackTable } from "../../../../lib/db/src/schema/feedback.ts";

const validReasons = [
  "no_longer_use",
  "switched_apps",
  "privacy_concerns",
  "app_issues",
  "other",
];

test("account deletion rejects missing or invalid reasons", () => {
  assert.equal(DeleteUserAccountBody.safeParse({ password: "password" }).success, false);
  assert.equal(
    DeleteUserAccountBody.safeParse({ password: "password", reason: "custom_text" }).success,
    false,
  );
});

test("account deletion accepts only the fixed reason categories", () => {
  for (const reason of validReasons) {
    assert.deepEqual(
      DeleteUserAccountBody.safeParse({ password: "password", reason }).data,
      { password: "password", reason },
    );
  }
});

test("mobile and web deletion forms expose the same reason categories", async () => {
  const [mobileProfile, webTemplate] = await Promise.all([
    readFile(new URL("../../../mobile/app/(tabs)/profile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../mobile/server/templates/account-deletion.html", import.meta.url), "utf8"),
  ]);
  const reasonSection =
    mobileProfile.match(/const ACCOUNT_DELETION_REASONS:[\s\S]*?\n\];/)?.[0] ?? "";
  const mobileReasons = [...reasonSection.matchAll(/value: "([^"]+)"/g)].map((match) => match[1]);
  const webReasons = [...webTemplate.matchAll(/name="reason" value="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(mobileReasons, validReasons);
  assert.deepEqual(webReasons, validReasons);
});

test("stored deletion feedback contains only the reason category", () => {
  const { columns, foreignKeys } = getTableConfig(accountDeletionFeedbackTable);
  assert.deepEqual(columns.map((column) => column.name), ["reason"]);
  assert.equal(foreignKeys.length, 0);
});
