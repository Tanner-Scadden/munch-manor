// The KABOOM in 3D: a blast as a ball of glowing blocks that bursts out and
// up, cools from white through yellow and orange to red, and rolls off as
// smoke, a ring of sparks racing out along the floor, and a flash of light
// over the room. Read off the blast alone (its spot, its size, its age), with
// no state, so the same frame draws the same blast, and every player in a
// co-op room sees the same one.

import { Array, Option } from 'effect'

import { BLAST_FLASH_MS } from '../../shared/constants'
import type { Blast } from '../../world/schema/worldSchema'
import { easeOut } from '../../world/step/geometry'
import { unitOf } from './mood'

// NOTE: one block of the blast: its spot on the floor, how high it hangs, its
// width and height, in whole game pixels (as deep as it is wide), its color,
// and how brightly it glows (0 for smoke, which the room's light falls on
// instead).
export type BlastPiece = Readonly<{
  x: number
  footY: number
  rise: number
  width: number
  height: number
  color: number
  glow: number
}>

// NOTE: the fireball's blocks, the smoke's, and the ring's sparks.
const FIRE_COUNT = 40
const SMOKE_COUNT = 12
const RING_COUNT = 24

// NOTE: the flash's first beat, white hot, as the 2D game drew it.
const FLASH_MS = 60

// NOTE: the fireball's reach at its widest, as a share of the blast's radius:
// the blocks fill the ring the blast hurts, not past it.
const BALL_REACH = 0.8

// NOTE: from hottest to coolest, each with its glow. The bloom picks up a
// glow over 2.
const HEAT: ReadonlyArray<
  Readonly<{ above: number; color: number; glow: number }>
> = [
  { above: 0.8, color: 0xfff6d0, glow: 5 },
  { above: 0.6, color: 0xffd84a, glow: 3.5 },
  { above: 0.4, color: 0xff8a2e, glow: 2.5 },
  { above: 0.2, color: 0xd8401e, glow: 1.4 },
  { above: 0.08, color: 0x6a2418, glow: 0.6 },
]
const SMOKE_COLOR = 0x4a4446
const RING_COLOR = 0xfff0b8

const heatOf = (heat: number): Readonly<{ color: number; glow: number }> =>
  Option.getOrElse(
    Array.findFirst(HEAT, step => heat > step.above),
    () => ({ color: SMOKE_COLOR, glow: 0 }),
  )

// NOTE: a blast's own rolls: the same spot rolls the same blocks.
const seedOf = (blast: Blast): number =>
  Math.imul(Math.round(blast.x), 73856093) ^
  Math.imul(Math.round(blast.y), 19349663)

// NOTE: how far through its life a blast is, 0 to 1.
const progressOf = (blast: Blast): number =>
  Math.min(1, Math.max(0, blast.ageMs / BLAST_FLASH_MS))

// NOTE: a block placed by where it shows on screen: `across` and `up` from
// the ball's middle, which hangs `middle` pixels over the floor. A block's
// top shows as tall as its front, so it hangs by its middle. Its foot stays
// on the blast's own row, a pixel or two either way, so the ball reads round
// rather than as a column climbing north.
const placed = (
  input: Readonly<{
    blast: Blast
    across: number
    up: number
    middle: number
    depth: number
    size: number
  }>,
): Readonly<{ x: number; footY: number; rise: number }> => {
  const { blast, across, up, middle, depth, size } = input
  return {
    x: Math.round(blast.x + across),
    footY: Math.round(blast.y + depth),
    rise: Math.max(0, Math.round(middle + up + depth - size)),
  }
}

export const blastPiecesOf = (blast: Blast): ReadonlyArray<BlastPiece> => {
  const seed = seedOf(blast)
  const roll = (index: number, salt: number): number =>
    unitOf(seed + index * 131 + salt * 7919)
  const progress = progressOf(blast)
  const spread = easeOut(progress)
  const reach = blast.radius * BALL_REACH
  const isFlash = blast.ageMs < FLASH_MS
  // NOTE: the ball hangs low and climbs a little as it burns.
  const middle = reach * 0.45 + progress * 6
  const fire = Array.makeBy(FIRE_COUNT, (index): BlastPiece => {
    const turn = roll(index, 1) * Math.PI * 2
    const out = Math.sqrt(roll(index, 2)) * reach * (0.25 + 0.75 * spread)
    // NOTE: the middle burns longest, the rim cools first.
    const rim = out / Math.max(1, reach)
    const heat = isFlash
      ? 1
      : 1.05 - progress * 1.1 - rim * 0.3 - roll(index, 4) * 0.15
    const { color, glow } = heatOf(heat)
    const size = Math.max(
      1,
      Math.round((2 + 3 * roll(index, 5)) * (1 - progress * 0.6)),
    )
    return {
      ...placed({
        blast,
        across: Math.cos(turn) * out,
        up: Math.sin(turn) * out * 0.85,
        middle,
        depth: Math.round((roll(index, 3) - 0.5) * 4),
        size,
      }),
      width: size,
      height: size,
      color,
      glow,
    }
  })
  // NOTE: the smoke rolls up off the top of the fire once it has cooled a
  // little, growing as it climbs, then thinning to nothing.
  const smoke =
    progress < 0.35
      ? []
      : Array.makeBy(SMOKE_COUNT, (index): BlastPiece => {
          const age = (progress - 0.35) / 0.65
          const turn = roll(index, 11) * Math.PI * 2
          const out = Math.sqrt(roll(index, 12)) * reach * 0.6
          const size = Math.max(
            1,
            Math.round((2 + 3 * roll(index, 14)) * (1 + age) * (1 - age * age)),
          )
          return {
            ...placed({
              blast,
              across: Math.cos(turn) * out,
              up: Math.sin(turn) * out * 0.5 + reach * 0.4 + age * 14,
              middle,
              depth: Math.round((roll(index, 13) - 0.5) * 4),
              size,
            }),
            width: size,
            height: size,
            color: SMOKE_COLOR,
            glow: 0,
          }
        })
  // NOTE: the shockwave, flat sparks racing out along the floor, gone by
  // halfway.
  const ring =
    progress > 0.5
      ? []
      : Array.makeBy(RING_COUNT, (index): BlastPiece => {
          const turn = (index / RING_COUNT) * Math.PI * 2
          const out = blast.radius * (0.4 + 0.9 * spread)
          return {
            x: Math.round(blast.x + Math.cos(turn) * out),
            footY: Math.round(blast.y + Math.sin(turn) * out),
            rise: 0,
            width: progress < 0.25 ? 3 : 2,
            height: 1,
            color: RING_COLOR,
            glow: 3 * (1 - progress * 2),
          }
        })
  return [...fire, ...smoke, ...ring]
}

// NOTE: how bright a blast lights the room, 0 to 1: everything at once,
// then gone fast.
export const blastLightOf = (blast: Blast): number => {
  const fade = 1 - progressOf(blast)
  return fade * fade
}
