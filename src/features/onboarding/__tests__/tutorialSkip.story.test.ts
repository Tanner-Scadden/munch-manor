import { Array, Effect, Option, Record } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import {
  BreakClock,
  DifficultyCard,
  Lesson,
  type Model,
  Phase,
  QuestTour,
  RunMode,
  type TutorialChoice,
  defaultAppearance,
  freshLessons,
} from '#app/model.ts'
import { FocusProfileElement } from '#app/update/profile.ts'
import { WriteSave } from '#app/update/save.ts'
import { isLearned } from '#features/onboarding/onboarding.ts'
import { isRattlesTalking } from '#features/onboarding/rattlesIntro.ts'
import { decodeSave, encodeSave, restoreSave, saveOf } from '#platform/save.ts'
import {
  FIXED_STEP_MS,
  KITCHEN_FIRST_WAVE,
  SHOP_FIRST_WAVE,
} from '#shared/constants.ts'
import {
  DISTANT_SPAWN,
  newPlayerReady,
  readyModel,
} from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  expectNoCommand,
  hintIds,
  modelAfter,
  press,
  send,
  settleRunCommands,
  steps,
  throughIntro,
  tick,
  writeSave,
} from '#test/testing.ts'
import { asTutorialDone } from '#test/veteran.ts'
import { isPending, isPracticeGateHeld } from '#world/run/lessons.ts'
import { noModifiers } from '#world/run/modifiers.ts'
import { DARE_TOUR_WAVE, isKitchenTourOn } from '#world/run/tutorialRules.ts'

const firstVisit: Model = UiStruct.evolve(newPlayerReady, {
  saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
})

const expectWrite: StoryStep = s => s.expectHas(WriteSave)

const resolveFocusProfile: StoryStep = s =>
  s.resolve(FocusProfileElement, Component.noop)

const chooseTutorial = (choice: TutorialChoice) =>
  send(Message.ClickedTutorialChoiceButton({ choice }))

const pickNormal = send(
  Message.ClickedDifficultyCardButton({ difficulty: 'Normal' }),
)

const isGuidedFirstBreakOn = (current: Model) =>
  modelAfter(
    UiStruct.evolve(current, {
      phase: () =>
        Phase.Preparation({
          wave: SHOP_FIRST_WAVE,
          remainingMs: 20_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
          clock: BreakClock.Waiting({ elapsedMs: 0 }),
        }),
      lessons: lessons =>
        UiStruct.evolve(lessons, {
          rattles: () => Lesson.Learned({ atMs: 0 }),
        }),
    }),
    steps(tick(FIXED_STEP_MS)),
  ).pipe(
    Effect.map(
      firstBreak =>
        QuestTour.isAnyOf(['Running'])(firstBreak.firstBreakQuest) ||
        isPending(firstBreak.lessons.dareTour),
    ),
  )

const isRattlesHelloOn = (current: Model) =>
  modelAfter(
    UiStruct.evolve(current, {
      phase: () =>
        Phase.Preparation({
          wave: DARE_TOUR_WAVE,
          remainingMs: 20_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
          clock: BreakClock.Waiting({ elapsedMs: 0 }),
        }),
    }),
    steps(tick(FIXED_STEP_MS), settleRunCommands),
  ).pipe(Effect.map(isRattlesTalking))

const isKitchenTourDue = (current: Model): boolean =>
  isKitchenTourOn(
    UiStruct.evolve(current, {
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
          wave: KITCHEN_FIRST_WAVE,
          remainingMs: 15_000,
          durationMs: 15_000,
          spawns: [],
        }),
    }),
  )

const reloaded = (current: Model): Model =>
  restoreSave(
    newPlayerReady,
    Option.getOrThrow(
      Option.flatMap(encodeSave(saveOf(current)), json => decodeSave(json)),
    ),
  )

describe('the first-run card', () => {
  it.effect(
    'TUTORIAL is lit by default, and SKIP IT stays lit until a difficulty starts the run',
    () =>
      modelAfter(
        firstVisit,
        steps(
          send(Message.ClickedCampaignButton()),
          checkModel(current => {
            expect(current.difficultyCard).toEqual(
              DifficultyCard.Asking({
                mode: RunMode.Campaign(),
                tutorial: 'Tutorial',
              }),
            )
          }),
          chooseTutorial('Skip'),
          checkModel(current => {
            expect(current.difficultyCard).toEqual(
              DifficultyCard.Asking({
                mode: RunMode.Campaign(),
                tutorial: 'Skip',
              }),
            )
            expect(current.lessons).toEqual(freshLessons)
          }),
          chooseTutorial('Tutorial'),
          checkModel(current => {
            expect(current.difficultyCard).toEqual(
              DifficultyCard.Asking({
                mode: RunMode.Campaign(),
                tutorial: 'Tutorial',
              }),
            )
          }),
        ),
      ),
  )

  it.effect('a tutorial pick with no card up does nothing', () =>
    modelAfter(
      firstVisit,
      steps(
        chooseTutorial('Skip'),
        expectNoCommand,
        checkModel(current => {
          expect(current.difficultyCard).toEqual(DifficultyCard.Unseen)
          expect(current.lessons).toEqual(freshLessons)
        }),
      ),
    ),
  )

  it.effect(
    'SKIP IT and a difficulty start a run with no practice gate, no hints, no guided first break, no kitchen tour, and no hello from Rattles, kept in the save',
    () =>
      Effect.gen(function* () {
        const current = yield* modelAfter(
          firstVisit,
          steps(
            send(Message.ClickedCampaignButton()),
            chooseTutorial('Skip'),
            pickNormal,
            expectWrite,
            checkModel(started => {
              expect(saveOf(started).onboarding.lessons).toEqual({
                move: 'Learned',
                fire: 'Learned',
                startWave: 'Pending',
                swap: 'Pending',
                pickup: 'Pending',
                timedBreaks: 'Learned',
                openBreak: 'Learned',
                dareTour: 'Learned',
                dareKey: 'Learned',
                rattles: 'Learned',
                displayCase: 'Pending',
                dareCard: 'Pending',
                gunLevel: 'Pending',
              })
            }),
            writeSave,
            tick(50),
            tick(3000),
            throughIntro,
            writeSave,
            checkModel(later => {
              expect(Phase.guards.Preparation(later.phase)).toBe(true)
              expect(later.difficulty.chosen).toBe('Normal')
              expect(isPracticeGateHeld(later)).toBe(false)
              expect(hintIds(later)).toEqual([])
              expect(isKitchenTourDue(later)).toBe(false)
            }),
          ),
        )
        const isGuided = yield* isGuidedFirstBreakOn(current)
        expect(isGuided).toBe(false)
        const isHelloOn = yield* isRattlesHelloOn(current)
        expect(isHelloOn).toBe(false)

        const nextVisit = reloaded(current)
        expect(isLearned(nextVisit.lessons.move)).toBe(true)
        expect(isLearned(nextVisit.lessons.fire)).toBe(true)
        expect(isKitchenTourDue(nextVisit)).toBe(false)
        expect(nextVisit.introducedKinds).toEqual([])
        const isGuidedNextVisit = yield* isGuidedFirstBreakOn(nextVisit)
        expect(isGuidedNextVisit).toBe(false)
        const isHelloOnNextVisit = yield* isRattlesHelloOn(nextVisit)
        expect(isHelloOnNextVisit).toBe(false)
      }),
  )

  it.effect('TUTORIAL, the default, starts the tutorial', () =>
    Effect.gen(function* () {
      const current = yield* modelAfter(
        firstVisit,
        steps(
          send(Message.ClickedCampaignButton()),
          pickNormal,
          writeSave,
          tick(50),
          tick(3000),
          throughIntro,
          writeSave,
          checkModel(later => {
            expect(Phase.guards.Preparation(later.phase)).toBe(true)
            expect(isPracticeGateHeld(later)).toBe(true)
            expect(hintIds(later)).toContain('Move')
            expect(isKitchenTourDue(later)).toBe(true)
            expect(later.lessons.dareTour).toEqual(Lesson.Pending())
          }),
        ),
      )
      const isGuided = yield* isGuidedFirstBreakOn(current)
      expect(isGuided).toBe(true)
      const isHelloOn = yield* isRattlesHelloOn(current)
      expect(isHelloOn).toBe(true)
    }),
  )

  it.effect("Settings' Reset tutorial brings a skipped tutorial back", () =>
    Effect.gen(function* () {
      const skippedRun = yield* modelAfter(
        firstVisit,
        steps(
          send(Message.ClickedCampaignButton()),
          chooseTutorial('Skip'),
          pickNormal,
          writeSave,
        ),
      )
      const skipped = UiStruct.evolve(reloaded(skippedRun), {
        saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
      })
      const isGuidedSkipped = yield* isGuidedFirstBreakOn(skipped)
      expect(isGuidedSkipped).toBe(false)
      const reset = yield* modelAfter(
        skipped,
        steps(
          send(Message.ClickedSettingsButton()),
          send(Message.ClickedResetTutorial()),
          resolveFocusProfile,
          send(Message.ConfirmedTutorialReset()),
          expectWrite,
          checkModel(current => {
            expect(current.lessons).toEqual(freshLessons)
            expect(isKitchenTourDue(current)).toBe(true)
          }),
          resolveFocusProfile,
          writeSave,
        ),
      )
      const isGuidedReset = yield* isGuidedFirstBreakOn(reset)
      expect(isGuidedReset).toBe(true)
    }),
  )
})

describe('PLAY TUTORIAL', () => {
  const returning: Model = UiStruct.evolve(asTutorialDone(readyModel), {
    rank: rank =>
      UiStruct.evolve(rank, {
        earnedPoints: () => 4_200,
        earnedBones: () => 30,
        spentBones: () => 12,
      }),
    appearance: appearance =>
      UiStruct.evolve(appearance, { hat: () => 'TopHat' }),
    bests: bests =>
      UiStruct.evolve(bests, {
        runsPlayed: () => 12,
        totalKills: () => 40,
        killsByKind: kills => UiStruct.evolve(kills, { Runner: () => 40 }),
      }),
    home: home =>
      UiStruct.evolve(home, {
        bots: () => [
          { name: 'Gus', calling: 'Handyman', look: defaultAppearance },
        ],
      }),
    modifiers: modifiers => UiStruct.evolve(modifiers, { glass: () => true }),
    saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
  })

  it.effect(
    'forgets every lesson, keeps progress, and starts the practice run',
    () =>
      Effect.gen(function* () {
        const started = yield* modelAfter(
          returning,
          steps(
            press('KeyI'),
            send(Message.ClickedPlayTutorialButton()),
            expectWrite,
            checkModel(current => {
              expect(current.lessons).toEqual(freshLessons)
              expect(
                Array.every(Record.values(current.lessons), isPending),
              ).toBe(true)
              expect(current.phase).toMatchObject({
                _tag: 'Arriving',
                cut: 'Full',
              })
              expect(RunMode.guards.Campaign(current.mode)).toBe(true)
              expect(current.runStart.crewBots).toEqual([])
              expect(current.modifiers).toEqual(noModifiers)
              expect(current.firstBreakQuest).toEqual(QuestTour.Waiting())
              expect(current.introducedKinds).toEqual([])
              const before = saveOf(returning)
              const after = saveOf(current)
              expect(after.rank).toEqual(before.rank)
              expect(after.appearance).toEqual(before.appearance)
              expect(after.boughtCosmetics).toEqual(before.boughtCosmetics)
              expect(after.bests).toEqual(before.bests)
              expect(after.home.openedEntries).toEqual(
                before.home.openedEntries,
              )
              expect(after.difficulty).toEqual(before.difficulty)
            }),
            settleRunCommands,
            throughIntro,
            checkModel(later => {
              expect(Phase.guards.Preparation(later.phase)).toBe(true)
              expect(isPracticeGateHeld(later)).toBe(true)
              expect(hintIds(later)).toContain('Move')
              expect(isKitchenTourDue(later)).toBe(true)
            }),
            settleRunCommands,
          ),
        )
        const isGuided = yield* isGuidedFirstBreakOn(started)
        expect(isGuided).toBe(true)
        const isHelloOn = yield* isRattlesHelloOn(started)
        expect(isHelloOn).toBe(true)
      }),
  )

  it.effect('does nothing while How to play is shut', () =>
    modelAfter(
      returning,
      steps(
        send(Message.ClickedPlayTutorialButton()),
        expectNoCommand,
        checkModel(current => {
          expect(current.lessons).toEqual(returning.lessons)
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
      ),
    ),
  )
})
