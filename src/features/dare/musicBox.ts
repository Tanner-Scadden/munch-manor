import { Function, Option } from 'effect'

import type { Model } from '../../app/model'
import { maybeTuneSpot } from '../../world/dare/dare'
import { focusOf } from '../../world/party/party'
import { clamp, distanceBetween } from '../../world/step/geometry'
import { isRoundActive } from '../../world/waves/waves'

// The music box (src/world/dare/dare.ts) plays its tune from its spot in
// the parlour until someone picks it up, as flavor: like every thing on the
// list it is found by opening its room. A client cue read off the World,
// never fed back, so every player hears it from where their own player
// stands, on a beat, louder the nearer the player is and panned to its
// side, and not past its reach.

const TUNE_BEAT_MS = 2400
const TUNE_REACH_PX = 200
const TUNE_PAN_PX = 120
const TUNE_MIN_VOLUME = 0.08

export type TunePlacement = Readonly<{ volume: number; pan: number }>

const beatOf = (elapsedMs: number): number =>
  Math.floor(elapsedMs / TUNE_BEAT_MS)

// NOTE: the tune's next play between two frames, if a beat falls between
// them and the focused player is in its reach.
export const maybeTuneCue: {
  (after: Model): (before: Model) => Option.Option<TunePlacement>
  (before: Model, after: Model): Option.Option<TunePlacement>
} = Function.dual(
  2,
  (before: Model, after: Model): Option.Option<TunePlacement> =>
    beatOf(after.elapsedMs) !== beatOf(before.elapsedMs) &&
    isRoundActive(after.phase)
      ? Option.flatMap(maybeTuneSpot(after), spot => {
          const { player } = focusOf(after)
          const distance = distanceBetween(player, spot)
          const nearness = 1 - distance / TUNE_REACH_PX
          return nearness > 0
            ? Option.some({
                volume: Math.max(TUNE_MIN_VOLUME, nearness * nearness),
                pan: clamp((spot.x - player.x) / TUNE_PAN_PX, -1, 1),
              })
            : Option.none()
        })
      : Option.none(),
)
