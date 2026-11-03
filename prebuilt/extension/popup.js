(() => {
  // src/shared/dice.js
  var MAX_LENGTH = 120;
  var MAX_DICE = 100;
  var MAX_SIDES = 1e3;
  var MIN_SIDES = 2;
  var MAX_TERM_VALUE = 9999;
  var failure = (error) => ({ ok: false, error });
  var ADVANTAGE = /\badv(?:antage)?\b/i;
  var DISADVANTAGE = /\bdis(?:advantage)?\b/i;
  var isDigit = (char) => char >= "0" && char <= "9";
  var add = (a, b) => a === null || b === null ? null : a + b;
  var sub = (a, b) => a === null || b === null ? null : a - b;
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
    return text.replace(/[\u2013\u2014\u2212]/g, "-").replace(/[\u00d7\u2715]/g, "*").replace(/\s+/g, "").toLowerCase();
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
        return failure(`Unexpected \u201C${found}\u201D \u2014 expected dice like 1d20`);
      }
      const value = Number(digits);
      if (value > MAX_TERM_VALUE) return failure(`Modifier too large (max ${MAX_TERM_VALUE})`);
      return { ok: true, text: String(value), min: value, max: value, dice: 0, next: index };
    }
    index += 1;
    let sidesText = "";
    while (index < source.length && isDigit(source[index])) {
      sidesText += source[index];
      index += 1;
    }
    if (!sidesText) return failure("Missing die size \u2014 try 1d20");
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
          return failure(`${rerollMatch[1]}${rerollMatch[2]}${rerollMatch[3]} is outside 1\u2013${sides}`);
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
      next: index
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
        return failure(`Unexpected \u201C${source[index]}\u201D \u2014 only + and - can join terms`);
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
  function parse(input) {
    if (typeof input !== "string") return failure("Nothing to roll");
    let text = stripDecoration(input).slice(0, 400);
    if (!text) return failure("Nothing to roll");
    text = applyAdvantage(text);
    const source = normalize(text);
    if (!source) return failure("Nothing to roll");
    if (source.length > MAX_LENGTH) return failure(`Too long (max ${MAX_LENGTH} characters)`);
    if (!/^[0-9dkhlor!<>=+-]+$/.test(source)) {
      return failure("Not dice notation this bridge understands \u2014 try something like 1d20+5");
    }
    const result = parseExpression(source);
    if (result.ok && result.dice === 0) {
      return failure("That is just a number \u2014 add a die, like 1d20");
    }
    return result;
  }

  // src/extension/popup.js
  var notationInput = document.getElementById("notation");
  var preview = document.getElementById("preview");
  var rollButton = document.getElementById("roll");
  var statusEl = document.getElementById("status");
  var statusText = document.getElementById("statusText");
  var recentSection = document.getElementById("recentSection");
  var recentEl = document.getElementById("recent");
  var openRoomButton = document.getElementById("openRoom");
  var optionsButton = document.getElementById("options");
  var current = null;
  function renderParse() {
    const value = notationInput.value;
    if (!value.trim()) {
      current = null;
      rollButton.disabled = true;
      preview.dataset.kind = "hint";
      preview.textContent = "Select dice on any page, or type notation here.";
      return;
    }
    const result = parse(value);
    current = result.ok ? result : null;
    rollButton.disabled = !result.ok;
    preview.dataset.kind = result.ok ? "ok" : "error";
    if (!result.ok) {
      preview.textContent = result.error;
      return;
    }
    preview.textContent = result.max === null ? `${result.notation} \xB7 exploding dice` : `${result.notation} \xB7 max ${result.max}`;
  }
  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
  }
  async function refreshStatus() {
    setStatus("unknown", "Checking\u2026");
    let status = null;
    try {
      status = await chrome.runtime.sendMessage({ type: "bridge/status" });
    } catch {
      status = null;
    }
    if (!status) {
      setStatus("unknown", "Extension unavailable");
      return;
    }
    if (status.state === "connected") {
      setStatus("connected", `Ready \xB7 room ${String(status.roomId || "?").slice(0, 6)}`);
    } else if (status.state === "no-receiver") {
      setStatus("no-receiver", "Room open \xB7 receiver missing");
    } else {
      setStatus("no-tab", "No Owlbear Rodeo tab");
    }
  }
  async function loadRecent() {
    let response = null;
    try {
      response = await chrome.runtime.sendMessage({ type: "bridge/recent" });
    } catch {
      response = null;
    }
    const recent = response?.recent ?? [];
    recentSection.hidden = recent.length === 0;
    recentEl.textContent = "";
    for (const item of recent) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = item.notation;
      chip.addEventListener("click", () => {
        notationInput.value = item.notation;
        renderParse();
        notationInput.focus();
      });
      recentEl.append(chip);
    }
  }
  async function sendRoll() {
    if (!current) return;
    rollButton.disabled = true;
    preview.dataset.kind = "hint";
    preview.textContent = "Sending\u2026";
    let result = null;
    try {
      result = await chrome.runtime.sendMessage({ type: "bridge/roll", notation: current.notation });
    } catch {
      result = null;
    }
    if (result?.ok) {
      preview.dataset.kind = "ok";
      preview.textContent = `Sent ${result.notation} to Rumble! \u2713`;
      loadRecent();
    } else {
      preview.dataset.kind = "error";
      preview.textContent = result?.message || "Could not reach Owlbear Rodeo.";
    }
    rollButton.disabled = !current;
  }
  notationInput.addEventListener("input", renderParse);
  notationInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendRoll();
    }
  });
  rollButton.addEventListener("click", sendRoll);
  openRoomButton.addEventListener("click", () => chrome.runtime.sendMessage({ type: "bridge/open-room" }));
  optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  renderParse();
  refreshStatus();
  loadRecent();
})();
