/**
 * Content script for the Owlbear Rodeo tab.
 *
 * Finds the Dice Bridge receiver iframe inside the room, hands it validated
 * rolls, and reports whether a receiver is alive. It deliberately knows nothing
 * about Rumble!: the receiver owns the Owlbear Rodeo SDK and the metadata write.
 */
import {
  DEFAULT_COMPANION_ORIGIN,
  MSG,
  PROTOCOL_VERSION,
  normalizeOrigin,
  readBridgeMessage,
} from "../shared/protocol.js";

const HELLO_TTL = 20000;
const HELLO_WAIT = 1500;
const ACK_TIMEOUT = 2500;

let companionOrigin = DEFAULT_COMPANION_ORIGIN;
let channel = null;
const pending = new Map();
const helloWaiters = new Set();

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get({ companionOrigin: DEFAULT_COMPANION_ORIGIN });
    const next = normalizeOrigin(stored.companionOrigin) || DEFAULT_COMPANION_ORIGIN;
    if (next !== companionOrigin) {
      companionOrigin = next;
      channel = null;
    }
  } catch {
    /* keep the default */
  }
}

loadSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.companionOrigin) return;
  const next = normalizeOrigin(changes.companionOrigin.newValue) || DEFAULT_COMPANION_ORIGIN;
  if (next !== companionOrigin) {
    companionOrigin = next;
    channel = null;
  }
});

function waitForHello(timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      helloWaiters.delete(waiter);
      resolve(null);
    }, timeout);

    function waiter() {
      clearTimeout(timer);
      helloWaiters.delete(waiter);
      resolve(channel);
    }

    helloWaiters.add(waiter);
  });
}

window.addEventListener("message", (event) => {
  if (event.origin !== companionOrigin) return;

  const message = readBridgeMessage(event.data);
  if (!message) return;

  if (message.type === MSG.HELLO) {
    channel = {
      source: event.source,
      origin: event.origin,
      roomId: message.roomId,
      playerId: message.playerId,
      lastSeen: Date.now(),
    };
    for (const waiter of [...helloWaiters]) waiter();
    return;
  }

  if (message.type === MSG.ACK) {
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    clearTimeout(entry.timer);
    entry.resolve(message);
  }
});

/** Owlbear Rodeo can nest iframes in shadow roots; walk those too. */
function collectIframes(root, found = []) {
  let frames = [];
  try {
    frames = root.querySelectorAll("iframe");
  } catch {
    frames = [];
  }

  for (const frame of frames) {
    const src = frame.getAttribute("src") || "";
    if (src.startsWith(companionOrigin)) found.push(frame);
  }

  let nodes = [];
  try {
    nodes = root.querySelectorAll("*");
  } catch {
    nodes = [];
  }

  for (const node of nodes) {
    if (node.shadowRoot) collectIframes(node.shadowRoot, found);
  }

  return found;
}

function pingFrames() {
  const frames = collectIframes(document);
  for (const frame of frames) {
    const target = frame.contentWindow;
    if (!target) continue;
    try {
      target.postMessage({ v: PROTOCOL_VERSION, type: MSG.PING }, companionOrigin);
    } catch {
      /* cross-origin iframe that refuses messages; ignore */
    }
  }
  return frames.length;
}

async function ensureChannel(timeout = HELLO_WAIT) {
  if (channel && Date.now() - channel.lastSeen < HELLO_TTL) return channel;

  // Register the waiter before pinging, then re-check: a hello that lands
  // between the first check and the registration would otherwise be missed
  // until the next announce.
  const waiter = waitForHello(timeout);
  if (channel && Date.now() - channel.lastSeen < HELLO_TTL) return channel;
  pingFrames();
  return waiter;
}

function attempt({ notation, sender, requestId }) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, ACK_TIMEOUT);

    pending.set(requestId, { timer, resolve });

    try {
      channel.source.postMessage(
        { v: PROTOCOL_VERSION, type: MSG.ROLL, notation, sender: sender || "", requestId },
        companionOrigin,
      );
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(null);
    }
  });
}

async function sendRoll({ notation, sender, requestId }) {
  const id = requestId || crypto.randomUUID();

  const first = await ensureChannel(HELLO_WAIT);
  if (!first) {
    return {
      ok: false,
      reason: "no-receiver",
      message: "Dice Bridge receiver is not loaded in this room.",
    };
  }

  let ack = await attempt({ notation, sender, requestId: id });

  if (!ack) {
    // The room may have reloaded the iframe; rediscover once and retry with the
    // same request id so the receiver can deduplicate.
    pingFrames();
    const second = await ensureChannel(1000);
    if (second) ack = await attempt({ notation, sender, requestId: id });
  }

  if (!ack) {
    return {
      ok: false,
      reason: "timeout",
      message: "The room did not answer. Reload the room tab and try again.",
    };
  }

  if (!ack.ok) {
    return { ok: false, reason: "rejected", message: ack.detail || "The room rejected the roll." };
  }

  channel.lastSeen = Date.now();
  return { ok: true, detail: ack.detail, roomId: channel.roomId };
}

async function status() {
  const target =
    channel && Date.now() - channel.lastSeen < HELLO_TTL ? channel : await ensureChannel(1200);
  if (!target) return { ok: false, reason: "no-receiver" };
  return { ok: true, roomId: target.roomId, playerId: target.playerId };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "obr/roll") {
    sendRoll(message).then(respond);
    return true;
  }
  if (message?.type === "obr/status") {
    status().then(respond);
    return true;
  }
  return false;
});
