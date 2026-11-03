import { parse } from "../shared/dice.js";

const notationInput = document.getElementById("notation");
const preview = document.getElementById("preview");
const rollButton = document.getElementById("roll");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const recentSection = document.getElementById("recentSection");
const recentEl = document.getElementById("recent");
const openRoomButton = document.getElementById("openRoom");
const optionsButton = document.getElementById("options");

let current = null;

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
  preview.textContent = result.max === null ? `${result.notation} · exploding dice` : `${result.notation} · max ${result.max}`;
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusText.textContent = text;
}

async function refreshStatus() {
  setStatus("unknown", "Checking…");

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
    setStatus("connected", `Ready · room ${String(status.roomId || "?").slice(0, 6)}`);
  } else if (status.state === "no-receiver") {
    setStatus("no-receiver", "Room open · receiver missing");
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
  preview.textContent = "Sending…";

  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "bridge/roll", notation: current.notation });
  } catch {
    result = null;
  }

  if (result?.ok) {
    preview.dataset.kind = "ok";
    preview.textContent = `Sent ${result.notation} to Rumble! ✓`;
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
