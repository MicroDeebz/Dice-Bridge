import test from "node:test";
import assert from "node:assert/strict";

import { parse, extractNotation } from "../src/shared/dice.js";

test("parses plain and modified dice", () => {
  assert.deepEqual(
    pick(parse("1d20")),
    { notation: "1d20", min: 1, max: 20, dice: 1 },
  );
  assert.deepEqual(
    pick(parse("2d20kh1+5")),
    { notation: "2d20kh1+5", min: 6, max: 25, dice: 2 },
  );
  assert.deepEqual(
    pick(parse("4d6dl1")),
    { notation: "4d6dl1", min: 3, max: 18, dice: 4 },
  );
  assert.deepEqual(
    pick(parse("1d8+1d6+3")),
    { notation: "1d8+1d6+3", min: 5, max: 17, dice: 2 },
  );
});

test("normalizes whitespace, case and shorthand", () => {
  assert.equal(parse("2D6 + 3").notation, "2d6+3");
  assert.equal(parse("  d20  ").notation, "1d20");
  assert.equal(parse("1d20\u22125").notation, "1d20-5");
  assert.equal(parse("/roll 1d20+5").notation, "1d20+5");
  assert.equal(parse("/r 3d6").notation, "3d6");
  assert.equal(parse("roll a d20.").notation, "1d20");
});

test("expands advantage and disadvantage phrases", () => {
  assert.equal(parse("1d20 with advantage").notation, "2d20kh1");
  assert.equal(parse("2d20 disadvantage").notation, "2d20kl1");
  assert.equal(parse("1d20+5 adv").notation, "2d20kh1+5");
});

test("keeps reroll and exploding modifiers", () => {
  assert.equal(parse("10d10ro<2+3").notation, "10d10ro<2+3");
  assert.equal(parse("1d6!").notation, "1d6!");
  assert.equal(parse("1d6!").max, null);
  assert.equal(parse("3d6!+2").max, null);
});

test("rejects inputs it cannot hand to Rumble", () => {
  for (const bad of ["", "   ", "hello", "2d", "0d6", "101d6", "1d1", "1d20*2", "1d20kh2", "20", null, 42]) {
    const result = parse(bad);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.equal(typeof result.error, "string");
  }
});

test("enforces length limits", () => {
  const long = `${"1d6+".repeat(40)}1d6`;
  assert.equal(parse(long).ok, false);
});

test("extracts notation out of prose", () => {
  assert.equal(extractNotation("Fireball: 8d6 fire damage").notation, "8d6");
  assert.equal(extractNotation("I rolled 1d20 + 5 on the table").notation, "1d20+5");
  assert.equal(extractNotation("please roll 2d20kh1 for me").notation, "2d20kh1");
  assert.equal(extractNotation("no dice here").ok, false);
});

function pick(result) {
  assert.equal(result.ok, true, result.error);
  const { notation, min, max, dice } = result;
  return { notation, min, max, dice };
}
