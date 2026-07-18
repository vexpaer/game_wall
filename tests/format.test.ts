import assert from "node:assert/strict";
import test from "node:test";
import { formatActivityDate } from "../src/utils/format";

test("date-only activity never invents a local clock time", () => {
  const formatted = formatActivityDate("2026-07-18T00:00:00.000Z", "date", true);
  assert.match(formatted, /2026/u);
  assert.doesNotMatch(formatted, /\d{1,2}:\d{2}/u);
});
