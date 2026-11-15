import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Boss, type Model, Phase } from '../../app/model'
import {
  playingModel,
  withPlayerAt,
  withZombies,
} from '../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  bulletInto,
  openFloorSpot,
  tick,
  ticks,
  zombieAt,
} from '../../test/testing'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { cameraOf } from '../camera'
import {
  FINISHER_CINE_MS,
  cineBarShapes,
  cineWeightOf,
  glideCamera,
} from '../cine'
import { STILL_GLIDE } from '../renderSchema'

// The camera's big moments (src/render/cine.ts): it springs partway toward
// the moment and back, never taking the player out of the window, while
// letterbox bars slide in.

const ENTRANCE_MS = 2600

const arrivingAt = (model: Model, remainingMs: number): Model =>
  modifyFields(model, {
    boss: () =>
      Boss.Arriving({
        door: 'Front',
        hp: 100,
        guestHpScale: 1,
        remainingMs,
        durationMs: ENTRANCE_MS,
      }),
  })

// NOTE: the player mid-room with the camera at the level's top, so it has
// room to glide south toward the front door before meeting the bottom.
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
      return Story.story(
        APPLICATION,
        Story.given(arrivingAt(midRoom, ENTRANCE_MS)),
        ...ticks(45, FRAME_MS),
        Story.model(current => {
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
        ...ticks(Math.ceil(ENTRANCE_MS / FRAME_MS) + 120, FRAME_MS),
        Story.model(({ cameraGlide }) => {
          expect(cameraGlide).toEqual(STILL_GLIDE)
        }),
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

  const victim = modifyFields(
    zombieAt(300, openFloorSpot(0).x, openFloorSpot(0).y, {
      speed: 0,
    }),
    {
      hp: () => 1,
    },
  )
  const lastBlow = modifyFields(withZombies(playingModel, [victim]), {
    bullets: () => [bulletInto(301, victim)],
    phase: phase =>
      Phase.isAnyOf(['Wave'])(phase)
        ? modifyFields(phase, { spawns: () => [] })
        : phase,
  })

  it.effect("glides to the wave's last blow, then lets it go", () =>
    Story.story(
      APPLICATION,
      Story.given(lastBlow),
      tick(FRAME_MS),
      Story.model(({ maybeFinisher }) => {
        expect(Option.map(maybeFinisher, ({ x, y }) => ({ x, y }))).toEqual(
          Option.some({ x: victim.x, y: victim.y }),
        )
      }),
      ...ticks(Math.ceil(FINISHER_CINE_MS / FRAME_MS) + 1, FRAME_MS),
      Story.model(({ maybeFinisher }) => {
        expect(Option.isNone(maybeFinisher)).toBe(true)
      }),
    ),
  )

  it('a quiet frame starts no glide', () => {
    expect(
      Array.every([playingModel], model => Option.isNone(model.maybeFinisher)),
    ).toBe(true)
  })
})
