import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLibraryPreferences,
  normalizeLibraryPreferences,
  parseStoredLibraryPreferences
} from "../src/utils/library-preferences";

test("library preferences accept valid display settings", () => {
  assert.deepEqual(
    normalizeLibraryPreferences({ showAchievements: false, showTags: true, columns: 6, clean: true }),
    { showAchievements: false, showTags: true, columns: 6, clean: true }
  );
});

test("library preferences reject invalid or polluted values", () => {
  assert.deepEqual(
    normalizeLibraryPreferences({ showAchievements: "no", showTags: 1, columns: 99, clean: null }),
    defaultLibraryPreferences
  );
  assert.deepEqual(parseStoredLibraryPreferences("not-json"), defaultLibraryPreferences);
  assert.deepEqual(parseStoredLibraryPreferences(null), defaultLibraryPreferences);
});

test("library preferences preserve valid fields while defaulting missing fields", () => {
  assert.deepEqual(parseStoredLibraryPreferences('{"columns":4,"showTags":false}'), {
    showAchievements: true,
    showTags: false,
    columns: 4,
    clean: false
  });
});
