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

  // src/shared/rumble.js
  var MAX_SENDER_LENGTH = 40;
  function sanitizeSender(value, fallback = "Dice Bridge") {
    if (typeof value !== "string") return fallback;
    const cleaned = value.replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SENDER_LENGTH);
    return cleaned || fallback;
  }

  // src/shared/protocol.js
  var DEFAULT_COMPANION_ORIGIN = "http://localhost:8788";
  var MSG = Object.freeze({
    HELLO: "dice-bridge/hello",
    PING: "dice-bridge/ping",
    ROLL: "dice-bridge/roll",
    ACK: "dice-bridge/ack"
  });
  var MESSAGE_TYPES = new Set(Object.values(MSG));

  // src/extension/background.js
  var ROOM_URLS = ["https://owlbear.rodeo/*"];
  var MENU_ID = "dice-bridge-send-selection";
  var MAX_RECENT = 8;
  var DEFAULT_SETTINGS = {
    senderName: "Dice Bridge",
    companionOrigin: DEFAULT_COMPANION_ORIGIN,
    preferredRoom: "",
    showChip: true
  };
  var badgeTimer = 0;
  async function getSettings() {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...stored };
  }
  function flashBadge(text, color, title) {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
    chrome.action.setTitle({ title: title || "Dice Bridge" });
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Dice Bridge" });
    }, 3e3);
  }
  async function findRoomTabs() {
    const tabs = await chrome.tabs.query({ url: ROOM_URLS });
    return tabs.filter((tab) => typeof tab.id === "number");
  }
  function roomKey(value) {
    return String(value || "").trim().replace(/^.*\/room\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
  function pickTab(tabs, preferredRoom) {
    if (tabs.length === 0) return null;
    const wanted = roomKey(preferredRoom);
    if (wanted) {
      const match = tabs.find((tab) => roomKey(tab.url).startsWith(wanted));
      if (match) return match;
    }
    const active = tabs.find((tab) => tab.active);
    if (active) return active;
    return [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  }
  async function rememberRoll(notation) {
    const { recent = [] } = await chrome.storage.local.get({ recent: [] });
    const next = [{ notation, at: Date.now() }, ...recent.filter((item) => item.notation !== notation)].slice(0, MAX_RECENT);
    await chrome.storage.local.set({ recent: next });
    return next;
  }
  async function routeRoll({ notation, sender, requestId }) {
    const parsed = parse(notation);
    if (!parsed.ok) {
      flashBadge("?", "#5f6368", parsed.error);
      return { ok: false, reason: "bad-notation", message: parsed.error };
    }
    const settings = await getSettings();
    const tabs = await findRoomTabs();
    if (tabs.length === 0) {
      flashBadge("!", "#b3261e", "No Owlbear Rodeo tab is open");
      return { ok: false, reason: "no-tab", message: "Open your Owlbear Rodeo room in a tab first." };
    }
    const tab = pickTab(tabs, settings.preferredRoom);
    const id = requestId || crypto.randomUUID();
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        type: "obr/roll",
        requestId: id,
        notation: parsed.notation,
        sender: sanitizeSender(sender || settings.senderName)
      });
    } catch {
      result = null;
    }
    if (!result) {
      flashBadge("!", "#b3261e", "Owlbear Rodeo tab did not answer");
      return {
        ok: false,
        reason: "no-bridge",
        message: "The Owlbear Rodeo tab did not answer. Reload the room tab and try again."
      };
    }
    if (result.ok) {
      await rememberRoll(parsed.notation);
      flashBadge("\u2713", "#1b6e3a", `Sent ${parsed.notation} to Rumble!`);
    } else {
      flashBadge("!", "#b3261e", result.message || "Roll failed");
    }
    return { ...result, notation: parsed.notation, tabId: tab.id, tabCount: tabs.length };
  }
  async function getStatus() {
    const settings = await getSettings();
    const tabs = await findRoomTabs();
    if (tabs.length === 0) {
      return {
        state: "no-tab",
        message: "No Owlbear Rodeo tab open",
        companionOrigin: settings.companionOrigin,
        tabCount: 0
      };
    }
    const tab = pickTab(tabs, settings.preferredRoom);
    let response = null;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "obr/status" });
    } catch {
      response = null;
    }
    if (response && response.ok) {
      return {
        state: "connected",
        message: "Receiver connected",
        roomId: response.roomId || "",
        playerId: response.playerId || "",
        tabId: tab.id,
        tabCount: tabs.length,
        companionOrigin: settings.companionOrigin
      };
    }
    return {
      state: "no-receiver",
      message: "Room tab open, receiver not loaded",
      tabId: tab.id,
      tabCount: tabs.length,
      companionOrigin: settings.companionOrigin
    };
  }
  async function sendSelectionToActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== "number") {
      flashBadge("?", "#5f6368", "No active tab");
      return;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "source/send-selection" });
    } catch {
      flashBadge("?", "#5f6368", "Nothing to send from this page");
    }
  }
  function createMenu() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: "Roll \u201C%s\u201D in Owlbear Rodeo",
        contexts: ["selection"]
      });
    });
  }
  chrome.runtime.onInstalled.addListener(createMenu);
  chrome.runtime.onStartup.addListener(createMenu);
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== MENU_ID) return;
    const parsed = extractNotation(info.selectionText || "");
    if (!parsed.ok) {
      flashBadge("?", "#5f6368", parsed.error);
      return;
    }
    routeRoll({ notation: parsed.notation }).catch(() => {
      flashBadge("!", "#b3261e", "Roll failed");
    });
  });
  chrome.commands.onCommand.addListener((command) => {
    if (command === "send-selection") sendSelectionToActiveTab();
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    const type = message?.type;
    if (type === "bridge/roll") {
      routeRoll(message).then(respond);
      return true;
    }
    if (type === "bridge/status") {
      getStatus().then(respond);
      return true;
    }
    if (type === "bridge/recent") {
      chrome.storage.local.get({ recent: [] }).then(({ recent }) => respond({ ok: true, recent }));
      return true;
    }
    if (type === "bridge/open-room") {
      getSettings().then(async (settings) => {
        const target = settings.preferredRoom?.startsWith("http") ? settings.preferredRoom : "https://owlbear.rodeo/";
        await chrome.tabs.create({ url: target });
        respond({ ok: true });
      });
      return true;
    }
    return false;
  });
})();
