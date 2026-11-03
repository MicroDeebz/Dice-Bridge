/**
 * Content script for ordinary webpages: watch what the user selects, recognise
 * dice notation, and offer a one-click "roll in Owlbear Rodeo" chip.
 *
 * Only a user selection is ever read. Nothing is scraped in the background, no
 * page content is transmitted anywhere except the user's own Owlbear Rodeo tab.
 */
import { extractNotation } from "../shared/dice.js";

const DEFAULTS = { showChip: true, senderName: "Dice Bridge" };

let settings = { ...DEFAULTS };
let host = null;
let refs = null;
let hideTimer = 0;
let suppressHide = false;
let pendingNotation = "";

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
      pointerEvents: "auto",
    },
    true,
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
    whiteSpace: "nowrap",
  });

  const dice = document.createElement("span");
  dice.textContent = "🎲";
  setStyles(dice, { fontSize: "14px", lineHeight: "1" });

  const label = document.createElement("span");
  setStyles(label, { font: "600 12px/1.2 ui-monospace, 'SF Mono', Menlo, monospace" });

  const status = document.createElement("span");
  setStyles(status, { font: "500 11px/1.2 system-ui, sans-serif", color: "#b8b0ff" });

  button.append(dice, label, status);
  shadow.append(button);

  // Keep the page selection alive while interacting with the chip.
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
    current.status.textContent = "Sending…";
  }

  let result;
  try {
    result = await chrome.runtime.sendMessage({
      type: "bridge/roll",
      notation,
      sender: settings.senderName,
    });
  } catch {
    result = { ok: false, message: "Extension was reloaded — refresh this page." };
  }

  if (current) {
    if (result && result.ok) {
      current.status.textContent = "Sent ✓";
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

/**
 * Read the current selection, including selections inside inputs and textareas
 * (character-sheet tools often put the roll in a field, not on the page).
 */
function readSelection() {
  const active = document.activeElement;

  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    if (active.type === "password") return null;
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      const text = String(active.value ?? "").slice(start, end).slice(0, 500);
      if (!text.trim()) return null;
      return { text, rect: active.getBoundingClientRect() };
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
  true,
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
  true,
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
