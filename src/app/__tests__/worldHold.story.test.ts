import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { worldCameraFor } from '../../render/camera'
import { type HoldKey, holdKeyOf, isHeldOver } from '../../render/iso/hold'
import { screenOf } from '../../render/screen'
import { shakeOffset } from '../../screens/game/worldView'
import { playingModel, withZombies } from '../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  press,
  tick,
  ticks,
  zombieAt,
} from '../../test/testing'
import { START_LEVEL } from '../../world/level/arena'
import { modifyFocus } from '../../world/party/party'
import { Phase } from '../../world/schema/worldSchema'
import { Message } from '../message'
import type { Model } from '../model'

// The world's picture held behind a menu (src/render/iso/hold.ts): while
// the World stands still, a frame a menu renders hands the world's element
// the key of the picture it last drew, so the element draws nothing.

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
    player: player => modifyFields(player, { hp: () => 1 }),
  }),
  [
    zombieAt(100, START_LEVEL.start.x, START_LEVEL.start.y + 3, {
      speed: 20,
    }),
  ],
)

// NOTE: the end card's beat lands its particles and settles its shake in
// slow motion within this long.
const SETTLE_FRAMES = 240

describe('the world held behind a menu', () => {
  it('a running wave holds nothing, so every frame draws', () => {
    expect(Option.isNone(keyOf(playingModel))).toBe(true)
  })

  it.effect(
    'the pause screen holds the picture through what it renders, and resuming draws again',
    () =>
      Effect.gen(function* () {
        const paused = yield* Story.story(
          APPLICATION,
          Story.given(playingModel),
          press('Escape'),
          Story.model(({ phase }) => {
            expect(Phase.isAnyOf(['Paused'])(phase)).toBe(true)
          }),
        )
        const moved = yield* Story.story(
          APPLICATION,
          Story.given(paused),
          Story.message(Message.SuppressedContextMenu()),
        )
        expect(isHeldFrom(paused, moved)).toBe(true)
        const resumed = yield* Story.story(
          APPLICATION,
          Story.given(moved),
          press('Escape'),
          tick(FRAME_MS),
        )
        expect(isHeldFrom(moved, resumed)).toBe(false)
      }),
  )

  it.effect(
    'the end card draws its beat, then holds the picture while its own animations go on',
    () =>
      Effect.gen(function* () {
        const ended = yield* Story.story(
          APPLICATION,
          Story.given(lastHeart),
          tick(FRAME_MS),
          Story.model(({ phase }) => {
            expect(phase).toEqual(Phase.GameOver({ wave: 1 }))
          }),
          ...ticks(SETTLE_FRAMES, FRAME_MS),
        )
        const later = yield* Story.story(
          APPLICATION,
          Story.given(ended),
          ...ticks(3, FRAME_MS),
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
