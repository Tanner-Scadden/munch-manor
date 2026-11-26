import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  CaseCard,
  CaseState,
  Feat,
  Lesson,
  type Model,
  Phase,
  QuestTour,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { restoreSave, saveOf } from '../../../platform/save'
import {
  atCase,
  breakBefore,
  crewInWave,
  quietWave,
  readyModel,
} from '../../../test/model.fixture'
import {
  checkModel,
  send,
  storyOf,
  tap,
  tick,
  ticks,
  writeSave,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { modifyFocus } from '../../../world/party/party'
import { isPending } from '../../../world/run/lessons'
import { CASE_CARD_MIN_MS, CASE_CARD_MS } from '../caseCard'

// The display case's first-time card (src/features/onboarding/caseCard.ts):
// the first walk up to a case in a break raises it, the break waits under
// it, and putting it away learns it for good.

const TICK_MS = 50
const MIN_TICKS = Math.ceil(CASE_CARD_MIN_MS / TICK_MS)

const withCaseLesson = (model: Model, lesson: Lesson): Model =>
  UiStruct.evolve(model, {
    lessons: lessons => UiStruct.evolve(lessons, { displayCase: () => lesson }),
  })

// NOTE: a returning player who has never met a display case, standing at
// one in `phase`.
const atCaseIn = (base: Model, phase: Phase): Model =>
  atCase(
    withCaseLesson(
      UiStruct.evolve(base, { phase: () => phase }),
      Lesson.Pending(),
    ),
    'Smg',
    CaseState.Locked(),
    Feat.KillsWith({ armament: 'Knife', count: 10 }),
  )

// NOTE: the save has been read, so a learned lesson is written back.
const inBreak = atCaseIn(
  UiStruct.evolve(readyModel, {
    saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
  }),
  breakBefore(4),
)

const isShowing = (current: Model): boolean =>
  CaseCard.isAnyOf(['Showing'])(current.caseCard)

const remainingMs = (current: Model): number =>
  Phase.matchOrElse(
    current.phase,
    { Preparation: ({ remainingMs: left }) => left },
    () => -1,
  )

describe('the display case card', () => {
  it.effect(
    'walking up to a case in a break raises it and holds the break; Enter puts it away, learned and saved',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inBreak)
        s.pipe(
          tick(TICK_MS),
          checkModel(current => {
            expect(current.caseCard).toEqual(
              CaseCard.Showing({ caseId: 0, ageMs: 0 }),
            )
          }),
        )
        const heldAt = remainingMs(s.model)
        s.pipe(
          ticks(3, TICK_MS),
          checkModel(current => {
            expect(remainingMs(current)).toBe(heldAt)
          }),
          // NOTE: too soon to put away: a key meant for the game is not lost.
          tap('Enter'),
          checkModel(current => {
            expect(isShowing(current)).toBe(true)
          }),
          ticks(MIN_TICKS, TICK_MS),
          tap('Enter'),
          checkModel(current => {
            expect(isShowing(current)).toBe(false)
            expect(isPending(current.lessons.displayCase)).toBe(false)
            expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
            expect(saveOf(current).onboarding.lessons.displayCase).toBe(
              'Learned',
            )
          }),
          writeSave,
          ticks(4, TICK_MS),
          checkModel(current => {
            expect(isShowing(current)).toBe(false)
            expect(remainingMs(current)).toBeLessThan(heldAt)
          }),
        )
      }),
  )

  it.effect('its button puts it away', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inBreak)
      s.pipe(
        ticks(MIN_TICKS + 1, TICK_MS),
        send(Message.ClickedCaseCardButton()),
        checkModel(current => {
          expect(isShowing(current)).toBe(false)
          expect(isPending(current.lessons.displayCase)).toBe(false)
        }),
        writeSave,
      )
    }),
  )

  // NOTE: 6 s, the owner's pick (2026-11-10), down from 9.
  it.effect('left up, it puts itself away after 6 s, learned', () =>
    Effect.gen(function* () {
      expect(CASE_CARD_MS).toBe(6000)
      const s = yield* storyOf(inBreak)
      s.pipe(
        ticks(Math.floor(5500 / TICK_MS), TICK_MS),
        checkModel(current => {
          expect(isShowing(current)).toBe(true)
        }),
        ticks(Math.ceil(1000 / TICK_MS), TICK_MS),
        checkModel(current => {
          expect(isShowing(current)).toBe(false)
          expect(isPending(current.lessons.displayCase)).toBe(false)
        }),
        writeSave,
      )
    }),
  )

  it.effect('mid-wave a case raises nothing; the next break does', () =>
    Effect.gen(function* () {
      const wave = yield* storyOf(
        atCaseIn(asVeteran(quietWave(4)), quietWave(4).phase),
      )
      wave.pipe(
        ticks(4, TICK_MS),
        checkModel(current => {
          expect(isShowing(current)).toBe(false)
          expect(isPending(current.lessons.displayCase)).toBe(true)
        }),
      )
      const nextBreak = yield* storyOf(
        atCaseIn(asVeteran(quietWave(4)), breakBefore(5)),
      )
      nextBreak.pipe(
        tick(TICK_MS),
        checkModel(current => {
          expect(isShowing(current)).toBe(true)
        }),
      )
    }),
  )

  it.effect('a save that has learned it never raises it again', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(inBreak, {
          lessons: () =>
            restoreSave(
              initialModel,
              saveOf(withCaseLesson(inBreak, Lesson.Learned({ atMs: 0 }))),
            ).lessons,
        }),
      )
      s.pipe(
        ticks(4, TICK_MS),
        checkModel(current => {
          expect(isPending(current.lessons.displayCase)).toBe(false)
          expect(isShowing(current)).toBe(false)
        }),
      )
    }),
  )

  it.effect('never in co-op, as the new zombie card', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        atCaseIn(crewInWave(2, breakBefore(4)), breakBefore(4)),
      )
      s.pipe(
        ticks(4, TICK_MS),
        checkModel(current => {
          expect(isShowing(current)).toBe(false)
        }),
      )
    }),
  )

  it.effect(
    'the guided first break keeps it down until its own Case step',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(withCaseLesson(inBreak, Lesson.Pending()), {
            firstBreakQuest: () => QuestTour.Running({ isLockSeen: false }),
            lessons: lessons =>
              UiStruct.evolve(lessons, { dareKey: () => Lesson.Pending() }),
          }),
        )
        s.pipe(
          ticks(4, TICK_MS),
          checkModel(current => {
            expect(isShowing(current)).toBe(false)
          }),
        )
      }),
  )

  it.effect('a case across the room raises nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        modifyFocus(inBreak, {
          player: player => UiStruct.evolve(player, { x: x => x + 60 }),
        }),
      )
      s.pipe(
        ticks(4, TICK_MS),
        checkModel(current => {
          expect(isShowing(current)).toBe(false)
        }),
      )
    }),
  )
})
