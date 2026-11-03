/**
 * Dice notation parsing for Dice Bridge.
 *
 * The extension never rolls anything locally: it validates and normalizes a
 * notation string and hands it to Rumble!, which owns the roll. That means the
 * parser's job is to be strict about what leaves the browser and generous about
 * how a human (or a character sheet) writes it.
 *
 * Supported grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := number | dice
 *   dice       := [count] 'd' sides modifier*
 *   modifier   := ('kh' | 'kl' | 'dh' | 'dl') count
 *               | ('r' | 'ro') [<|>|=] number
 *               | '!'
 *
 * Anything outside that grammar (multiplication, division, comparisons) is
 * rejected rather than passed through, because Rumble's parser is the only
 * thing that should interpret operator semantics.
 */

export const MAX_LENGTH = 120;
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
export const MIN_SIDES = 2;
export const MAX_TERM_VALUE = 9999;

const failure = (error) => ({ ok: false, error });

const ADVANTAGE = /\badv(?:antage)?\b/i;
const DISADVANTAGE = /\bdis(?:advantage)?\b/i;

const isDigit = (char) => char >= "0" && char <= "9";
const add = (a, b) => (a === null || b === null ? null : a + b);
const sub = (a, b) => (a === null || b === null ? null : a - b);

/** Remove the wrappers humans put around a roll ("/roll", quotes, trailing "."). */
function stripDecoration(raw) {
  let text = raw.trim();
  text = text.replace(/^\/(?:roll|r)\b\s*:?\s*/i, "");
  text = text.replace(/^roll(?:ing)?\b\s*:?\s*/i, "");
  text = text.replace(/^(?:a|an|the)\s+/i, "");
  text = text.replace(/^["'`\u201c\u201d\u2018\u2019\s]+/, "");
  text = text.replace(/["'`\u201c\u201d\u2018\u2019\s]+$/, "");
  text = text.replace(/[.,;:]+$/, "");
  return text;
}

/**
 * Turn "1d20+5 with advantage" into "2d20kh1+5". Only transforms a plain d20
 * expression; a phrase next to a complex expression is left for the parser to
 * reject so we never silently change someone's roll.
 */
function applyAdvantage(text) {
  const disadvantage = DISADVANTAGE.test(text);
  const advantage = !disadvantage && ADVANTAGE.test(text);
  if (!advantage && !disadvantage) return text;

  const withoutPhrase = text.replace(ADVANTAGE, " ").replace(DISADVANTAGE, " ");
  const match = withoutPhrase.match(/(\d*)d20(\s*[+-]\s*\d+)?/i);
  if (!match) return text;

  const modifier = (match[2] || "").replace(/\s+/g, "");
  return `2d20${disadvantage ? "kl" : "kh"}1${modifier}`;
}

function normalize(text) {
  return text
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00d7\u2715]/g, "*")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseTerm(source, start) {
  let index = start;
  let digits = "";
  while (index < source.length && isDigit(source[index])) {
    digits += source[index];
    index += 1;
  }

  if (source[index] !== "d") {
    if (!digits) {
      const found = source[index] ?? "end of input";
      return failure(`Unexpected “${found}” — expected dice like 1d20`);
    }
    const value = Number(digits);
    if (value > MAX_TERM_VALUE) return failure(`Modifier too large (max ${MAX_TERM_VALUE})`);
    return { ok: true, text: String(value), min: value, max: value, dice: 0, next: index };
  }

  index += 1; // consume "d"
  let sidesText = "";
  while (index < source.length && isDigit(source[index])) {
    sidesText += source[index];
    index += 1;
  }
  if (!sidesText) return failure("Missing die size — try 1d20");

  const count = digits === "" ? 1 : Number(digits);
  const sides = Number(sidesText);
  if (count < 1) return failure("Dice count must be at least 1");
  if (count > MAX_DICE) return failure(`Too many dice (max ${MAX_DICE})`);
  if (sides < MIN_SIDES) return failure(`d${sides} is not a die (minimum d${MIN_SIDES})`);
  if (sides > MAX_SIDES) return failure(`Die too large (max d${MAX_SIDES})`);

  let keep = null;
  let explode = false;
  let text = `${count}d${sides}`;

  while (index < source.length) {
    const rest = source.slice(index);

    const keepMatch = /^(kh|kl|dh|dl)(\d+)/.exec(rest);
    if (keepMatch) {
      const amount = Number(keepMatch[2]);
      if (amount < 1) return failure(`Invalid ${keepMatch[1]}${keepMatch[2]}`);
      if (amount > count) return failure(`${keepMatch[1]}${amount} needs at least ${amount} dice`);
      keep = { mode: keepMatch[1], count: amount };
      text += keepMatch[0];
      index += keepMatch[0].length;
      continue;
    }

    const rerollMatch = /^(ro?)([<>=]?)(\d+)/.exec(rest);
    if (rerollMatch) {
      const value = Number(rerollMatch[3]);
      if (value < 1 || value > sides) {
        return failure(`${rerollMatch[1]}${rerollMatch[2]}${rerollMatch[3]} is outside 1–${sides}`);
      }
      text += rerollMatch[0];
      index += rerollMatch[0].length;
      continue;
    }

    if (rest[0] === "!") {
      explode = true;
      text += "!";
      index += 1;
      continue;
    }

    break;
  }

  let kept = count;
  if (keep) {
    if (keep.mode === "kh" || keep.mode === "kl") {
      kept = Math.min(keep.count, count);
    } else {
      kept = count - keep.count;
      if (kept < 1) return failure(`Cannot drop ${keep.count} of ${count} dice`);
    }
  }

  return {
    ok: true,
    text,
    min: kept,
    max: explode ? null : kept * sides,
    dice: count,
    next: index,
  };
}

function parseExpression(source) {
  let index = 0;
  let notation = "";
  let max = 0;
  let min = 0;
  let dice = 0;
  let first = true;

  while (index < source.length) {
    let operator = "+";
    if (source[index] === "+" || source[index] === "-") {
      operator = source[index];
      index += 1;
    } else if (!first) {
      return failure(`Unexpected “${source[index]}” — only + and - can join terms`);
    }

    const term = parseTerm(source, index);
    if (!term.ok) return term;
    index = term.next;
    dice += term.dice;
    if (dice > MAX_DICE) return failure(`Too many dice (max ${MAX_DICE})`);

    notation += (first && operator === "+" ? "" : operator) + term.text;
    if (operator === "+") {
      max = add(max, term.max);
      min = add(min, term.min);
    } else {
      max = sub(max, term.min);
      min = sub(min, term.max);
    }
    first = false;
  }

  if (first) return failure("Nothing to roll");
  if (notation.length > MAX_LENGTH) return failure(`Too long (max ${MAX_LENGTH} characters)`);
  return { ok: true, notation, min, max, dice };
}

/**
 * Parse a complete roll string. Returns { ok: true, notation, min, max, dice }
 * or { ok: false, error }. `max` is null when it cannot be bounded (exploding dice).
 */
export function parse(input) {
  if (typeof input !== "string") return failure("Nothing to roll");

  let text = stripDecoration(input).slice(0, 400);
  if (!text) return failure("Nothing to roll");

  text = applyAdvantage(text);
  const source = normalize(text);
  if (!source) return failure("Nothing to roll");
  if (source.length > MAX_LENGTH) return failure(`Too long (max ${MAX_LENGTH} characters)`);
  if (!/^[0-9dkhlor!<>=+-]+$/.test(source)) {
    return failure("Not dice notation this bridge understands — try something like 1d20+5");
  }

  const result = parseExpression(source);
  if (result.ok && result.dice === 0) {
    return failure("That is just a number — add a die, like 1d20");
  }
  return result;
}

/**
 * Pull the first roll out of arbitrary text, so "Fireball: 8d6 fire damage"
 * or "I rolled 1d20 + 5" both work. Falls back to the direct parse error.
 */
export function extractNotation(raw) {
  if (typeof raw !== "string") return failure("Nothing to roll");

  const direct = parse(raw);
  if (direct.ok) return direct;

  // The lookbehind stops prose like "rolled 1d20" from anchoring on the "d"
  // at the end of a word.
  const anchor = /(?<![a-z0-9_])\d*d\s*\d+/i.exec(raw);
  if (!anchor) return direct;

  let candidate = "";
  const chunk = raw.slice(anchor.index, anchor.index + 200);
  for (const char of chunk) {
    if (/[0-9a-zA-Z+\-*/()<>=!.\s]/.test(char)) candidate += char;
    else break;
  }

  let text = candidate;
  for (let attempt = 0; attempt < 80 && text.length > 0; attempt += 1) {
    const result = parse(text);
    if (result.ok) return result;
    text = text.slice(0, -1).trimEnd();
  }

  return direct;
}
