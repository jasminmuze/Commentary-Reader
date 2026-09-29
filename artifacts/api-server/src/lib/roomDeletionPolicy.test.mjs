import assert from "node:assert/strict";
import test from "node:test";
import { getRoomDeletionDisposition } from "./roomDeletionPolicy.ts";

test("a sole-owner room without third-party content can be deleted", () => {
  assert.equal(
    getRoomDeletionDisposition({
      hasThirdPartyComments: false,
      hasThirdPartyHighlights: false,
    }),
    "delete",
  );
});

test("a sole-owner room with third-party comments is archived", () => {
  assert.equal(
    getRoomDeletionDisposition({
      hasThirdPartyComments: true,
      hasThirdPartyHighlights: false,
    }),
    "archive",
  );
});

test("a sole-owner room with third-party highlights is archived", () => {
  assert.equal(
    getRoomDeletionDisposition({
      hasThirdPartyComments: false,
      hasThirdPartyHighlights: true,
    }),
    "archive",
  );
});