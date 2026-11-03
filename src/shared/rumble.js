/**
 * The Rumble! integration contract.
 *
 * Rumble! documents an "Outside Extension Integration" hook: any extension can
 * drop a player-metadata object under this key and Rumble! performs the roll.
 * Keys and payload shape come from
 * https://extensions.owlbear.rodeo/rumble → "Outside Extension Integration".
 */

export const RUMBLE_DICE_KEY = "com.battle-system.friends/metadata_diceroll";
export const RUMBLE_CHAT_KEY = "com.battle-system.friends/metadata_chatlog";
export const PARTY_TARGET = "0000";
export const MAX_SENDER_LENGTH = 40;

/**
 * Rumble! renders the sender in its chat log, so keep it plain text: drop tags,
 * angle brackets, control characters and runaway length.
 */
export function sanitizeSender(value, fallback = "Dice Bridge") {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/<[^>]*>/g, "")
    .replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SENDER_LENGTH);
  return cleaned || fallback;
}

/**
 * Build the partial player-metadata update Rumble! watches.
 *
 * `created` is not decoration: Owlbear Rodeo only pushes a metadata change when
 * the value differs, so rolling the same notation twice needs a fresh stamp or
 * the second roll is swallowed.
 */
export function buildRumbleDiceMetadata({ notation, sender, now = new Date() }) {
  return {
    [RUMBLE_DICE_KEY]: {
      notation: String(notation),
      created: now.toISOString(),
      sender: sanitizeSender(sender),
    },
  };
}

/** Optional chat line, handy when a roll needs a label ("Fireball"). */
export function buildRumbleChatMetadata({ text, sender, targetId = PARTY_TARGET, now = new Date() }) {
  return {
    [RUMBLE_CHAT_KEY]: {
      chatlog: String(text),
      created: now.toISOString(),
      sender: sanitizeSender(sender),
      targetId,
    },
  };
}
