import { subscribe } from "./receiver.js";
import { rollInRumble } from "./roll.js";

export function mountPopover() {
  const statusEl = document.getElementById("status");
  const roomEl = document.getElementById("room");
  const lastRollEl = document.getElementById("lastRoll");
  const countEl = document.getElementById("count");
  const testButton = document.getElementById("test");

  subscribe((state) => {
    statusEl.textContent = state.ready ? "Receiver active" : "Connecting to Owlbear Rodeo…";
    statusEl.dataset.state = state.ready ? "ok" : "waiting";
    roomEl.textContent = state.roomId ? state.roomId.slice(0, 14) : "—";
    countEl.textContent = String(state.count);
    lastRollEl.textContent = state.lastError ? `Error: ${state.lastError}` : state.lastRoll || "—";
    lastRollEl.dataset.error = String(Boolean(state.lastError));
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    try {
      const notation = await rollInRumble({ notation: "1d20", sender: "Dice Bridge test" });
      lastRollEl.textContent = `${notation} (test)`;
      lastRollEl.dataset.error = "false";
    } catch (error) {
      lastRollEl.textContent = `Error: ${error?.message || error}`;
      lastRollEl.dataset.error = "true";
    } finally {
      testButton.disabled = false;
    }
  });
}
