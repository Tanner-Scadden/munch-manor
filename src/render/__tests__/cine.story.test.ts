import { Array, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Boss, type Model, Phase } from '#app/model.ts'
import { cameraOf } from '#render/camera.ts'
import {
  FINISHER_CINE_MS,
  cineBarShapes,
  cineWeightOf,
  glideCamera,
} from '#render/cine.ts'
import { STILL_GLIDE } from '#render/renderSchema.ts'
import { playingModel, withPlayerAt, withZombies } from '#test/model.fixture.ts'
import {
  FRAME_MS,
  bulletInto,
  checkModel,
  modelAfter,
  openFloorSpot,
  steps,
  tick,
  ticks,
  zombieAt,
} from '#test/testing.ts'
import { levelOf } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'

const ENTRANCE_MS = 2600

const arrivingAt = (model: Model, remainingMs: number): Model =>
  UiStruct.evolve(model, {
    boss: () =>
      Boss.Arriving({
        door: 'Front',
        hp: 100,
        guestHpScale: 1,
        remainingMs,
        durationMs: ENTRANCE_MS,
      }),
  })

const midRoom = withPlayerAt(playingModel, 180, 90)

const centerOf = (model: Model) => {
  const { x, y, width, height } = cameraOf(model)
  return { x: x + width / 2, y: y + height / 2, width, height }
}

describe('the cinematic camera', () => {
  it('eases in from nothing, holds, and eases out to nothing', () => {
    expect(cineWeightOf(0)).toBe(0)
    expect(cineWeightOf(0.5)).toBe(1)
    expect(cineWeightOf(1)).toBe(0)
    expect(cineWeightOf(0.1)).toBeLessThan(cineWeightOf(0.2))
    expect(cineWeightOf(0.9)).toBeLessThan(cineWeightOf(0.8))
  })

  it.effect(
    "glides toward the boss's door, keeps the player in the window, and comes home",
    () => {
      const door = levelOf(midRoom).doors.Front.center
      const still = centerOf(midRoom)
      return modelAfter(
        arrivingAt(midRoom, ENTRANCE_MS),
        steps(
          ticks(45, FRAME_MS),
          checkModel(current => {
            const glided = centerOf(current)
            expect(Math.abs(glided.y - door.y)).toBeLessThan(
              Math.abs(still.y - door.y),
            )
            const camera = cameraOf(current)
            const { player } = focusOf(current)
            expect(player.x).toBeGreaterThan(camera.x)
            expect(player.x).toBeLessThan(camera.x + camera.width)
            expect(player.y).toBeGreaterThan(camera.y)
            expect(player.y).toBeLessThan(camera.y + camera.height)
          }),
          ticks(Math.ceil(ENTRANCE_MS / FRAME_MS) + 120, FRAME_MS),
          checkModel(({ cameraGlide }) => {
            expect(cameraGlide).toEqual(STILL_GLIDE)
          }),
        ),
      )
    },
  )

  it('springs the same at any frame rate and never overshoots', () => {
    const pull = { x: 100, y: -40 }
    const at60 = Array.reduce(
      Array.makeBy(60, () => 1000 / 60),
      STILL_GLIDE,
      (glide, deltaMs) => glideCamera(glide, pull, deltaMs),
    )
    const at120 = Array.reduce(
      Array.makeBy(120, () => 1000 / 120),
      STILL_GLIDE,
      (glide, deltaMs) => glideCamera(glide, pull, deltaMs),
    )
    expect(at60.offset.x).toBeCloseTo(at120.offset.x, 6)
    expect(at60.offset.y).toBeCloseTo(at120.offset.y, 6)
    const path = Array.scan(
      Array.makeBy(240, () => FRAME_MS),
      STILL_GLIDE,
      (glide, deltaMs) => glideCamera(glide, pull, deltaMs),
    )
    Array.forEach(path, ({ offset }) => {
      expect(offset.x).toBeLessThanOrEqual(pull.x)
      expect(offset.y).toBeGreaterThanOrEqual(pull.y)
    })
    expect(path[path.length - 1]).toEqual({
      offset: pull,
      velocity: { x: 0, y: 0 },
    })
  })

  it('a moment ending while another plays moves the view a little a frame, never a jump', () => {
    const toKey = Array.reduce(
      Array.makeBy(40, () => FRAME_MS),
      STILL_GLIDE,
      (glide, deltaMs) => glideCamera(glide, { x: 0, y: 42 }, deltaMs),
    )
    const toBlow = Array.scan(
      Array.makeBy(60, () => FRAME_MS),
      toKey,
      (glide, deltaMs) => glideCamera(glide, { x: -112, y: -20 }, deltaMs),
    )
    Array.forEach(Array.zip(toBlow, Array.drop(toBlow, 1)), ([from, to]) => {
      expect(
        Math.hypot(to.offset.x - from.offset.x, to.offset.y - from.offset.y),
      ).toBeLessThan(5)
    })
  })

  it('slides its bars in with the moment and out again', () => {
    const world = { x: 0, y: 0, width: 320, height: 180 }
    expect(cineBarShapes({ model: playingModel, world })).toEqual([])
    expect(
      cineBarShapes({
        model: arrivingAt(playingModel, ENTRANCE_MS / 2),
        world,
      }),
    ).toHaveLength(2)
  })

  const victim = UiStruct.evolve(
    zombieAt(300, openFloorSpot(0).x, openFloorSpot(0).y, {
      speed: 0,
    }),
    {
      hp: () => 1,
    },
  )
  const lastBlow = UiStruct.evolve(withZombies(playingModel, [victim]), {
    bullets: () => [bulletInto(301, victim)],
    phase: phase =>
      Phase.isAnyOf(['Wave'])(phase)
        ? UiStruct.evolve(phase, { spawns: () => [] })
        : phase,
  })

  it.effect("glides to the wave's last blow, then lets it go", () =>
    modelAfter(
      lastBlow,
      steps(
        tick(FRAME_MS),
        checkModel(({ maybeFinisher }) => {
          expect(Option.map(maybeFinisher, ({ x, y }) => ({ x, y }))).toEqual(
            Option.some({ x: victim.x, y: victim.y }),
          )
        }),
        ticks(Math.ceil(FINISHER_CINE_MS / FRAME_MS) + 1, FRAME_MS),
        checkModel(({ maybeFinisher }) => {
          expect(Option.isNone(maybeFinisher)).toBe(true)
        }),
      ),
    ),
  )

  it('a quiet frame starts no glide', () => {
    expect(
      Array.every([playingModel], model => Option.isNone(model.maybeFinisher)),
    ).toBe(true)
  })
})
