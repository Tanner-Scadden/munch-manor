import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import { worldCameraFor } from '#render/camera.ts'
import { type HoldKey, holdKeyOf, isHeldOver } from '#render/iso/hold.ts'
import { screenOf } from '#render/screen.ts'
import { shakeOffset } from '#screens/game/worldView.ts'
import { playingModel, withZombies } from '#test/model.fixture.ts'
import {
  FRAME_MS,
  checkModel,
  modelAfter,
  press,
  send,
  settleRunCommands,
  steps,
  tick,
  ticks,
  zombieAt,
} from '#test/testing.ts'
import { START_LEVEL } from '#world/level/arena.ts'
import { modifyFocus } from '#world/party/party.ts'
import { Phase } from '#world/schema/worldSchema.ts'

const keyOf = (model: Model): Option.Option<HoldKey> =>
  holdKeyOf({
    model,
    camera: worldCameraFor(model, screenOf(model)),
    shake: shakeOffset(model),
  })

const isHeldFrom = (drawn: Model, next: Model): boolean =>
  isHeldOver({ drawn: keyOf(drawn), next: keyOf(next) })

const lastHeart = withZombies(
  modifyFocus(playingModel, {
    player: player => UiStruct.evolve(player, { hp: () => 1 }),
  }),
  [
    zombieAt(100, START_LEVEL.start.x, START_LEVEL.start.y + 3, {
      speed: 20,
    }),
  ],
)

const SETTLE_FRAMES = 240

describe('the world held behind a menu', () => {
  it('a running wave holds nothing, so every frame draws', () => {
    expect(Option.isNone(keyOf(playingModel))).toBe(true)
  })

  it.effect(
    'the pause screen holds the picture through what it renders, and resuming draws again',
    () =>
      Effect.gen(function* () {
        const paused = yield* modelAfter(
          playingModel,
          steps(
            press('Escape'),
            settleRunCommands,
            checkModel(({ phase }) => {
              expect(Phase.isAnyOf(['Paused'])(phase)).toBe(true)
            }),
          ),
        )
        const moved = yield* modelAfter(
          paused,
          send(Message.SuppressedContextMenu()),
        )
        expect(isHeldFrom(paused, moved)).toBe(true)
        const resumed = yield* modelAfter(
          moved,
          steps(
            press('Escape'),
            settleRunCommands,
            tick(FRAME_MS),
            settleRunCommands,
          ),
        )
        expect(isHeldFrom(moved, resumed)).toBe(false)
      }),
  )

  it.effect(
    'the end card draws its beat, then holds the picture while its own animations go on',
    () =>
      Effect.gen(function* () {
        const ended = yield* modelAfter(
          lastHeart,
          steps(
            tick(FRAME_MS),
            settleRunCommands,
            checkModel(({ phase }) => {
              expect(phase).toEqual(Phase.GameOver({ wave: 1 }))
            }),
            ticks(SETTLE_FRAMES, FRAME_MS),
            settleRunCommands,
          ),
        )
        const later = yield* modelAfter(
          ended,
          steps(ticks(3, FRAME_MS), settleRunCommands),
        )
        expect(later.screenMs).toBeGreaterThan(ended.screenMs)
        expect(isHeldFrom(ended, later)).toBe(true)
      }),
  )

  it('a held key differs once anything it is drawn from changes', () => {
    const drawn = Option.some<HoldKey>([1, 'a'])
    expect(isHeldOver({ drawn, next: Option.some([1, 'a']) })).toBe(true)
    expect(isHeldOver({ drawn, next: Option.some([1, 'b']) })).toBe(false)
    expect(isHeldOver({ drawn, next: Option.none() })).toBe(false)
    expect(
      isHeldOver({ drawn: Option.none(), next: Option.some(Array.empty()) }),
    ).toBe(false)
  })
})
