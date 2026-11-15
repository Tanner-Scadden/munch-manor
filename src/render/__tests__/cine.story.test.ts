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
import { FINISHER_CINE_MS, cineBarShapes, cineWeightOf } from '../cine'

// The camera's big moments (src/render/cine.ts): it glides partway toward
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

  it("glides toward the boss's door and keeps the player in the window", () => {
    const door = levelOf(midRoom).doors.Front.center
    const still = centerOf(midRoom)
    const glided = centerOf(arrivingAt(midRoom, ENTRANCE_MS / 2))
    expect(Math.abs(glided.y - door.y)).toBeLessThan(Math.abs(still.y - door.y))
    const camera = cameraOf(arrivingAt(midRoom, ENTRANCE_MS / 2))
    const { player } = focusOf(midRoom)
    expect(player.x).toBeGreaterThan(camera.x)
    expect(player.x).toBeLessThan(camera.x + camera.width)
    expect(player.y).toBeGreaterThan(camera.y)
    expect(player.y).toBeLessThan(camera.y + camera.height)
    expect(cameraOf(arrivingAt(midRoom, 0))).toEqual(cameraOf(midRoom))
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
