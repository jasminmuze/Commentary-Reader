import assert from "node:assert/strict";
import test from "node:test";
import {
  isGeneratedAvatarObjectPath,
  isGeneratedEpubObjectPath,
} from "./objectStoragePaths.ts";

const generatedId = "123e4567-e89b-42d3-a456-426614174000";

test("generated EPUB paths require a canonical UUIDv4 filename", () => {
  assert.equal(isGeneratedEpubObjectPath(`/objects/uploads/${generatedId}.epub`), true);
  assert.equal(isGeneratedEpubObjectPath(`/objects/uploads/${generatedId}.epub/extra`), false);
  assert.equal(isGeneratedEpubObjectPath("/objects/uploads/123e4567-e89b-12d3-a456-426614174000.epub"), false);
});

test("generated avatar paths require a canonical UUIDv4 filename", () => {
  assert.equal(isGeneratedAvatarObjectPath(`/public-objects/avatars/${generatedId}`), true);
  assert.equal(isGeneratedAvatarObjectPath(`/public-objects/avatars/${generatedId}.png`), false);
  assert.equal(isGeneratedAvatarObjectPath("/public-objects/avatars/123e4567-e89b-42d3-7456-426614174000"), false);
});