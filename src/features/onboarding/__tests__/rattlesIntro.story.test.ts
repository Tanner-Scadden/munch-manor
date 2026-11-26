import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import {
  DareHintCall,
  Lesson,
  type Model,
  Party,
  QuestTour,
  RattlesIntro,
} from '#app/model.ts'
import {
  RATTLES_INTRO_LINES,
  RATTLES_LINE_MS,
  maybeRattlesLine,
} from '#features/onboarding/rattlesIntro.ts'
import { forgetTutorial } from '#platform/save/save.ts'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '#shared/constants.ts'
import {
  WAVE_2_BREAK,
  WAVE_2_FIGHT,
  newPlayerCardSeen,
} from '#test/model.fixture.ts'
import {
  checkModel,
  settleRunCommands,
  startWave,
  storyOf,
  tick,
  ticks,
} from '#test/testing.ts'
import { asTutorialDone, asVeteran } from '#test/veteran.ts'
import { RATTLES_BOX, START_LEVEL } from '#world/level/arena.ts'
import { isPending } from '#world/run/lessons.ts'
import { ZOMBIE_KIND_ORDER } from '#world/zombies/zombies.ts'

const LINE_FRAMES = Math.ceil(RATTLES_LINE_MS / FIXED_STEP_MS)

const firstLine = RATTLES_INTRO_LINES[0]

const meetingBreak = (base: Model): Model =>
  UiStruct.evolve(base, {
    phase: () => WAVE_2_BREAK,
    introducedKinds: () => ZOMBIE_KIND_ORDER,
  })

const newSave = meetingBreak(newPlayerCardSeen)

const returning = meetingBreak(
  UiStruct.evolve(asTutorialDone(asVeteran(newPlayerCardSeen)), {
    lessons: lessons =>
      UiStruct.evolve(lessons, { rattles: () => Lesson.Pending() }),
  }),
)

describe("Rattles' hello", () => {
  it.effect(
    'a new save meets him in the first break, line by line, then the tour starts',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(newSave)
        s.pipe(
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(current.rattlesIntro).toMatchObject({ _tag: 'Talking' })
            expect(maybeRattlesLine(current)).toEqual(Option.some(firstLine))
            expect(isPending(current.lessons.rattles)).toBe(false)
            expect(current.firstBreakQuest).toEqual(QuestTour.Waiting())
            expect(DareHintCall.isAnyOf(['Quiet'])(current.dareHint.call)).toBe(
              true,
            )
          }),
          ticks(LINE_FRAMES, FIXED_STEP_MS),
          checkModel(current => {
            expect(maybeRattlesLine(current)).toEqual(
              Option.fromNullishOr(RATTLES_INTRO_LINES[1]),
            )
          }),
          ticks(LINE_FRAMES * RATTLES_INTRO_LINES.length, FIXED_STEP_MS),
          checkModel(current => {
            expect(current.rattlesIntro).toEqual(RattlesIntro.Over())
            expect(maybeRattlesLine(current)).toEqual(Option.none())
            expect(current.firstBreakQuest).toEqual(
              QuestTour.Running({ isLockSeen: false }),
            )
          }),
          settleRunCommands,
        )
      }),
  )

  it.effect('a player from before the escape meets him too, once', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(returning)
      s.pipe(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(maybeRattlesLine(current)).toEqual(Option.some(firstLine))
        }),
        ticks(LINE_FRAMES * RATTLES_INTRO_LINES.length, FIXED_STEP_MS),
        checkModel(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Over())
          expect(isPending(current.lessons.rattles)).toBe(false)
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect('a save that has met him never hears it again', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        meetingBreak(asTutorialDone(asVeteran(newPlayerCardSeen))),
      )
      s.pipe(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Waiting())
          expect(maybeRattlesLine(current)).toEqual(Option.none())
        }),
      )
    }),
  )

  it.effect('a tutorial reset brings it back', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        meetingBreak(
          forgetTutorial(asTutorialDone(asVeteran(newPlayerCardSeen))),
        ),
      )
      s.pipe(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(maybeRattlesLine(current)).toEqual(Option.some(firstLine))
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect('starting the wave cuts him off', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(returning)
      s.pipe(
        tick(FIXED_STEP_MS),
        startWave,
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Over())
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect('never in a wave or in co-op, where he waits for a solo run', () =>
    Effect.gen(function* () {
      const inWave = yield* storyOf(
        UiStruct.evolve(returning, { phase: () => WAVE_2_FIGHT }),
      )
      inWave.pipe(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Waiting())
        }),
      )
      const inCrew = yield* storyOf(
        UiStruct.evolve(returning, { party: () => Party.Crew() }),
      )
      inCrew.pipe(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Waiting())
          expect(isPending(current.lessons.rattles)).toBe(true)
        }),
      )
    }),
  )
})

describe("Rattles' spot", () => {
  it('sits beside the front door, clear of the doorway', () => {
    const door = START_LEVEL.thresholds.Front.box
    const gap = Math.max(
      RATTLES_BOX.left - door.right,
      door.left - RATTLES_BOX.right,
    )
    expect(gap).toBeGreaterThanOrEqual(PLAYER_RADIUS * 2)
    expect(gap).toBeLessThanOrEqual(20)
    expect(RATTLES_BOX.bottom).toBeGreaterThan(door.top - 20)
  })
})
