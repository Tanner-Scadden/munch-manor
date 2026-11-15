// The manor's small lives: moths circling every lit flame, the candles',
// the chandelier's, and the cellar's bulb, fluttering in and out of the
// light. Each is read off the World's clock and the level alone, with no
// state, so every player in a co-op room sees the same moths.

import { Array } from 'effect'

import type { Level } from '../../world/level/arena'
import type { World } from '../../world/schema/worldSchema'
import type { Mote } from './air'
import { type FlameKind, flameSpecsOf, isFlameLit } from './lightSpecs'
import { unitOf } from './mood'

// NOTE: how many moths each kind of flame draws, how wide they circle it,
// and how high its light hangs over its spot on screen, in game pixels. A
// candle draws one only now and then.
const MOTHS: Readonly<
  Record<FlameKind, Readonly<{ count: number; reach: number; lift: number }>>
> = {
  Candle: { count: 1, reach: 6, lift: 23 },
  Chandelier: { count: 4, reach: 16, lift: 12 },
  Bulb: { count: 3, reach: 9, lift: 28 },
  Hearth: { count: 0, reach: 0, lift: 0 },
  Sconce: { count: 0, reach: 0, lift: 0 },
  Oven: { count: 0, reach: 0, lift: 0 },
}

// NOTE: the share of candles a moth finds.
const CANDLE_SHARE = 0.4

const MOTH_COLOR = 0xe8dcc0
// NOTE: a moth stands this far in front of its flame and that much higher,
// the same spot on screen, so it never passes behind the stand it circles.
const MOTH_FORWARD = 10

const rollOf = (flame: number, moth: number, use: number): number =>
  unitOf(flame * 2053 + moth * 17 + use + 7919)

export const crittersOf = ({
  world,
  level,
}: Readonly<{ world: World; level: Level }>): ReadonlyArray<Mote> => {
  const seconds = world.elapsedMs / 1000
  return Array.flatMap(flameSpecsOf(level), (spec, flame) => {
    const { count, reach, lift } = MOTHS[spec.kind]
    const isVisited =
      spec.kind !== 'Candle' || rollOf(flame, 0, 0) < CANDLE_SHARE
    if (count === 0 || !isVisited || !isFlameLit(world, spec.kind)) {
      return []
    }
    return Array.makeBy(count, moth => {
      const speed =
        (2.4 + rollOf(flame, moth, 1) * 2.2) * (moth % 2 === 0 ? 1 : -1)
      const phase = rollOf(flame, moth, 2) * Math.PI * 2
      // NOTE: an erratic loop: the angle lurches and the circle breathes,
      // now and then a dart out past the light.
      const angle = seconds * speed + Math.sin(seconds * 3.1 + phase) * 0.9
      const dart = Math.max(0, Math.sin(seconds * 0.7 + phase)) ** 6
      const radius =
        reach * (0.55 + 0.3 * Math.sin(seconds * 1.9 + phase) + dart)
      return {
        x: spec.spot.x + Math.cos(angle) * radius,
        y: spec.spot.y + MOTH_FORWARD,
        hover:
          lift +
          MOTH_FORWARD +
          Math.sin(angle) * radius * 0.6 +
          Math.sin(seconds * 7 + phase) * 1.5,
        // NOTE: its wings beat, two pixels open and one shut.
        width: Math.sin(seconds * 31 + phase * 5) > 0 ? 2 : 1,
        color: MOTH_COLOR,
        alpha: 1,
        isGlowing: false,
      }
    })
  })
}
