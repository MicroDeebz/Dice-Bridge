/**
 * Dice Bridge receiver: an Owlbear Rodeo extension that lives in the room,
 * announces itself to the browser extension's content script, and forwards
 * accepted rolls to Rumble! via player metadata.
 *
 * Loaded twice on purpose (`background_url` for persistence, the action popover
 * for a visible status panel); both instances are harmless because each roll
 * carries a request id the other instance has never seen.
 */
import OBR from "@owlbear-rodeo/sdk";

import { MSG, PROTOCOL_VERSION, isAppOrigin, readBridgeMessage } from "../shared/protocol.js";
import { rollInRumble } from "./roll.js";

const ANNOUNCE_INTERVAL = 5000;
const MAX_REPLIES = 200;

const state = {
  ready: false,
  roomId: "",
  playerId: "",
  lastRoll: "",
  lastError: "",
  count: 0,
};

const listeners = new Set();

function emit() {
  for (const listener of listeners) {
    try {
      listener({ ...state });
    } catch {
      /* a broken UI listener must not break the receiver */
    }
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function getState() {
  return { ...state };
}

/** Owlbear Rodeo passes the app origin and room id as base64 in `?obrref=`. */
function readRef() {
  const ref = new URLSearchParams(window.location.search).get("obrref");
  if (!ref) return { appOrigin: "", roomId: "" };
  try {
    const [origin, roomId] = atob(ref).split(" ");
    return { appOrigin: origin || "", roomId: roomId || "" };
  } catch {
    return { appOrigin: "", roomId: "" };
  }
}

export function installReceiver() {
  const { appOrigin } = readRef();
  const replies = new Map();
  let announceTimer = 0;

  const parentOrigin = () => appOrigin || "*";

  function announce() {
    if (!state.ready) return;
    window.parent.postMessage(
      { v: PROTOCOL_VERSION, type: MSG.HELLO, roomId: state.roomId, playerId: state.playerId },
      parentOrigin(),
    );
  }

  OBR.onReady(() => {
    state.ready = true;
    state.roomId = OBR.room.id || readRef().roomId || "";
    try {
      state.playerId = OBR.player.id;
    } catch {
      state.playerId = "";
    }

    emit();
    announce();
    announceTimer = window.setInterval(announce, ANNOUNCE_INTERVAL);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) announce();
    });
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window.parent) return;
    if (!isAppOrigin(event.origin)) return;
    if (appOrigin && event.origin !== appOrigin) return;

    const message = readBridgeMessage(event.data);
    if (!message) return;

    if (message.type === MSG.PING) {
      announce();
      return;
    }
    if (message.type !== MSG.ROLL) return;

    const reply = (ok, detail) => {
      window.parent.postMessage(
        { v: PROTOCOL_VERSION, type: MSG.ACK, requestId: message.requestId, ok, detail },
        appOrigin || event.origin,
      );
    };

    // The content script retries once after a timeout; re-send the original
    // answer instead of rolling twice.
    const previous = replies.get(message.requestId);
    if (previous) {
      reply(previous.ok, previous.detail);
      return;
    }

    if (!state.ready) {
      state.lastError = "Owlbear Rodeo is still loading";
      emit();
      reply(false, "Owlbear Rodeo is still loading this extension");
      return;
    }

    try {
      const notation = await rollInRumble({ notation: message.notation, sender: message.sender });
      state.count += 1;
      state.lastRoll = notation;
      state.lastError = "";
      remember(message.requestId, { ok: true, detail: `Rolled ${notation}` });
      emit();
      reply(true, `Rolled ${notation}`);
    } catch (error) {
      const detail = error?.message || String(error);
      state.lastError = detail;
      remember(message.requestId, { ok: false, detail });
      emit();
      reply(false, detail);
    }
  });

  function remember(requestId, result) {
    replies.set(requestId, result);
    if (replies.size > MAX_REPLIES) replies.delete(replies.keys().next().value);
  }

  window.addEventListener("pagehide", () => clearInterval(announceTimer), { once: true });
}
