import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import {
  BreakClock,
  CaseState,
  CrateStock,
  Feat,
  Lesson,
  type Model,
  Party,
  Phase,
  QuestTour,
  type Vector,
} from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import {
  CASE_CARD_MIN_MS,
  isCaseCardUp,
} from '#features/onboarding/caseCard.ts'
import {
  type QuestStep,
  isQuestOnCard,
  isQuestOnStart,
  maybeLockProgress,
  maybePadlockNudge,
  maybePadlockPointer,
  maybeQuestMark,
  maybeQuestPadlock,
  questStepOf,
} from '#features/onboarding/firstBreakQuest.ts'
import { isStartWaveBeckoning } from '#features/onboarding/onboarding.ts'
import { questEdgeShapes } from '#features/onboarding/views/questEdgeView.ts'
import { forgetTutorial } from '#platform/save/save.ts'
import { screenCameraOf } from '#render/camera/camera.ts'
import { screenOf } from '#render/camera/screen.ts'
import {
  FIXED_STEP_MS,
  HIT_STOP_WAVE_CLEAR_MS,
  PREPARATION_MS,
} from '#shared/constants.ts'
import { DISTANT_SPAWN, newPlayerCardSeen } from '#test/model.fixture.ts'
import {
  type AppStory,
  HOLD_TICKS,
  SHOWN_TICKS,
  changeModel,
  checkModel,
  hintIds,
  holdEnter,
  modelAfter,
  mouseDown,
  press,
  release,
  send,
  settleRunCommands,
  startWave,
  startedRun,
  steps,
  storyOf,
  tap,
  throughIntro,
  tick,
  ticks,
} from '#test/testing.ts'
import { asTutorialDone, asVeteran } from '#test/veteran.ts'
import { caseBoxOf } from '#world/feats/caseSpots.ts'
import { heldKeys } from '#world/keys/keys.ts'
import { levelOf } from '#world/level/arena.ts'
import {
  exitPriceFor,
  maybeCheapestPadlock,
  padlockMarkOf,
} from '#world/level/exits.ts'
import {
  focusOf,
  modifyFocus,
  modifySeat,
  seatStateAt,
} from '#world/party/party.ts'
import { isPending } from '#world/run/lessons.ts'
import {
  DARE_TOUR_WAVE,
  maybeTutorialCase,
  tutorialKeySpotOf,
} from '#world/run/tutorialRules.ts'
import { ZOMBIE_KIND_ORDER } from '#world/zombies/zombies.ts'

const FRAME_MS = FIXED_STEP_MS
const TICK_MS = 50
const LOOK_FRAMES = Math.ceil(2600 / FRAME_MS) + 1
const CASE_CARD_FRAMES = Math.ceil(CASE_CARD_MIN_MS / FRAME_MS) + 1

const frame = tick(FRAME_MS)

const throughClearingBlow = steps(
  ticks(Math.ceil(HIT_STOP_WAVE_CLEAR_MS / FRAME_MS), FRAME_MS),
)

const newSave: Model = UiStruct.evolve(newPlayerCardSeen, {
  introducedKinds: () => ZOMBIE_KIND_ORDER,
  lessons: lessons =>
    UiStruct.evolve(lessons, { rattles: () => Lesson.Learned({ atMs: 0 }) }),
})

const standAt =
  (spot: Vector) =>
  (current: Model): Model =>
    modifyFocus(current, {
      player: player =>
        UiStruct.evolve(player, { x: () => spot.x, y: () => spot.y }),
    })

const belowPadlock = (current: Model): Vector => {
  const { box } = Option.getOrThrow(maybeQuestPadlock(current))
  return { x: (box.left + box.right) / 2, y: box.bottom + 6 }
}

const belowTutorialCase = (current: Model): Vector => {
  const box = caseBoxOf(
    levelOf(current),
    Option.getOrThrow(maybeTutorialCase(current)),
  )
  return { x: (box.left + box.right) / 2, y: box.bottom + 8 }
}

const wonPracticeWave = (current: Model): Model =>
  UiStruct.evolve(
    modifySeat(current, 0, {
      feats: feats => UiStruct.evolve(feats, { kills: () => 5 }),
    }),
    {
      zombies: () => [],
      phase: phase =>
        Phase.isAnyOf(['Wave'])(phase)
          ? UiStruct.evolve(phase, { spawns: () => [] })
          : phase,
    },
  )

const practise = steps(
  press('KeyD'),
  ticks(10, TICK_MS),
  release('KeyD'),
  send(Message.MovedMouse({ clientX: 700, clientY: 100 })),
  mouseDown(700, 100),
  ticks(SHOWN_TICKS, TICK_MS),
  send(Message.ReleasedPointer({ pointerId: 1 })),
)

const stepOf = (current: Model): Option.Option<QuestStep> =>
  questStepOf(current)

const reachFirstBreak = steps(
  tap('Enter'),
  throughIntro,
  practise,
  startWave,
  changeModel(wonPracticeWave),
  frame,
  frame,
  throughClearingBlow,
)

const tourBreak = (base: Model): Model =>
  UiStruct.evolve(base, {
    phase: () =>
      Phase.Preparation({
        wave: DARE_TOUR_WAVE,
        remainingMs: PREPARATION_MS,
        durationMs: PREPARATION_MS,
        spawns: [DISTANT_SPAWN],
        clock: BreakClock.Waiting({ elapsedMs: 0 }),
      }),
  })

describe('the guided first break', () => {
  it.effect(
    'walks a new save from the intro and the practice wave through the key, the padlock, the case, the dare card, and START WAVE',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(newSave)
        s.pipe(
          steps<AppStory>(
            tap('Enter'),
            throughIntro,
            checkModel(current => {
              expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
              expect(hintIds(current)).toEqual(['Move', 'Fire'])
              expect(
                Option.map(maybeTutorialCase(current), ({ feat }) => feat),
              ).toEqual(Option.some(Feat.Kills({ count: 5 })))
            }),
            practise,
            startWave,
            checkModel(current => {
              expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
              expect(stepOf(current)).toEqual(Option.none())
            }),
            changeModel(wonPracticeWave),
            frame,
            frame,
            checkModel(current => {
              expect(current.phase).toMatchObject({
                _tag: 'Preparation',
                wave: DARE_TOUR_WAVE,
              })
              expect(
                Option.map(maybeTutorialCase(current), ({ state }) => state),
              ).toEqual(Option.some(CaseState.Opened({ by: 0 })))
              expect(current.firstBreakQuest).toEqual(
                QuestTour.Running({ isLockSeen: false }),
              )
              expect(stepOf(current)).toEqual(Option.some('Key'))
              expect(maybeQuestMark(current)).toEqual(
                Option.some(tutorialKeySpotOf(current)),
              )
            }),
            throughClearingBlow,
            changeModel(current =>
              standAt(tutorialKeySpotOf(current))(current),
            ),
            frame,
            checkModel(current => {
              expect(isPending(current.lessons.dareKey)).toBe(false)
              expect(
                Array.some(
                  current.frameEvents,
                  ({ _tag }) => _tag === 'KeysFound',
                ),
              ).toBe(true)
              expect(stepOf(current)).toEqual(Option.some('Lock'))
              const padlock = Option.getOrThrow(
                maybeCheapestPadlock(current, focusOf(current).player),
              )
              expect(maybeQuestMark(current)).toEqual(
                Option.some(padlockMarkOf(padlock)),
              )
              expect(padlock.price).toBe(exitPriceFor(current, padlock.exit))
              expect(maybeLockProgress(current)).toEqual(
                Option.some({
                  box: padlock.box,
                  held: heldKeys(current),
                  price: padlock.price,
                }),
              )
            }),
            changeModel(current => standAt(belowPadlock(current))(current)),
            frame,
            checkModel(current => {
              expect(current.firstBreakQuest).toEqual(
                QuestTour.Running({ isLockSeen: true }),
              )
              expect(stepOf(current)).toEqual(Option.some('Case'))
              expect(maybeLockProgress(current)).toEqual(Option.none())
            }),
            changeModel(current =>
              standAt(tutorialKeySpotOf(current))(current),
            ),
            frame,
            checkModel(current => {
              expect(stepOf(current)).toEqual(Option.some('Case'))
            }),
            changeModel(current =>
              standAt(belowTutorialCase(current))(current),
            ),
            frame,
            checkModel(current => {
              expect(isCaseCardUp(current)).toBe(true)
            }),
            ticks(CASE_CARD_FRAMES, FRAME_MS),
            tap('Enter'),
            holdEnter(HOLD_TICKS + 2),
            checkModel(current => {
              expect(
                Option.map(maybeTutorialCase(current), ({ state }) => state),
              ).toEqual(Option.some(CaseState.Emptied({ by: 0 })))
              expect(stepOf(current)).toEqual(Option.some('Card'))
              expect(isQuestOnCard(current)).toBe(true)
              expect(
                QuestTour.isAnyOf(['Looking'])(current.firstBreakQuest),
              ).toBe(true)
              expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
            }),
            ticks(LOOK_FRAMES, FRAME_MS),
            checkModel(current => {
              expect(current.firstBreakQuest).toEqual(QuestTour.Starting())
              expect(stepOf(current)).toEqual(Option.some('Start'))
              expect(isQuestOnStart(current)).toBe(true)
              expect(isStartWaveBeckoning(current)).toBe(true)
              expect(isPending(current.lessons.dareTour)).toBe(true)
              expect(current.phase).toMatchObject({
                _tag: 'Preparation',
                wave: DARE_TOUR_WAVE,
                clock: { _tag: 'Waiting' },
              })
            }),
            startWave,
            frame,
            checkModel(current => {
              expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
              expect(current.firstBreakQuest).toEqual(
                QuestTour.Done({ ageMs: 0 }),
              )
              expect(isPending(current.lessons.dareTour)).toBe(false)
              expect(isPending(current.lessons.startWave)).toBe(false)
              expect(stepOf(current)).toEqual(Option.none())
            }),
            settleRunCommands,
          ),
        )
      }),
  )

  it.effect('the key lies there once: taken, it is not on the next run', () =>
    Effect.gen(function* () {
      const taken = yield* modelAfter(
        newSave,
        steps<AppStory>(
          reachFirstBreak,
          changeModel(current => standAt(tutorialKeySpotOf(current))(current)),
          frame,
          settleRunCommands,
        ),
      )
      expect(isPending(taken.lessons.dareKey)).toBe(false)
      const keys = heldKeys(taken)
      const story1 = yield* storyOf(taken)
      story1.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(heldKeys(current)).toBe(keys)
            expect(stepOf(current)).toEqual(Option.some('Lock'))
          }),
        ),
      )
    }),
  )

  it.effect('the skip button ends it at any step, for good', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(newSave)
      s.pipe(
        steps<AppStory>(
          reachFirstBreak,
          send(Message.ClickedSkipQuestButton()),
          checkModel(skipped => {
            expect(skipped.firstBreakQuest).toEqual(QuestTour.Over())
            expect(isPending(skipped.lessons.dareTour)).toBe(false)
          }),
          frame,
          checkModel(current => {
            expect(stepOf(current)).toEqual(Option.none())
            expect(maybeQuestMark(current)).toEqual(Option.none())
          }),
          settleRunCommands,
        ),
      )
    }),
  )

  it.effect('starting the wave ends it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(newSave)
      s.pipe(
        steps<AppStory>(
          reachFirstBreak,
          startWave,
          checkModel(waved => {
            expect(Phase.isAnyOf(['Wave'])(waved.phase)).toBe(true)
          }),
          frame,
          checkModel(current => {
            expect(current.firstBreakQuest).toEqual(QuestTour.Over())
            expect(isPending(current.lessons.dareTour)).toBe(false)
          }),
          settleRunCommands,
        ),
      )
    }),
  )

  it.effect('the wave started before the last step ends it unticked', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(tourBreak(newSave), {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      )
      s.pipe(
        steps<AppStory>(
          startWave,
          frame,
          checkModel(current => {
            expect(current.firstBreakQuest).toEqual(QuestTour.Over())
            expect(isPending(current.lessons.dareTour)).toBe(false)
          }),
          settleRunCommands,
        ),
      )
    }),
  )

  it.effect('the dining room crate holds a Plank Pile in the tour', () =>
    Effect.forEach([1, 2, 3, 4, 5, 6], seed =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(tourBreak(newSave), {
            crates: crates =>
              UiStruct.evolve(crates, { rngState: () => seed * 7919 }),
          }),
        )
        s.pipe(
          steps<AppStory>(
            frame,
            checkModel(current => {
              expect(
                Array.map(current.crates.crates, ({ stock }) => stock),
              ).toEqual([CrateStock.Stocked({ trap: 'Barricade' })])
            }),
          ),
        )
      }),
    ),
  )

  it.effect('a returning player never sees any of it', () =>
    Effect.gen(function* () {
      const veteran = UiStruct.evolve(asVeteran(newSave), {
        maybeSurface: () => newSave.maybeSurface,
      })
      const started = yield* startedRun(veteran)
      expect(Phase.isAnyOf(['Preparation'])(started.phase)).toBe(true)
      const caseFeats = Array.map(started.cases, ({ feat }) => feat)
      expect(caseFeats).not.toContainEqual(Feat.Kills({ count: 5 }))
      const story2 = yield* storyOf(tourBreak(veteran))
      story2.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(current.firstBreakQuest).toEqual(QuestTour.Waiting())
            expect(stepOf(current)).toEqual(Option.none())
            expect(maybeQuestMark(current)).toEqual(Option.none())
          }),
        ),
      )
      const story3 = yield* storyOf(
        tourBreak(asTutorialDone(asVeteran(initialModel))),
      )
      story3.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(stepOf(current)).toEqual(Option.none())
          }),
        ),
      )
    }),
  )

  it.effect('a tutorial reset plays it again', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        tourBreak(
          UiStruct.evolve(forgetTutorial(asTutorialDone(newSave)), {
            lessons: lessons =>
              UiStruct.evolve(lessons, {
                rattles: () => Lesson.Learned({ atMs: 0 }),
              }),
          }),
        ),
      )
      s.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(current.firstBreakQuest).toEqual(
              QuestTour.Running({ isLockSeen: false }),
            )
          }),
        ),
      )
    }),
  )

  it.effect('in co-op it never runs', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(tourBreak(newSave), { party: () => Party.Crew() }),
      )
      s.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(stepOf(current)).toEqual(Option.none())
            expect(seatStateAt(current, 0).trapStock.Barricade).toBe(0)
          }),
        ),
      )
    }),
  )
})

describe('the START WAVE step', () => {
  const onStart: Model = UiStruct.evolve(tourBreak(newSave), {
    firstBreakQuest: () => QuestTour.Starting(),
  })

  it.effect('comes after a moment on the dare card', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(tourBreak(newSave), {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      )
      s.pipe(
        steps<AppStory>(
          ticks(LOOK_FRAMES - 2, FRAME_MS),
          checkModel(current => {
            expect(stepOf(current)).toEqual(Option.some('Card'))
            expect(isStartWaveBeckoning(current)).toBe(false)
          }),
          frame,
          frame,
          checkModel(current => {
            expect(stepOf(current)).toEqual(Option.some('Start'))
            expect(isStartWaveBeckoning(current)).toBe(true)
          }),
        ),
      )
    }),
  )

  it.effect('never rushes the player: the break waits', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onStart)
      s.pipe(
        steps<AppStory>(
          ticks(120, TICK_MS),
          checkModel(current => {
            expect(current.phase).toMatchObject({
              _tag: 'Preparation',
              wave: DARE_TOUR_WAVE,
              remainingMs: PREPARATION_MS,
            })
            expect(
              BreakClock.isAnyOf(['Waiting'])(
                Phase.isAnyOf(['Preparation'])(current.phase)
                  ? current.phase.clock
                  : BreakClock.Counting(),
              ),
            ).toBe(true)
            expect(stepOf(current)).toEqual(Option.some('Start'))
          }),
        ),
      )
    }),
  )

  const starters = [
    { by: 'the button', start: startWave },
    { by: 'the key', start: tap('Enter') },
  ]

  it.effect('starting the wave ticks it off and learns the tour', () =>
    Effect.forEach(starters, ({ start }) =>
      Effect.gen(function* () {
        const s = yield* storyOf(onStart)
        s.pipe(
          steps<AppStory>(
            start,
            frame,
            checkModel(current => {
              expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
              expect(current.firstBreakQuest).toEqual(
                QuestTour.Done({ ageMs: 0 }),
              )
              expect(isPending(current.lessons.dareTour)).toBe(false)
              expect(isPending(current.lessons.startWave)).toBe(false)
            }),
            settleRunCommands,
          ),
        )
      }),
    ),
  )

  it.effect('in co-op it never comes', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(tourBreak(newSave), {
          party: () => Party.Crew(),
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      )
      s.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(stepOf(current)).toEqual(Option.none())
          }),
        ),
      )
    }),
  )
})

const laterBreak = (keys: number): Model =>
  UiStruct.evolve(asTutorialDone(asVeteran(newSave)), {
    keys: ring => UiStruct.evolve(ring, { held: () => keys }),
    phase: () =>
      Phase.Preparation({
        wave: 4,
        remainingMs: PREPARATION_MS,
        durationMs: PREPARATION_MS,
        spawns: [DISTANT_SPAWN],
        clock: BreakClock.Counting(),
      }),
  })

describe('the padlock nudge', () => {
  const cheapestPrice = (model: Model): number =>
    Option.getOrThrow(maybeQuestPadlock(model)).price

  it.effect('pulses over the cheapest padlock once the keys are there', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(laterBreak(0))
      s.pipe(
        steps<AppStory>(
          checkModel(short => {
            const price = cheapestPrice(short)
            expect(maybePadlockNudge(short)).toEqual(Option.none())
            expect(maybePadlockNudge(laterBreak(price - 1))).toEqual(
              Option.none(),
            )
            expect(maybePadlockNudge(laterBreak(price))).toEqual(
              Option.map(maybeQuestPadlock(short), padlockMarkOf),
            )
          }),
        ),
      )
    }),
  )

  it.effect('goes once boards open, in a wave, and in the tour break', () =>
    Effect.gen(function* () {
      const flush = laterBreak(9)
      const opened = yield* modelAfter(
        flush,
        steps<AppStory>(
          changeModel(current => standAt(belowPadlock(current))(current)),
          holdEnter(HOLD_TICKS + 2),
          settleRunCommands,
        ),
      )
      expect(heldKeys(opened)).toBeLessThan(9)
      expect(maybePadlockNudge(opened)).toEqual(Option.none())
      expect(
        maybePadlockNudge(
          UiStruct.evolve(flush, {
            phase: () =>
              Phase.Wave({
                wave: 4,
                spawns: [DISTANT_SPAWN],
                elapsedMs: 0,
              }),
          }),
        ),
      ).toEqual(Option.none())
      const story4 = yield* storyOf(
        UiStruct.evolve(tourBreak(newSave), {
          keys: ring => UiStruct.evolve(ring, { held: () => 9 }),
        }),
      )
      story4.pipe(
        steps<AppStory>(
          frame,
          checkModel(current => {
            expect(maybePadlockNudge(current)).toEqual(Option.none())
          }),
        ),
      )
    }),
  )
})

describe('the padlock pointer', () => {
  const farFromPadlock = (current: Model): Vector => {
    const level = levelOf(current)
    const { box } = Option.getOrThrow(maybeQuestPadlock(current))
    const middle = (level.left + level.width) / 2
    const centre = (level.top + level.bottom) / 2
    return {
      x: box.left < middle ? level.left + level.width - 40 : level.left + 40,
      y: box.top < centre ? level.bottom - 40 : level.top + 40,
    }
  }

  const arrowsOf = (current: Model): number =>
    questEdgeShapes(current, screenOf(current), screenCameraOf(current)).length

  it.effect('points to an affordable padlock out of sight, then stops', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(laterBreak(9))
      s.pipe(
        steps<AppStory>(
          changeModel(current => standAt(farFromPadlock(current))(current)),
          checkModel(far => {
            expect(maybePadlockPointer(far)).toEqual(
              Option.map(maybeQuestPadlock(far), padlockMarkOf),
            )
            expect(arrowsOf(far)).toBe(1)
            expect(
              maybePadlockPointer(standAt(belowPadlock(far))(far)),
            ).toEqual(Option.none())
            expect(
              maybePadlockPointer(
                UiStruct.evolve(far, {
                  keys: ring => UiStruct.evolve(ring, { held: () => 0 }),
                }),
              ),
            ).toEqual(Option.none())
            expect(
              maybePadlockPointer(
                UiStruct.evolve(far, { party: () => Party.Crew() }),
              ),
            ).toEqual(Option.none())
            expect(
              maybePadlockPointer(
                UiStruct.evolve(far, {
                  phase: () =>
                    Phase.Wave({
                      wave: 4,
                      spawns: [DISTANT_SPAWN],
                      elapsedMs: 0,
                    }),
                }),
              ),
            ).toEqual(Option.none())
          }),
        ),
      )
    }),
  )

  it.effect('still points after boards have opened this run', () =>
    Effect.gen(function* () {
      const opened = yield* modelAfter(
        laterBreak(99),
        steps<AppStory>(
          changeModel(current => standAt(belowPadlock(current))(current)),
          holdEnter(HOLD_TICKS + 2),
          settleRunCommands,
        ),
      )
      const story5 = yield* storyOf(opened)
      story5.pipe(
        steps<AppStory>(
          changeModel(current => standAt(farFromPadlock(current))(current)),
          checkModel(far => {
            expect(maybePadlockNudge(far)).toEqual(Option.none())
            expect(maybePadlockPointer(far)).toEqual(
              Option.map(maybeQuestPadlock(far), padlockMarkOf),
            )
          }),
        ),
      )
    }),
  )
})
