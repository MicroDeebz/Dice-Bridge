(() => {
  // src/shared/protocol.js
  var PROTOCOL_VERSION = 1;
  var DEFAULT_COMPANION_ORIGIN = "http://localhost:8788";
  var MAX_NOTATION_LENGTH = 120;
  var MAX_REQUEST_ID_LENGTH = 80;
  var MSG = Object.freeze({
    HELLO: "dice-bridge/hello",
    PING: "dice-bridge/ping",
    ROLL: "dice-bridge/roll",
    ACK: "dice-bridge/ack"
  });
  var MESSAGE_TYPES = new Set(Object.values(MSG));
  function normalizeOrigin(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      return new URL(value.trim()).origin;
    } catch {
      return "";
    }
  }
  function readBridgeMessage(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (raw.v !== PROTOCOL_VERSION) return null;
    const type = raw.type;
    if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) return null;
    if (type === MSG.ROLL) {
      if (typeof raw.notation !== "string") return null;
      const notation = raw.notation.trim();
      if (!notation || notation.length > MAX_NOTATION_LENGTH) return null;
      if (typeof raw.requestId !== "string") return null;
      const requestId = raw.requestId.trim();
      if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) return null;
      const sender = typeof raw.sender === "string" ? raw.sender.slice(0, 200) : "";
      return { type, notation, sender, requestId };
    }
    if (type === MSG.ACK) {
      if (typeof raw.requestId !== "string") return null;
      const requestId = raw.requestId.trim();
      if (!requestId) return null;
      return {
        type,
        requestId,
        ok: raw.ok === true,
        detail: typeof raw.detail === "string" ? raw.detail.slice(0, 200) : ""
      };
    }
    if (type === MSG.HELLO) {
      return {
        type,
        roomId: typeof raw.roomId === "string" ? raw.roomId.slice(0, 200) : "",
        playerId: typeof raw.playerId === "string" ? raw.playerId.slice(0, 200) : ""
      };
    }
    return { type };
  }

  // src/extension/content-bridge.js
  var HELLO_TTL = 2e4;
  var HELLO_WAIT = 1500;
  var ACK_TIMEOUT = 2500;
  var companionOrigin = DEFAULT_COMPANION_ORIGIN;
  var channel = null;
  var pending = /* @__PURE__ */ new Map();
  var helloWaiters = /* @__PURE__ */ new Set();
  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get({ companionOrigin: DEFAULT_COMPANION_ORIGIN });
      const next = normalizeOrigin(stored.companionOrigin) || DEFAULT_COMPANION_ORIGIN;
      if (next !== companionOrigin) {
        companionOrigin = next;
        channel = null;
      }
    } catch {
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
        lastSeen: Date.now()
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
      }
    }
    return frames.length;
  }
  async function ensureChannel(timeout = HELLO_WAIT) {
    if (channel && Date.now() - channel.lastSeen < HELLO_TTL) return channel;
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
          companionOrigin
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
        message: "Dice Bridge receiver is not loaded in this room."
      };
    }
    let ack = await attempt({ notation, sender, requestId: id });
    if (!ack) {
      pingFrames();
      const second = await ensureChannel(1e3);
      if (second) ack = await attempt({ notation, sender, requestId: id });
    }
    if (!ack) {
      return {
        ok: false,
        reason: "timeout",
        message: "The room did not answer. Reload the room tab and try again."
      };
    }
    if (!ack.ok) {
      return { ok: false, reason: "rejected", message: ack.detail || "The room rejected the roll." };
    }
    channel.lastSeen = Date.now();
    return { ok: true, detail: ack.detail, roomId: channel.roomId };
  }
  async function status() {
    const target = channel && Date.now() - channel.lastSeen < HELLO_TTL ? channel : await ensureChannel(1200);
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
})();
