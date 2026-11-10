import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { ProfileBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import {
  BreakClock,
  DifficultyCard,
  Lesson,
  type Model,
  Phase,
  RunMode,
  Tour,
  type TutorialChoice,
  freshLessons,
} from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import {
  decodeSave,
  encodeSave,
  restoreSave,
  saveOf,
} from '../../../platform/save'
import {
  FIXED_STEP_MS,
  KITCHEN_FIRST_WAVE,
  SHOP_FIRST_WAVE,
} from '../../../shared/constants'
import { DISTANT_SPAWN, newPlayerReady } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  hintIds,
  showDialog,
  throughIntro,
  tick,
  writeSave,
} from '../../../test/testing'
import { isPending, isPracticeGateHeld } from '../../../world/run/lessons'
import { isKitchenTourOn } from '../../../world/run/tutorialRules'
import { Message as ProfileMessage } from '../../profile/message'
import { FocusTutorialReset } from '../../profile/update'
import { isLearned } from '../onboarding'

// NOTE: the first-run card's TUTORIAL or SKIP IT (owner, 2026-11-07). SKIP
// IT starts the run as a returning player's: no practice gate, no move or
// aim hints, no guided first break, no kitchen tour, kept in the save. The
// default still plays the tutorial, and Settings' Reset tutorial brings it
// back.

const firstVisit: Model = modifyFields(newPlayerReady, {
  saveStatus: () => 'Read',
})

const chooseTutorial = (choice: TutorialChoice) =>
  Story.message(Message.ClickedTutorialChoiceButton({ choice }))

const pickNormal = Story.message(
  Message.ClickedDifficultyCardButton({ difficulty: 'Normal' }),
)

// NOTE: whether the same player, at the break before the shop's first wave,
// a frame in so the guided first break has had its chance to start, is
// guided through it.
const isGuidedFirstBreakOn = (current: Model) =>
  Story.story(
    APPLICATION,
    Story.given(
      modifyFields(current, {
        phase: () =>
          Phase.Preparation({
            wave: SHOP_FIRST_WAVE,
            remainingMs: 20_000,
            durationMs: 20_000,
            spawns: [DISTANT_SPAWN],
            clock: BreakClock.Waiting({ elapsedMs: 0 }),
          }),
      }),
    ),
    tick(FIXED_STEP_MS),
  ).pipe(
    Effect.map(
      firstBreak =>
        Tour.isAnyOf(['Running'])(firstBreak.firstBreakQuest) ||
        isPending(firstBreak.lessons.openBreak),
    ),
  )

const isKitchenTourDue = (current: Model): boolean =>
  isKitchenTourOn(
    modifyFields(current, {
      phase: () =>
        Phase.Preparation({
          wave: KITCHEN_FIRST_WAVE,
          remainingMs: 15_000,
          durationMs: 15_000,
          spawns: [],
        }),
    }),
  )

// NOTE: the save the run wrote, through JSON and back into a fresh Model,
// as the next visit reads it.
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
      Story.story(
        APPLICATION,
        Story.given(firstVisit),
        Story.message(Message.ClickedCampaignButton()),
        showDialog(),
        Story.model(current => {
          expect(current.difficultyCard).toEqual(
            DifficultyCard.Asking({
              mode: RunMode.Campaign(),
              tutorial: 'Tutorial',
            }),
          )
        }),
        chooseTutorial('Skip'),
        Story.model(current => {
          expect(current.difficultyCard).toEqual(
            DifficultyCard.Asking({
              mode: RunMode.Campaign(),
              tutorial: 'Skip',
            }),
          )
          expect(current.lessons).toEqual(freshLessons)
        }),
        chooseTutorial('Tutorial'),
        Story.model(current => {
          expect(current.difficultyCard).toEqual(
            DifficultyCard.Asking({
              mode: RunMode.Campaign(),
              tutorial: 'Tutorial',
            }),
          )
        }),
      ),
  )

  it.effect('a tutorial pick with no card up does nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(firstVisit),
      chooseTutorial('Skip'),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(current.difficultyCard).toEqual(DifficultyCard.Unseen())
        expect(current.lessons).toEqual(freshLessons)
      }),
    ),
  )

  it.effect(
    'SKIP IT and a difficulty start a run with no practice gate, no hints, no guided first break, and no kitchen tour, kept in the save',
    () =>
      Effect.gen(function* () {
        const current = yield* Story.story(
          APPLICATION,
          Story.given(firstVisit),
          Story.message(Message.ClickedCampaignButton()),
          showDialog(),
          chooseTutorial('Skip'),
          pickNormal,
          closeDialog(),
          Story.Command.expectHas(WriteSave),
          Story.model(started => {
            expect(saveOf(started).onboarding.lessons).toEqual({
              move: 'Learned',
              fire: 'Learned',
              startWave: 'Pending',
              shop: 'Pending',
              swap: 'Pending',
              pickup: 'Pending',
              timedBreaks: 'Learned',
              openBreak: 'Learned',
            })
          }),
          writeSave(),
          tick(50),
          tick(3000),
          throughIntro,
          Story.model(later => {
            expect(Phase.guards.Preparation(later.phase)).toBe(true)
            expect(later.difficulty.chosen).toBe('Normal')
            expect(isPracticeGateHeld(later)).toBe(false)
            expect(hintIds(later)).toEqual([])
            expect(isKitchenTourDue(later)).toBe(false)
          }),
        )
        const isGuided = yield* isGuidedFirstBreakOn(current)
        expect(isGuided).toBe(false)

        const nextVisit = reloaded(current)
        expect(isLearned(nextVisit.lessons.move)).toBe(true)
        expect(isLearned(nextVisit.lessons.fire)).toBe(true)
        expect(isKitchenTourDue(nextVisit)).toBe(false)
        expect(nextVisit.introducedKinds).toEqual([])
        const isGuidedNextVisit = yield* isGuidedFirstBreakOn(nextVisit)
        expect(isGuidedNextVisit).toBe(false)
      }),
  )

  it.effect('TUTORIAL, the default, starts the tutorial', () =>
    Effect.gen(function* () {
      const current = yield* Story.story(
        APPLICATION,
        Story.given(firstVisit),
        Story.message(Message.ClickedCampaignButton()),
        showDialog(),
        pickNormal,
        closeDialog(),
        writeSave(),
        tick(50),
        tick(3000),
        throughIntro,
        Story.model(later => {
          expect(Phase.guards.Preparation(later.phase)).toBe(true)
          expect(isPracticeGateHeld(later)).toBe(true)
          expect(hintIds(later)).toContain('Move')
          expect(isKitchenTourDue(later)).toBe(true)
          expect(later.lessons.openBreak).toEqual(Lesson.Pending())
        }),
      )
      const isGuided = yield* isGuidedFirstBreakOn(current)
      expect(isGuided).toBe(true)
    }),
  )

  it.effect("Settings' Reset tutorial brings a skipped tutorial back", () =>
    Effect.gen(function* () {
      const skippedRun = yield* Story.story(
        APPLICATION,
        Story.given(firstVisit),
        Story.message(Message.ClickedCampaignButton()),
        showDialog(),
        chooseTutorial('Skip'),
        pickNormal,
        closeDialog(),
        writeSave(),
      )
      const skipped = modifyFields(reloaded(skippedRun), {
        saveStatus: () => 'Read',
      })
      const isGuidedSkipped = yield* isGuidedFirstBreakOn(skipped)
      expect(isGuidedSkipped).toBe(false)
      const reset = yield* Story.story(
        APPLICATION,
        Story.given(skipped),
        Story.message(Message.ClickedSettingsButton()),
        showDialog(),
        Story.messageIn(
          ProfileBinding,
          ProfileMessage.ClickedResetTutorialButton(),
        ),
        Story.Command.resolve(
          FocusTutorialReset,
          ProfileMessage.CompletedFocusTutorialReset(),
        ),
        Story.messageIn(
          ProfileBinding,
          ProfileMessage.ClickedConfirmResetTutorialButton(),
        ),
        Story.Command.expectHas(WriteSave),
        Story.model(current => {
          expect(current.lessons).toEqual(freshLessons)
          expect(isKitchenTourDue(current)).toBe(true)
        }),
        Story.Command.resolve(
          FocusTutorialReset,
          ProfileMessage.CompletedFocusTutorialReset(),
        ),
        writeSave(),
      )
      const isGuidedReset = yield* isGuidedFirstBreakOn(reset)
      expect(isGuidedReset).toBe(true)
    }),
  )
})
