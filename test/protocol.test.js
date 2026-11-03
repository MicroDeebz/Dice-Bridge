import test from "node:test";
import assert from "node:assert/strict";

import {
  MSG,
  PROTOCOL_VERSION,
  createAck,
  createRoll,
  isAppOrigin,
  normalizeOrigin,
  readBridgeMessage,
} from "../src/shared/protocol.js";

test("accepts a well-formed roll", () => {
  const message = readBridgeMessage(createRoll({ notation: "1d20+5", sender: "Sheet", requestId: "abc" }));
  assert.deepEqual(message, { type: MSG.ROLL, notation: "1d20+5", sender: "Sheet", requestId: "abc" });
});

test("rejects malformed or hostile messages", () => {
  const valid = createRoll({ notation: "1d20", sender: "x", requestId: "abc" });
  const cases = [
    null,
    "roll 1d20",
    [],
    { ...valid, v: 2 },
    { ...valid, type: "dice-bridge/eval" },
    { ...valid, notation: "" },
    { ...valid, notation: 5 },
    { ...valid, notation: "1".repeat(200) },
    { ...valid, requestId: "" },
    { ...valid, requestId: 7 },
  ];
  for (const candidate of cases) {
    assert.equal(readBridgeMessage(candidate), null, `accepted ${JSON.stringify(candidate)}`);
  }
});

test("normalizes acks to a boolean and safe detail", () => {
  const ack = readBridgeMessage({ v: PROTOCOL_VERSION, type: MSG.ACK, requestId: "r1", ok: "yes", detail: "x".repeat(500) });
  assert.equal(ack.ok, false);
  assert.equal(ack.detail.length, 200);
  assert.equal(createAck({ requestId: "r1", ok: true }).ok, true);
});

test("only trusts Owlbear Rodeo and loopback origins", () => {
  assert.equal(isAppOrigin("https://owlbear.rodeo"), true);
  assert.equal(isAppOrigin("https://beta.owlbear.rodeo"), true);
  assert.equal(isAppOrigin("http://localhost:5173"), true);
  assert.equal(isAppOrigin("https://evil.example"), false);
  assert.equal(isAppOrigin("https://owlbear.rodeo.evil.example"), false);
  assert.equal(isAppOrigin(""), false);
});

test("normalizes companion origins", () => {
  assert.equal(normalizeOrigin("https://dice.example.com/path"), "https://dice.example.com");
  assert.equal(normalizeOrigin("  http://localhost:8788/  "), "http://localhost:8788");
  assert.equal(normalizeOrigin("not a url"), "");
});
