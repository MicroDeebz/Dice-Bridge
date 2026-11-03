# Dice Bridge

A browser extension that takes dice roll inputs from a webpage and rolls them through **Rumble!** in an **Owlbear Rodeo** room.

Select `2d20kh1+5` on a character sheet, press the floating roll chip (or `Alt+Shift+R`, or the right-click menu), and Rumble! performs the roll in your room — no typing the notation a second time.

The repo contains two cooperating pieces:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| `dist/extension` | Manifest V3 browser extension (Chrome/Edge) | The browser: any page + the Owlbear Rodeo tab |
| `dist/companion` | A small Owlbear Rodeo extension, hosted on any static origin | Inside the room, as an OBR iframe |

---

## Why two pieces

Rumble! has no HTTP or WebSocket API. Its only supported integration hook is **player metadata** (documented on [the Rumble! page](https://extensions.owlbear.rodeo/rumble), “Outside Extension Integration”):

```js
metadata["com.battle-system.friends/metadata_diceroll"] = {
  notation: "2d20kh1",
  created: new Date().toISOString(),
  sender: "Dice Bridge",
};
```

Player metadata can only be written through `@owlbear-rodeo/sdk` (`OBR.player.setMetadata`). That SDK is not a general-purpose client: it expects Owlbear Rodeo to load it as an extension iframe with an `?obrref=<base64(origin roomId)>` parameter, and it then exchanges messages with `window.parent` only after the host sends `OBR_READY`. A content script injected into the OBR tab gets no ref and no `OBR_READY`, so `OBR.isAvailable` is `false` forever.

Making the browser extension write the metadata itself would therefore mean faking OBR's extension handshake — undocumented, fragile internals that break on any OBR update. Instead:

- the **browser extension** does capture, validation and tab routing;
- the **companion OBR extension** is loaded into the room (one paste of a manifest URL) and owns the SDK call.

That extra install is the honest price of staying on supported APIs, and it is a one-time setup.

```
 ┌──────────────── web page ────────────────┐
 │ content-source.js                        │
 │  selection → dice parser → floating chip │
 └───────────────┬──────────────────────────┘
                 │ chrome.runtime.sendMessage
 ┌───────────────▼──────────────────────────┐
 │ background.js (service worker)           │
 │  validate again · pick room tab · badge  │
 └───────────────┬──────────────────────────┘
                 │ chrome.tabs.sendMessage
 ┌───────────────▼───── Owlbear Rodeo tab ──────────────────────┐
 │ content-bridge.js                                            │
 │  finds receiver iframe · postMessage(roll) · waits for ack   │
 │        │                                     ▲               │
 │        ▼                                     │ ack           │
 │  companion iframe (receiver.js) ─────────────┘               │
 │   OBR.player.setMetadata({                                   │
 │     "com.battle-system.friends/metadata_diceroll": {...} })  │
 │        │                                                     │
 │        ▼                                                     │
 │  Rumble! sees the player change and rolls                    │
 └──────────────────────────────────────────────────────────────┘
```

There is deliberately **no server**: rolls move through `chrome.runtime` messaging and `postMessage` between the extension and the receiver in the same tab.

---

## What counts as a dice roll input

The page is never scraped. Only a user selection (or an explicit popup entry) is read:

- select text containing notation → floating chip appears next to the selection;
- select text inside an `<input>` / `<textarea>` (password fields are excluded) → same chip;
- right-click a selection → “Roll *…* in Owlbear Rodeo”;
- `Alt+Shift+R` on a selection;
- type or paste notation in the toolbar popup, Enter to send.

The parser (`src/shared/dice.js`) normalizes case, whitespace, unicode minuses, `/roll` prefixes, quotes and trailing punctuation, and understands:

```
expression := term (('+' | '-') term)*
term       := number | dice
dice       := [count] 'd' sides modifier*
modifier   := ('kh'|'kl'|'dh'|'dl') count | ('r'|'ro')[<|>|=]number | '!'
```

- `1d20`, `2D6 + 3`, `2d20kh1+5`, `4d6dl1`, `1d8+1d6+3`, `10d10ro<2+3`, `1d6!`
- `/r 2d20kh1`, `roll a d20.`, `1d20 with advantage` → `2d20kh1`, `disadvantage` → `2d20kl1`
- prose: `Fireball: 8d6 fire damage` extracts `8d6`

Limits: 120 characters, 100 dice, d2–d1000, modifiers ≤ 9999. Anything outside the grammar — `1d20*2`, comparisons, unknown letters — is rejected instead of being forwarded, and the error is shown in the popup/chip so the user is never left guessing.

The bridge never generates results. Rumble! is the single source of truth for the roll.

---

## Protocol (extension ↔ receiver)

All messages are `{ v: 1, type, … }` and validated on both sides: allowed-type list, protocol version, field types, length caps. The receiver only accepts messages whose `event.source === window.parent` and whose origin is Owlbear Rodeo (or loopback, for a dev room).

| Type | Direction | Payload | Purpose |
| --- | --- | --- | --- |
| `dice-bridge/hello` | receiver → parent | `roomId`, `playerId` | Announces the receiver; sent on SDK ready, every 5 s, on visibility change, and in reply to a ping |
| `dice-bridge/ping` | bridge → receiver | — | Discovery when no hello has been seen (scans iframes, including open shadow roots) |
| `dice-bridge/roll` | bridge → receiver | `notation`, `sender`, `requestId` | Ask for a roll |
| `dice-bridge/ack` | receiver → bridge | `requestId`, `ok`, `detail` | Confirm or explain the failure |

Reliability details:

- the bridge waits up to 1.5 s for discovery, 2.5 s for an ack, then pings once more and retries **with the same `requestId`**;
- the receiver caches request ids and re-sends the original ack, so a retry never double-rolls;
- every failure has a distinct user-facing reason: no room tab, room tab without a receiver, timeout, or rejection with the OBR error message.

`created` in the Rumble payload is not decoration: Owlbear Rodeo only pushes a metadata change when the value differs, so the same notation rolled twice needs a fresh timestamp or the second roll is silently dropped. The sender is stripped of tags, control characters and anything past 40 characters because Rumble! renders it in its chat log.

---

## Setup

Requirements: Node 20+, Chrome or Edge (Firefox needs a manifest variant, see Limitations).

```bash
npm install
npm test          # parser / payload / protocol unit tests
npm run build     # → dist/extension and dist/companion
```

### No Node? Load the prebuilt copy

`npm run build` also refreshes **`prebuilt/extension`**, a committed copy of the built browser extension. So without installing anything: download the repository (**Code → Download ZIP**), extract it, and point **Load unpacked** at `prebuilt/extension`. It is exactly as current as the last build, so `git pull` is enough to update it.

### 1. Host the companion

Any static HTTPS host works (Netlify, Vercel, GitHub Pages, an S3 bucket). It must answer cross-origin GETs, because Owlbear Rodeo fetches the manifest from its own origin.

```bash
npm run serve:companion        # http://localhost:8788 for a quick local check
```

For local development Chrome may block the room's HTTPS page from framing `http://localhost` (Private Network Access / mixed content). If the receiver never shows up, host the folder on HTTPS instead.

### 2. Add the receiver to your room

1. Owlbear Rodeo → **Extensions** → add an extension by manifest URL: `https://your-host/manifest.json`.
2. Install **Rumble!** in the same room — the receiver only writes Rumble's metadata; Rumble does the rolling.
3. Open the Dice Bridge action once to see the receiver status panel (and a test roll).

### 3. Load the browser extension

`chrome://extensions` → Developer mode → **Load unpacked** → `dist/extension`.

Open the extension's settings and set **Receiver origin** to your companion host (origin only, e.g. `https://dice-bridge.example.com`). Optionally set a preferred room URL or code.

### 4. Roll

Open the room tab, select `1d20+5` on any page, click the chip. The toolbar badge shows `✓` on success or `!` with the reason on failure, and the popup shows the receiver/room status.

---

## Verification status

Checked in this repo:

- `npm test` — 15 unit tests over the notation parser (grammar, advantages, prose extraction, limits, rejection cases), the Rumble metadata payload (including the “same notation twice must differ” property) and the wire protocol (origin allowlist, malformed/hostile message rejection, ack normalization).
- `npm run build` — both bundles compile with esbuild; the companion bundles the real `@owlbear-rodeo/sdk` v3.

Not verifiable without a live room, an OBR account and Rumble installed — these are the checks to run first:

1. Receiver iframe loads from `background_url` **without** the popover being open, and appears in the room for every player who adds the extension.
2. A roll from the chip produces a Rumble roll in the room for all clients, and two identical rolls in a row both register.
3. Rumble must be installed; without it the metadata write still succeeds (the bridge reports “sent”, not “rolled”).
4. OBR page reloads: the receiver re-announces within 5 s and rolls still arrive.

That last point is the main behavioural assumption: `background_url` is documented by OBR, but whether it persists per room member can only be confirmed live. If a room does not keep the background page alive, opening the Dice Bridge action popover keeps a receiver loaded — and the status line in the popup tells you which state you are in.

## Limitations

- **Results are not read back.** Rumble! publishes no result metadata, so the bridge can confirm “Rumble accepted the roll”, not the total. (Bones! exposes `metadata_logroll`, which would make totals possible.)
- **One receiver per tab**, top frame only: selections inside cross-origin iframes are not captured (use the popup there).
- **Same browser only.** The bridge is local by design; rolling from a phone or another device would need a relay transport (WebSocket/SSE + a session code) instead of `postMessage`.
- **Chrome/Edge only.** Firefox needs `background.scripts` instead of `service_worker` and `browser_specific_settings`; Safari needs a converter. The shared modules are browser-API free, so only the glue changes.
- If Rumble! changes its metadata key or payload, `src/shared/rumble.js` is the single place to update.

## Layout

```
src/shared/       dice parser · Rumble payload · postMessage protocol (no browser APIs, unit tested)
src/extension/    MV3 manifest, service worker, page content script, OBR bridge, popup, options
src/companion/    OBR extension: receiver, SDK write, status popover, OBR manifest
test/             node:test suites
prebuilt/         committed build of the browser extension (refreshed by npm run build)
build.mjs         esbuild build for both halves
tools/serve.mjs   dependency-free static server for the companion
```
