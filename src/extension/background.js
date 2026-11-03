/**
 * Service worker: finds the Owlbear Rodeo tab, forwards a validated roll to its
 * content script, and reports back. It is deliberately the only place that knows
 * about tab selection, so the popup, context menu, keyboard command and in-page
 * chip all behave identically.
 */
import { extractNotation, parse } from "../shared/dice.js";
import { sanitizeSender } from "../shared/rumble.js";
import { DEFAULT_COMPANION_ORIGIN } from "../shared/protocol.js";

const ROOM_URLS = ["https://owlbear.rodeo/*"];
const MENU_ID = "dice-bridge-send-selection";
const MAX_RECENT = 8;

const DEFAULT_SETTINGS = {
  senderName: "Dice Bridge",
  companionOrigin: DEFAULT_COMPANION_ORIGIN,
  preferredRoom: "",
  showChip: true,
};

let badgeTimer = 0;

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
  }, 3000);
}

async function findRoomTabs() {
  const tabs = await chrome.tabs.query({ url: ROOM_URLS });
  return tabs.filter((tab) => typeof tab.id === "number");
}

/** "https://owlbear.rodeo/room/abc123?x=1" and "abc123" both match room abc123. */
function roomKey(value) {
  return String(value || "")
    .trim()
    .replace(/^.*\/room\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
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
      sender: sanitizeSender(sender || settings.senderName),
    });
  } catch {
    result = null;
  }

  if (!result) {
    flashBadge("!", "#b3261e", "Owlbear Rodeo tab did not answer");
    return {
      ok: false,
      reason: "no-bridge",
      message: "The Owlbear Rodeo tab did not answer. Reload the room tab and try again.",
    };
  }

  if (result.ok) {
    await rememberRoll(parsed.notation);
    flashBadge("✓", "#1b6e3a", `Sent ${parsed.notation} to Rumble!`);
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
      tabCount: 0,
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
      companionOrigin: settings.companionOrigin,
    };
  }

  return {
    state: "no-receiver",
    message: "Room tab open, receiver not loaded",
    tabId: tab.id,
    tabCount: tabs.length,
    companionOrigin: settings.companionOrigin,
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
      title: "Roll “%s” in Owlbear Rodeo",
      contexts: ["selection"],
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
