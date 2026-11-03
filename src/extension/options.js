import { normalizeOrigin } from "../shared/protocol.js";

const DEFAULTS = {
  senderName: "Dice Bridge",
  companionOrigin: "http://localhost:8788",
  preferredRoom: "",
  showChip: true,
};

const form = document.getElementById("settings");
const saved = document.getElementById("saved");

async function load() {
  const values = await chrome.storage.sync.get(DEFAULTS);
  form.senderName.value = values.senderName;
  form.companionOrigin.value = values.companionOrigin;
  form.preferredRoom.value = values.preferredRoom;
  form.showChip.checked = Boolean(values.showChip);
}

function flash(text, isError = false) {
  saved.textContent = text;
  saved.dataset.error = String(isError);
  setTimeout(() => {
    saved.textContent = "";
  }, 2000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const companionOrigin = normalizeOrigin(form.companionOrigin.value);
  if (!companionOrigin) {
    flash("Receiver origin must be a URL like https://dice.example.com", true);
    return;
  }

  await chrome.storage.sync.set({
    senderName: form.senderName.value.trim() || DEFAULTS.senderName,
    companionOrigin,
    preferredRoom: form.preferredRoom.value.trim(),
    showChip: form.showChip.checked,
  });

  form.companionOrigin.value = companionOrigin;
  flash("Saved");
});

load();
