import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Lesson, type Model } from '../../../app/model'
import { MAX_FRAME_DELTA_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  ackHudSlots,
  emitFrame,
  emitPressedKey,
  measureSurface,
  openLobbyInScene,
  pressSurface,
  readDareCardInScene,
  startIntoIntroInScene,
  statusLine,
  throughIntroByTapInScene,
  throughIntroInScene,
} from '../../../test/sceneTesting'
import {
  type SceneStep,
  checkModel,
  resolveFocusLobby,
  sceneOf,
  startRunFromHome,
  steps,
  storyOf,
} from '../../../test/testing'
import { Lobby } from '../../lobby/block'
import { Events } from '../../lobby/message'
import { FOLD_MS, GATE_MS, READ_MS, UNFOLD_MS } from '../pocketCard'

const CARD_STATUS = /Your friends' dare card/
const BREAK_STATUS = /Get ready for wave 1\./

const framesOf =
  (ms: number): SceneStep =>
  s => {
    for (
      let frame = 0;
      frame < Math.ceil(ms / MAX_FRAME_DELTA_MS);
      frame += 1
    ) {
      s.pipe(emitFrame(MAX_FRAME_DELTA_MS), ackHudSlots)
    }
    return s
  }

const showsStatus =
  (text: RegExp): SceneStep =>
  s =>
    s.pipe(ackHudSlots).expect(statusLine).toHaveText(text)

const surfaceTap = pressSurface({
  pointerId: 4,
  device: 'Touch',
  clientX: 100,
  clientY: 100,
})

const onTouch: Model = UiStruct.evolve(home, {
  lastDevice: () => 'Touch',
})

const unread = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: lessons =>
      UiStruct.evolve(lessons, { dareCard: () => Lesson.Pending() }),
  })

const toTheCard: SceneStep = steps(
  measureSurface,
  startIntoIntroInScene,
  throughIntroInScene,
)

const toTheCardByTap: SceneStep = steps(
  measureSurface,
  startIntoIntroInScene,
  throughIntroByTapInScene,
)

describe('the dare card in your pocket', () => {
  it.effect('comes out on the slam, and the first break waits under it', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        toTheCard,
        showsStatus(CARD_STATUS),
        framesOf(READ_MS - 200),
        showsStatus(CARD_STATUS),
      )
    }),
  )

  it.effect('folds itself away after a few seconds, and the break runs', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        toTheCard,
        framesOf(READ_MS),
        showsStatus(BREAK_STATUS),
        framesOf(FOLD_MS),
        showsStatus(BREAK_STATUS),
      )
    }),
  )

  it.effect('a key puts it away as soon as it has opened', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        toTheCard,
        framesOf(UNFOLD_MS + 50),
        emitPressedKey('Escape'),
        showsStatus(BREAK_STATUS),
      )
    }),
  )

  it.effect('the first time, it waits past its clock for a key', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(unread(home))
      s.pipe(
        toTheCard,
        framesOf(READ_MS + FOLD_MS + 1_000),
        showsStatus(CARD_STATUS),
        emitPressedKey('Escape'),
        showsStatus(BREAK_STATUS),
      )
    }),
  )

  it.effect('the first time, a key before its gate leaves it up', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(unread(home))
      s.pipe(
        toTheCard,
        framesOf(GATE_MS - 400),
        emitPressedKey('Escape'),
        showsStatus(CARD_STATUS),
        framesOf(450),
        emitPressedKey('Escape'),
        showsStatus(BREAK_STATUS),
      )
    }),
  )

  it.effect('the first time, a tap before its gate leaves it up', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(unread(onTouch))
      s.pipe(
        toTheCardByTap,
        framesOf(UNFOLD_MS + 100),
        surfaceTap,
        showsStatus(CARD_STATUS),
      )
    }),
  )

  it.effect('reading it once learns it, so the next run keeps its clock', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(unread(home))
      s.pipe(
        startRunFromHome,
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Folding')
          expect(current.lessons.dareCard._tag).toBe('Learned')
        }),
      )
    }),
  )

  it.effect('a key puts it away once it has opened', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        toTheCard,
        emitPressedKey('Escape'),
        showsStatus(CARD_STATUS),
        readDareCardInScene,
        showsStatus(BREAK_STATUS),
      )
    }),
  )

  it.effect('a tap puts it away on touch', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onTouch)
      s.pipe(
        toTheCardByTap,
        showsStatus(CARD_STATUS),
        framesOf(500),
        surfaceTap,
        showsStatus(BREAK_STATUS),
      )
    }),
  )

  it.effect('stays in the pocket when you stay the night', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        measureSurface,
        openLobbyInScene,
        c =>
          c.childEmit(Lobby, 'lobby', Events.PickedMode({ mode: 'Endless' })),
        resolveFocusLobby(),
        c => c.childEmit(Lobby, 'lobby', Events.RequestedStart()),
        throughIntroInScene,
        showsStatus(/Get ready for endless wave 1\./),
      )
    }),
  )
})
