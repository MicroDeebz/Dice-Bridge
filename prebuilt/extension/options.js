(() => {
  // src/shared/protocol.js
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

  // src/extension/options.js
  var DEFAULTS = {
    senderName: "Dice Bridge",
    companionOrigin: "http://localhost:8788",
    preferredRoom: "",
    showChip: true
  };
  var form = document.getElementById("settings");
  var saved = document.getElementById("saved");
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
    }, 2e3);
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
      showChip: form.showChip.checked
    });
    form.companionOrigin.value = companionOrigin;
    flash("Saved");
  });
  load();
})();
