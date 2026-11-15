// The air in the manor: dust drifting in every open room, catching the
// candlelight and the flashlight's beam, and embers rising off the hearths
// and the ovens. Each mote is read off the World's clock and the level
// alone, with no state, so it costs nothing to keep and every player in a
// co-op room sees the same air.

import { Array } from 'effect'

import type { Level } from '../../world/level/arena'
import type { Box } from '../../world/level/tileGrid'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import { type FlameKind, flameSpecsOf } from './lightSpecs'
import { mixColor, unitOf } from './mood'

export type Mote = Readonly<{
  // NOTE: the spot on the floor under it and its height over it, in game
  // pixels.
  x: number
  y: number
  hover: number
  color: number
  alpha: number
  // NOTE: an ember glows of itself; dust is lit, so it shows only in light.
  isGlowing: boolean
}>

// DUST

// NOTE: a room's dust: one mote for each patch of floor this many game
// pixels square, up to a cap.
const DUST_PATCH = 70
const DUST_CAP = 28
const DUST_COLOR = 0xf6e7c8

// NOTE: a mote drifts this far each way from its home, in game pixels.
const DRIFT_X = 14
const DRIFT_Y = 9

// NOTE: a whole number for each mote and use, for its rolls.
const rollOf = (room: number, mote: number, use: number): number =>
  unitOf(room * 4099 + mote * 31 + use)

const dustIn = (
  box: Box,
  room: number,
  seconds: number,
  stir: number,
): ReadonlyArray<Mote> => {
  const width = box.right - box.left
  const height = box.bottom - box.top
  const count = Math.min(
    DUST_CAP,
    Math.floor((width * height) / (DUST_PATCH * DUST_PATCH)),
  )
  return Array.makeBy(count, mote => {
    const phase = rollOf(room, mote, 0) * Math.PI * 2
    const speed = 0.12 + rollOf(room, mote, 1) * 0.16
    const homeX = box.left + rollOf(room, mote, 2) * width
    const homeY = box.top + rollOf(room, mote, 3) * height
    const twinkle = Math.sin(seconds * (0.6 + speed * 3) + phase * 1.7)
    return {
      x: homeX + Math.sin(seconds * speed + phase) * DRIFT_X * stir,
      y: homeY + Math.cos(seconds * speed * 0.8 + phase) * DRIFT_Y * stir,
      hover:
        6 +
        rollOf(room, mote, 4) * 44 +
        Math.sin(seconds * speed * 1.3 + phase * 0.5) * 5,
      color: DUST_COLOR,
      alpha: 0.4 + 0.25 * twinkle,
      isGlowing: false,
    }
  })
}

// EMBERS

// NOTE: how many embers each fire keeps in the air, and how wide it lets
// them out, in game pixels. The candles, sconces, and lights give none.
const EMBERS: Readonly<
  Record<FlameKind, Readonly<{ count: number; width: number }>>
> = {
  Hearth: { count: 12, width: 18 },
  Oven: { count: 4, width: 10 },
  Candle: { count: 0, width: 0 },
  Sconce: { count: 0, width: 0 },
  Chandelier: { count: 0, width: 0 },
  Bulb: { count: 0, width: 0 },
}

const EMBER_HOT = 0xffc25a
const EMBER_COOL = 0xc8381c
// NOTE: how high an ember climbs before it goes out, in game pixels.
const EMBER_RISE = 36
// NOTE: an ember stands this far in front of its fire and that much higher,
// the same spot on screen, so its climb never passes behind the fire's own
// art.
const EMBER_FORWARD = 14

const embersOf = (level: Level, ms: number): ReadonlyArray<Mote> =>
  Array.flatMap(flameSpecsOf(level), ({ kind, spot }, fire) =>
    Array.makeBy(EMBERS[kind].count, ember => {
      const lifeMs = 1500 + rollOf(fire, ember, 10) * 1200
      const age = (ms + rollOf(fire, ember, 11) * lifeMs) % lifeMs
      const share = age / lifeMs
      // NOTE: each life of an ember starts from its own spot.
      const life = Math.floor((ms + rollOf(fire, ember, 11) * lifeMs) / lifeMs)
      const startX =
        spot.x +
        (rollOf(fire, ember * 977 + life, 12) - 0.5) * EMBERS[kind].width
      return {
        x: startX + Math.sin(age * 0.005 + ember) * 3,
        y: spot.y + EMBER_FORWARD,
        hover: EMBER_FORWARD + 2 + share * EMBER_RISE,
        color: mixColor({ from: EMBER_HOT, to: EMBER_COOL, share }),
        alpha: 1 - share * share,
        isGlowing: true,
      }
    }),
  )

// SIFTING

// NOTE: dust shaken off the ceiling as the house rattles: this many motes
// at most, over this much floor round the viewer, each falling from the
// ceiling in this long, thicker and brighter the harder it rattles.
const SIFT_COUNT = 36
const SIFT_REACH_X = 170
const SIFT_REACH_Y = 110
const SIFT_FALL_MS = 1100
const CEILING = 64

const siftOf = (
  viewer: Vector,
  ms: number,
  rattle: number,
): ReadonlyArray<Mote> =>
  Array.makeBy(Math.round(SIFT_COUNT * rattle), mote => {
    const offset = rollOf(-1, mote, 20) * SIFT_FALL_MS
    const fall = (ms + offset) % SIFT_FALL_MS
    // NOTE: each fall of a mote comes off its own spot of the ceiling.
    const drop = Math.floor((ms + offset) / SIFT_FALL_MS)
    return {
      x: viewer.x + (rollOf(drop, mote, 21) - 0.5) * 2 * SIFT_REACH_X,
      y: viewer.y + (rollOf(drop, mote, 22) - 0.5) * 2 * SIFT_REACH_Y,
      hover: CEILING * (1 - fall / SIFT_FALL_MS),
      color: DUST_COLOR,
      alpha: Math.min(1, 0.3 + rattle),
      isGlowing: false,
    }
  })

// NOTE: the air this frame. A hotter wave stirs the dust further, and a
// rattle sifts more off the ceiling.
export const airOf = ({
  world,
  level,
  viewer,
  rattle,
}: Readonly<{
  world: World
  level: Level
  viewer: Vector
  rattle: number
}>): ReadonlyArray<Mote> => {
  const seconds = world.elapsedMs / 1000
  const stir = 1 + world.intensity * 0.8
  return [
    ...Array.flatMap(level.rooms, ({ box, isOpen }, room) =>
      isOpen ? dustIn(box, room, seconds, stir) : [],
    ),
    ...embersOf(level, world.elapsedMs),
    ...siftOf(viewer, world.elapsedMs, rattle),
  ]
}
