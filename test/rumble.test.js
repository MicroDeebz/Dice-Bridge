import test from "node:test";
import assert from "node:assert/strict";

import {
  RUMBLE_DICE_KEY,
  buildRumbleDiceMetadata,
  sanitizeSender,
} from "../src/shared/rumble.js";

test("builds the documented Rumble player-metadata payload", () => {
  const now = new Date("2026-11-03T12:00:00.000Z");
  const metadata = buildRumbleDiceMetadata({ notation: "2d20kh1", sender: "Chronicle", now });

  assert.deepEqual(metadata, {
    "com.battle-system.friends/metadata_diceroll": {
      notation: "2d20kh1",
      created: "2026-11-03T12:00:00.000Z",
      sender: "Chronicle",
    },
  });
  assert.ok(RUMBLE_DICE_KEY in metadata);
});

test("a repeated roll still produces a different value", () => {
  const first = buildRumbleDiceMetadata({ notation: "1d20", sender: "x", now: new Date(0) });
  const second = buildRumbleDiceMetadata({ notation: "1d20", sender: "x", now: new Date(1) });
  assert.notDeepEqual(first, second, "metadata must change or Owlbear swallows the repeat");
});

test("sanitizes the sender shown in Rumble chat", () => {
  assert.equal(sanitizeSender("<b>Bob</b>"), "Bob");
  assert.equal(sanitizeSender("line\nbreak"), "line break");
  assert.equal(sanitizeSender("   "), "Dice Bridge");
  assert.equal(sanitizeSender(undefined), "Dice Bridge");
  assert.equal(sanitizeSender("x".repeat(100)).length, 40);
});
