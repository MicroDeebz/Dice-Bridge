/**
 * The only place in the project that writes to Owlbear Rodeo.
 *
 * Rumble! watches its own player-metadata key and performs the roll itself, so
 * "rolling" here means: validate, stamp, publish metadata.
 */
import OBR from "@owlbear-rodeo/sdk";

import { parse } from "../shared/dice.js";
import { buildRumbleDiceMetadata } from "../shared/rumble.js";

export async function rollInRumble({ notation, sender }) {
  const parsed = parse(notation);
  if (!parsed.ok) throw new Error(parsed.error);

  await OBR.player.setMetadata(buildRumbleDiceMetadata({ notation: parsed.notation, sender }));
  return parsed.notation;
}
