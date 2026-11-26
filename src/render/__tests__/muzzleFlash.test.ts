import { Array, Match, Option, Record } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { gunSprite } from '#art/sprites/guns.ts'
import type * as Draw from '#render/draw.ts'
import { type Leaf, flatten } from '#render/iso/flatten.ts'
import { flameSpecsOf } from '#render/iso/lightSpecs.ts'
import {
  CAMERA_UP,
  UNIT,
  type Vec3,
  standingPointOf,
} from '#render/iso/space.ts'
import {
  muzzlePointOf,
  playerFlashDrawable,
  playerFootY,
  playerShapes,
} from '#render/playerView.ts'
import { candelabraShapes } from '#render/room/diningArt.ts'
import { coverBlocks } from '#render/room/roomCover.ts'
import { FLAME_COLOR } from '#render/room/roomPalette.ts'
import { holdingSecond } from '#test/arsenals.ts'
import { decodePng } from '#test/testPng.ts'
import { WEAPONS, freshGun } from '#world/gear/weapons.ts'
import { levelOf } from '#world/level/arena.ts'
import { modifyFocus } from '#world/party/party.ts'
import type { Vector, WeaponKind } from '#world/schema/worldSchema.ts'

const FACINGS: ReadonlyArray<Vector> = Array.makeBy(8, index => ({
  x: Math.round(Math.cos((index * Math.PI) / 4) * 1000) / 1000,
  y: Math.round(Math.sin((index * Math.PI) / 4) * 1000) / 1000,
}))

const GUNS: ReadonlyArray<WeaponKind> = Array.filter(
  Record.keys(WEAPONS),
  kind => kind !== 'Pan',
)

const firing = (kind: WeaponKind, facing: Vector): Model =>
  modifyFocus(initialModel, {
    player: player =>
      UiStruct.evolve(player, {
        x: () => 200,
        y: () => 100,
        facing: () => facing,
        arsenal: () => holdingSecond(freshGun(kind)),
        recoilRemainingMs: () => WEAPONS[kind].recoilMs,
      }),
  })

const playerOf = (model: Model) => model.seats[0].player

const screenOf = (point: Vec3): Vector => ({
  x: point.x / UNIT,
  y:
    -(point.x * CAMERA_UP.x + point.y * CAMERA_UP.y + point.z * CAMERA_UP.z) /
    UNIT,
})

const applied = ({ a, b, c, d, e, f }: Leaf['matrix'], at: Vector): Vector => ({
  x: a * at.x + c * at.y + e,
  y: b * at.x + d * at.y + f,
})

const imageSources = (shapes: ReadonlyArray<Draw.Shape>): Set<string> =>
  new Set(
    Array.flatMap(flatten(shapes), ({ shape }) =>
      Match.value(shape).pipe(
        Match.tag('Image', ({ src }) => [src]),
        Match.orElse(() => []),
      ),
    ),
  )

const gunPixels = (model: Model, kind: WeaponKind): ReadonlyArray<Vector> => {
  const { facing } = playerOf(model)
  const gunSources = imageSources(
    gunSprite(kind, 0, Math.atan2(facing.y, facing.x)),
  )
  return Array.flatMap(flatten(playerShapes(model)), leaf =>
    Match.value(leaf.shape).pipe(
      Match.tag('Image', image =>
        gunSources.has(image.src)
          ? Option.match(decodePng(image.src), {
              onNone: () => [],
              onSome: ({ width, pixels }) => {
                const crop = image.crop ?? {
                  x: 0,
                  y: 0,
                  width: image.width,
                  height: image.height,
                }
                return Array.flatMap(pixels, ({ a }, index) => {
                  const column = (index % width) - crop.x
                  const row = Math.floor(index / width) - crop.y
                  return a > 0 &&
                    column >= 0 &&
                    row >= 0 &&
                    column < crop.width &&
                    row < crop.height
                    ? [
                        applied(leaf.matrix, {
                          x: image.x + column + 0.5,
                          y: image.y + row + 0.5,
                        }),
                      ]
                    : []
                })
              },
            })
          : [],
      ),
      Match.orElse(() => []),
    ),
  )
}

const flashMiddle = (model: Model): Vector => {
  const corners = Array.flatMap(
    flatten(playerFlashDrawable(playerOf(model)).shapes),
    leaf =>
      Match.value(leaf.shape).pipe(
        Match.tag('Rect', ({ x, y, width, height }) => [
          applied(leaf.matrix, { x, y }),
          applied(leaf.matrix, { x: x + width, y: y + height }),
        ]),
        Match.orElse(() => []),
      ),
  )
  const xs = Array.map(corners, ({ x }) => x)
  const ys = Array.map(corners, ({ y }) => y)
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
}

const along = (point: Vector, facing: Vector): number =>
  point.x * facing.x + point.y * facing.y

const across = (point: Vector, facing: Vector): number =>
  point.y * facing.x - point.x * facing.y

describe('the muzzle flash', () => {
  test("stands on its player's own plane, as the gun does", () => {
    Array.forEach(GUNS, kind =>
      Array.forEach(FACINGS, facing => {
        const player = playerOf(firing(kind, facing))
        const drawable = playerFlashDrawable(player)
        expect(drawable.rank).toBe('Glow')
        const nearer = drawable.footY - playerFootY(player)
        expect(nearer).toBeGreaterThanOrEqual(0)
        expect(nearer).toBeLessThanOrEqual(1)
      }),
    )
  })

  test("flares just past the gun's drawn tip, for every gun and way it faces", () => {
    Array.forEach(GUNS, kind =>
      Array.forEach(FACINGS, facing => {
        const model = firing(kind, facing)
        const gun = gunPixels(model, kind)
        expect(gun.length).toBeGreaterThan(0)
        const tipAlong = Math.max(
          ...Array.map(gun, pixel => along(pixel, facing)),
        )
        const tip = Option.getOrThrow(
          Array.findFirst(gun, pixel => along(pixel, facing) === tipAlong),
        )
        const middle = flashMiddle(model)
        const past = along(middle, facing) - tipAlong
        const off = Math.abs(across(middle, facing) - across(tip, facing))
        expect({ kind, facing, past: past > 0 && past <= 3 }).toEqual({
          kind,
          facing,
          past: true,
        })
        expect({ kind, facing, off: off <= 1.5 }).toEqual({
          kind,
          facing,
          off: true,
        })
      }),
    )
  })

  test('shows in 3D on the pixel the 2D game drew it on', () => {
    Array.forEach(GUNS, kind =>
      Array.forEach(FACINGS, facing => {
        const player = playerOf(firing(kind, facing))
        const muzzle = muzzlePointOf(player)
        const shown = screenOf(
          standingPointOf({
            x: muzzle.x,
            footY: playerFlashDrawable(player).footY,
            atY: muzzle.y,
            out: 0.8,
          }),
        )
        expect(shown.x).toBeCloseTo(muzzle.x, 6)
        expect(shown.y).toBeCloseTo(muzzle.y, 6)
      }),
    )
  })
})

describe('anything standing', () => {
  test('shows on its own 2D pixel, whatever row it stands on and however near the lens', () => {
    Array.forEach([0, 37, 250.5], footY =>
      Array.forEach([-3, 0, 12.5, 80], atY =>
        Array.forEach([0, 0.8, 2], out => {
          const shown = screenOf(standingPointOf({ x: 41, footY, atY, out }))
          expect(shown.x).toBeCloseTo(41, 6)
          expect(shown.y).toBeCloseTo(atY, 6)
        }),
      ),
    )
  })
})

describe('a candelabra', () => {
  test('lights from its middle flame, on the pixel its art draws it', () => {
    const level = levelOf(initialModel)
    const candles = Array.filter(
      flameSpecsOf(level),
      ({ kind }) => kind === 'Candle',
    )
    const boxes = coverBlocks(level, 'i')
    expect(candles.length).toBe(boxes.length)
    expect(candles.length).toBeGreaterThan(0)
    Array.forEach(Array.zip(candles, boxes), ([candle, box]) => {
      const shown = screenOf(candle)
      const flames = Array.flatMap(candelabraShapes(box), shape =>
        Match.value(shape).pipe(
          Match.tag('Rect', rect =>
            rect.fill === FLAME_COLOR
              ? [{ x: rect.x + 0.5, y: rect.y + 0.5 }]
              : [],
          ),
          Match.orElse(() => []),
        ),
      )
      expect(
        Array.some(
          flames,
          flame =>
            Math.abs(flame.x - shown.x) < 1e-6 &&
            Math.abs(flame.y - shown.y) < 1e-6,
        ),
      ).toBe(true)
    })
  })
})
