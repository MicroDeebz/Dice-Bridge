/**
 * Wire protocol between the browser extension's content script (running on the
 * Owlbear Rodeo page) and the Dice Bridge receiver iframe (an Owlbear Rodeo
 * extension loaded in the same tab).
 *
 * Every hop after this one is postMessage, which is ambient and unauthenticated:
 * both ends re-validate origin, shape and field types on every message.
 */

export const PROTOCOL_VERSION = 1;

export const DEFAULT_COMPANION_ORIGIN = "http://localhost:8788";

export const MAX_NOTATION_LENGTH = 120;
export const MAX_REQUEST_ID_LENGTH = 80;

export const MSG = Object.freeze({
  HELLO: "dice-bridge/hello",
  PING: "dice-bridge/ping",
  ROLL: "dice-bridge/roll",
  ACK: "dice-bridge/ack",
});

const MESSAGE_TYPES = new Set(Object.values(MSG));

/**
 * Owlbear Rodeo runs on owlbear.rodeo; localhost/127.0.0.1 is allowed for
 * development rooms only.
 */
export function isAppOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && (url.hostname === "owlbear.rodeo" || url.hostname.endsWith(".owlbear.rodeo"))) {
    return true;
  }
  if ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return true;
  }
  return false;
}

/** Normalize a user-typed companion URL to a bare origin, or "" if unusable. */
export function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value.trim()).origin;
  } catch {
    return "";
  }
}

/**
 * Validate an incoming protocol message. Returns a clean copy or null; never
 * returns the raw object, so no unvetted fields reach the receiver.
 */
export function readBridgeMessage(raw) {
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
      detail: typeof raw.detail === "string" ? raw.detail.slice(0, 200) : "",
    };
  }

  if (type === MSG.HELLO) {
    return {
      type,
      roomId: typeof raw.roomId === "string" ? raw.roomId.slice(0, 200) : "",
      playerId: typeof raw.playerId === "string" ? raw.playerId.slice(0, 200) : "",
    };
  }

  return { type };
}

export function createHello({ roomId = "", playerId = "" } = {}) {
  return { v: PROTOCOL_VERSION, type: MSG.HELLO, roomId, playerId };
}

export function createPing() {
  return { v: PROTOCOL_VERSION, type: MSG.PING };
}

export function createRoll({ notation, sender = "", requestId }) {
  return { v: PROTOCOL_VERSION, type: MSG.ROLL, notation, sender, requestId };
}

export function createAck({ requestId, ok, detail = "" }) {
  return { v: PROTOCOL_VERSION, type: MSG.ACK, requestId, ok: Boolean(ok), detail };
}
