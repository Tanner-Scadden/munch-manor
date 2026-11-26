import { Array, Option, Record, String } from 'effect'

import { cropSetOf, makeCropTable } from '../../art/sprite'
import {
  AURA_CENTER,
  AURA_PALETTES,
  AURA_SPRITES,
  AURA_STAMPS,
} from '../../art/sprites/auras'
import { PICKUP_SPRITES } from '../../art/sprites/pickups'
import type { BoostKind } from '../../world/schema/entitySchema'
import type * as Draw from '../draw'
import type { Affine } from './flatten'

const AURA_FRAMES =
  makeCropTable<Readonly<{ kind: BoostKind; frame: number }>>()
Array.forEach(Record.toEntries(AURA_SPRITES), ([kind, sprites]) => {
  Array.forEach(sprites, (sprite, frame) => {
    AURA_FRAMES.setSprite(sprite, { kind, frame })
  })
})

export const auraFrameOf = (
  image: Draw.Image,
): Option.Option<Readonly<{ kind: BoostKind; frame: number }>> =>
  Option.fromUndefinedOr(AURA_FRAMES.get(image))

export const isPowerupImage = cropSetOf(Record.values(PICKUP_SPRITES))

export type PowerupCube = Readonly<{
  x: number
  footY: number
  rise: number
  color: number
  glow: number
}>

const GLEAM_GLOW = 3
const AURA_GLOW = 1.2
const GLEAM = 'W'

const hexOf = (css: string): number =>
  Number.parseInt(String.slice(1, 7)(css), 16)

export const auraFeetOf = ({
  image,
  matrix,
}: Readonly<{ image: Draw.Image; matrix: Affine }>): Readonly<{
  x: number
  y: number
}> => {
  const x = image.x + AURA_CENTER.x
  const y = image.y + AURA_CENTER.y
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

export const auraCubesOf = (
  input: Readonly<{
    kind: BoostKind
    frame: number
    feet: Readonly<{ x: number; y: number }>
  }>,
): ReadonlyArray<PowerupCube> => {
  const { kind, frame, feet } = input
  const palette = AURA_PALETTES[kind]
  const stamps = Option.getOrElse(Array.get(AURA_STAMPS[kind], frame), () => [])
  const footX = Math.round(feet.x)
  const footY = Math.round(feet.y)
  return Array.flatMap(stamps, stamp => {
    const bottom = stamp.top + stamp.rows.length - 1
    const ringY = stamp.top + Math.floor(stamp.rows.length / 2)
    return Array.flatMap(stamp.rows, (row, line) =>
      Array.flatMap(Array.fromIterable(row), (symbol, column) =>
        Option.match(Option.fromNullishOr(palette[symbol]), {
          onNone: () => [],
          onSome: css => [
            {
              x: footX + stamp.left + column - AURA_CENTER.x,
              footY: stamp.isAloft ? footY : footY + ringY - AURA_CENTER.y,
              rise: stamp.isAloft
                ? AURA_CENTER.y - (stamp.top + line)
                : bottom - (stamp.top + line),
              color: hexOf(css),
              glow: symbol === GLEAM ? GLEAM_GLOW : AURA_GLOW,
            },
          ],
        }),
      ),
    )
  })
}

const SPIN_MS = 2400
const RING_MS = 3600
const RING_LIGHTS = 10
const RING_GLOW = 1.6
const RING_DEPTH = 0.5

export const pickupSpinOf = ({
  elapsedMs,
  x,
}: Readonly<{ elapsedMs: number; x: number }>): number =>
  ((elapsedMs / SPIN_MS + x / 97) % 1) * Math.PI * 2

export const pickupRingOf = (
  input: Readonly<{
    x: number
    footY: number
    radius: number
    color: number
    elapsedMs: number
  }>,
): ReadonlyArray<PowerupCube> => {
  const { x, footY, radius, color, elapsedMs } = input
  const start = -(elapsedMs / RING_MS) * Math.PI * 2
  return Array.makeBy(RING_LIGHTS, index => {
    const turn = start + (index / RING_LIGHTS) * Math.PI * 2
    return {
      x: Math.round(x + Math.cos(turn) * radius),
      footY: Math.round(footY + Math.sin(turn) * radius * RING_DEPTH),
      rise: 0,
      color,
      glow: RING_GLOW,
    }
  })
}
