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
  function extractNotation(raw) {
    if (typeof raw !== "string") return failure("Nothing to roll");
    const direct = parse(raw);
    if (direct.ok) return direct;
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

  // src/extension/content-source.js
  var DEFAULTS = { showChip: true, senderName: "Dice Bridge" };
  var settings = { ...DEFAULTS };
  var host = null;
  var refs = null;
  var hideTimer = 0;
  var suppressHide = false;
  var pendingNotation = "";
  function setStyles(element, styles, important = false) {
    for (const [property, value] of Object.entries(styles)) {
      if (important) element.style.setProperty(property, value, "important");
      else element.style[property] = value;
    }
    return element;
  }
  function ensureChip() {
    if (host && host.isConnected && refs) return refs;
    host = document.createElement("div");
    host.id = "dice-bridge-chip";
    setStyles(
      host,
      {
        all: "initial",
        position: "fixed",
        top: "0",
        left: "0",
        display: "none",
        zIndex: "2147483647",
        pointerEvents: "auto"
      },
      true
    );
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Send dice roll to Owlbear Rodeo");
    setStyles(button, {
      display: "inline-flex",
      alignItems: "center",
      gap: "7px",
      padding: "7px 11px",
      borderRadius: "999px",
      border: "1px solid #5b4bd6",
      background: "#231d3f",
      color: "#f2f0ff",
      font: "600 12px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif",
      boxShadow: "0 6px 20px rgba(0,0,0,.35)",
      cursor: "pointer",
      whiteSpace: "nowrap"
    });
    const dice = document.createElement("span");
    dice.textContent = "\u{1F3B2}";
    setStyles(dice, { fontSize: "14px", lineHeight: "1" });
    const label = document.createElement("span");
    setStyles(label, { font: "600 12px/1.2 ui-monospace, 'SF Mono', Menlo, monospace" });
    const status = document.createElement("span");
    setStyles(status, { font: "500 11px/1.2 system-ui, sans-serif", color: "#b8b0ff" });
    button.append(dice, label, status);
    shadow.append(button);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressHide = true;
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      send(pendingNotation);
    });
    document.documentElement.append(host);
    refs = { button, label, status };
    return refs;
  }
  function hideChip() {
    if (host) host.style.display = "none";
    pendingNotation = "";
  }
  function showChip(notation, rect) {
    if (!settings.showChip) return;
    const current = ensureChip();
    pendingNotation = notation;
    current.button.disabled = false;
    current.label.textContent = notation;
    current.status.textContent = "";
    current.status.style.color = "#b8b0ff";
    host.style.display = "block";
    const box = host.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = rect ? rect.left + rect.width / 2 - box.width / 2 : viewportWidth - box.width - 16;
    let top = rect ? rect.top - box.height - 8 : viewportHeight - box.height - 16;
    left = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - box.width - margin));
    if (top < margin) top = rect ? rect.bottom + 8 : margin;
    top = Math.min(top, viewportHeight - box.height - margin);
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }
  async function send(notation) {
    if (!notation) return { ok: false, reason: "empty" };
    const current = refs;
    if (current) {
      current.button.disabled = true;
      current.status.textContent = "Sending\u2026";
    }
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "bridge/roll",
        notation,
        sender: settings.senderName
      });
    } catch {
      result = { ok: false, message: "Extension was reloaded \u2014 refresh this page." };
    }
    if (current) {
      if (result && result.ok) {
        current.status.textContent = "Sent \u2713";
        current.status.style.color = "#3ddc97";
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideChip, 1500);
      } else {
        current.status.textContent = result?.message || "Failed";
        current.status.style.color = "#ff8080";
        current.button.disabled = false;
      }
    }
    return result;
  }
  function readSelection() {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      if (active.type === "password") return null;
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start === "number" && typeof end === "number" && end > start) {
        const text2 = String(active.value ?? "").slice(start, end).slice(0, 500);
        if (!text2.trim()) return null;
        return { text: text2, rect: active.getBoundingClientRect() };
      }
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().trim().slice(0, 500);
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const valid = rect && (rect.width > 0 || rect.height > 0);
    return { text, rect: valid ? rect : null };
  }
  function onSelectionSettled() {
    if (suppressHide) {
      suppressHide = false;
      return;
    }
    const selection = readSelection();
    if (!selection) {
      hideChip();
      return;
    }
    const parsed = extractNotation(selection.text);
    if (!parsed.ok) {
      hideChip();
      return;
    }
    showChip(parsed.notation, selection.rect);
  }
  document.addEventListener("mouseup", () => setTimeout(onSelectionSettled, 10), true);
  document.addEventListener("dblclick", () => setTimeout(onSelectionSettled, 10), true);
  document.addEventListener(
    "keyup",
    (event) => {
      const selectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
      if (event.shiftKey || event.key.startsWith("Arrow") || event.key === "Escape" || selectAll) {
        setTimeout(onSelectionSettled, 10);
      }
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideChip();
  }, true);
  document.addEventListener("scroll", () => {
    if (host && host.style.display !== "none") hideChip();
  }, true);
  document.addEventListener(
    "mousedown",
    (event) => {
      if (!host) return;
      if (event.composedPath().includes(host)) return;
      hideChip();
    },
    true
  );
  window.addEventListener("resize", hideChip);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "source/send-selection") return false;
    const selection = readSelection();
    const parsed = selection ? extractNotation(selection.text) : { ok: false };
    if (!parsed.ok) {
      respond({ ok: false, reason: "no-selection", message: "Select dice notation first" });
      return false;
    }
    showChip(parsed.notation, selection.rect);
    send(parsed.notation).then(respond);
    return true;
  });
  chrome.storage.sync.get(DEFAULTS).then((value) => {
    settings = { ...DEFAULTS, ...value };
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) settings[key] = newValue;
    }
    if (!settings.showChip) hideChip();
  });
})();
