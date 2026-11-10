import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  BreakClock,
  CaseState,
  CrateStock,
  Feat,
  type Model,
  Party,
  Phase,
  QuestTour,
  type Vector,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { forgetTutorial } from '../../../platform/save'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { DISTANT_SPAWN, newPlayerCardSeen } from '../../../test/model.fixture'
import {
  APPLICATION,
  HOLD_TICKS,
  SHOWN_TICKS,
  changeModel,
  hintIds,
  holdEnter,
  mouseDown,
  press,
  release,
  startWave,
  startedRun,
  tap,
  throughIntro,
  tick,
  ticks,
} from '../../../test/testing'
import { asTutorialDone, asVeteran } from '../../../test/veteran'
import { caseBoxOf } from '../../../world/feats/caseSpots'
import { crateSpotOf } from '../../../world/gear/crates'
import { heldKeys } from '../../../world/keys/keys'
import { levelOf } from '../../../world/level/arena'
import {
  focusOf,
  modifyFocus,
  modifySeat,
  seatStateAt,
} from '../../../world/party/party'
import { isPending } from '../../../world/run/lessons'
import {
  DARE_TOUR_WAVE,
  maybeTutorialCase,
  tutorialKeySpotOf,
} from '../../../world/run/tutorialRules'
import { ZOMBIE_KIND_ORDER } from '../../../world/zombies/zombies'
import {
  type QuestStep,
  isQuestOnCard,
  maybeQuestMark,
  questStepOf,
} from '../firstBreakQuest'
import { isStartWaveBeckoning } from '../onboarding'

// NOTE: the guided first break (src/features/onboarding/firstBreakQuest.ts):
// a new player learns the dare by doing it. Grab the key on the floor, take
// the trap from the dining room's crate, take the prize from the case that
// opened in the practice wave, and look at the dare card.

const FRAME_MS = FIXED_STEP_MS
const TICK_MS = 50
const LOOK_FRAMES = Math.ceil(2600 / FRAME_MS) + 1

const frame = tick(FRAME_MS)

// NOTE: a new save on a measured surface, its zombies all met so no new
// zombie card holds the practice wave.
const newSave: Model = modifyFields(newPlayerCardSeen, {
  introducedKinds: () => ZOMBIE_KIND_ORDER,
})

const standAt =
  (spot: Vector) =>
  (current: Model): Model =>
    modifyFocus(current, {
      player: player =>
        modifyFields(player, { x: () => spot.x, y: () => spot.y }),
    })

// NOTE: where a player stands to take the tour's case: just below its box.
const belowTutorialCase = (current: Model): Vector => {
  const box = caseBoxOf(
    levelOf(current),
    Option.getOrThrow(maybeTutorialCase(current)),
  )
  return { x: (box.left + box.right) / 2, y: box.bottom + 8 }
}

// NOTE: the sim's own rule for the practice wave: the player has made 5
// kills, and every zombie of the wave is gone.
const wonPracticeWave = (current: Model): Model =>
  modifyFields(
    modifySeat(current, 0, {
      feats: feats => modifyFields(feats, { kills: () => 5 }),
    }),
    {
      zombies: () => [],
      phase: phase =>
        Phase.isAnyOf(['Wave'])(phase)
          ? modifyFields(phase, { spawns: () => [] })
          : phase,
    },
  )

// NOTE: moving and shooting in the practice wave's break, as the hints ask.
const practise = Story.steps(
  press('KeyD'),
  ...ticks(10, TICK_MS),
  release('KeyD'),
  Story.message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
  mouseDown(700, 100),
  ...ticks(SHOWN_TICKS, TICK_MS),
  Story.message(Message.ReleasedPointer({ pointerId: 1 })),
)

const stepOf = (current: Model): Option.Option<QuestStep> =>
  questStepOf(current)

// NOTE: the break before wave 2, a frame in, with the case already sprung.
const reachFirstBreak = Story.steps(
  tap('Enter'),
  throughIntro,
  practise,
  startWave,
  changeModel(wonPracticeWave),
  frame,
  frame,
)

// NOTE: the tour's break set straight, for the checks that need no run.
const tourBreak = (base: Model): Model =>
  modifyFields(base, {
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
    'walks a new save from the intro and the practice wave through the key, the trap, the case, and the dare card',
    () =>
      Story.story(
        APPLICATION,
        Story.given(newSave),
        tap('Enter'),
        throughIntro,
        Story.model(current => {
          expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
          expect(hintIds(current)).toEqual(['Move', 'Fire'])
          expect(
            Option.map(maybeTutorialCase(current), ({ feat }) => feat),
          ).toEqual(Option.some(Feat.Kills({ count: 5 })))
        }),
        practise,
        startWave,
        Story.model(current => {
          expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
          expect(stepOf(current)).toEqual(Option.none())
        }),
        changeModel(wonPracticeWave),
        frame,
        frame,
        Story.model(current => {
          expect(current.phase).toMatchObject({
            _tag: 'Preparation',
            wave: DARE_TOUR_WAVE,
          })
          expect(
            Option.map(maybeTutorialCase(current), ({ state }) => state),
          ).toEqual(Option.some(CaseState.Opened({ by: 0 })))
          expect(current.firstBreakQuest).toEqual(QuestTour.Running())
          expect(stepOf(current)).toEqual(Option.some('Key'))
          expect(maybeQuestMark(current)).toEqual(
            Option.some(tutorialKeySpotOf(current)),
          )
        }),
        changeModel(current => standAt(tutorialKeySpotOf(current))(current)),
        frame,
        Story.model(current => {
          expect(isPending(current.lessons.dareKey)).toBe(false)
          expect(
            Array.some(current.frameEvents, ({ _tag }) => _tag === 'KeysFound'),
          ).toBe(true)
          expect(stepOf(current)).toEqual(Option.some('Trap'))
          expect(maybeQuestMark(current)).toEqual(
            Option.some(crateSpotOf(levelOf(current), 'Dining')),
          )
        }),
        changeModel(current =>
          standAt(crateSpotOf(levelOf(current), 'Dining'))(current),
        ),
        frame,
        Story.model(current => {
          expect(focusOf(current).trapStock.Barricade).toBe(1)
          expect(stepOf(current)).toEqual(Option.some('Case'))
        }),
        changeModel(current => standAt(belowTutorialCase(current))(current)),
        ...holdEnter(HOLD_TICKS + 2),
        Story.model(current => {
          expect(
            Option.map(maybeTutorialCase(current), ({ state }) => state),
          ).toEqual(Option.some(CaseState.Emptied({ by: 0 })))
          expect(stepOf(current)).toEqual(Option.some('Card'))
          expect(isQuestOnCard(current)).toBe(true)
          expect(QuestTour.isAnyOf(['Looking'])(current.firstBreakQuest)).toBe(
            true,
          )
          expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
        }),
        ...ticks(LOOK_FRAMES, FRAME_MS),
        Story.model(current => {
          expect(QuestTour.isAnyOf(['Done'])(current.firstBreakQuest)).toBe(
            true,
          )
          expect(isPending(current.lessons.dareTour)).toBe(false)
          expect(stepOf(current)).toEqual(Option.none())
          expect(isStartWaveBeckoning(current)).toBe(true)
        }),
        Story.Command.resolveAll(),
      ),
  )

  it.effect('the key lies there once: taken, it is not on the next run', () =>
    Effect.gen(function* () {
      const taken = yield* Story.story(
        APPLICATION,
        Story.given(newSave),
        reachFirstBreak,
        changeModel(current => standAt(tutorialKeySpotOf(current))(current)),
        frame,
        Story.Command.resolveAll(),
      )
      expect(isPending(taken.lessons.dareKey)).toBe(false)
      const keys = heldKeys(taken)
      return yield* Story.story(
        APPLICATION,
        Story.given(taken),
        frame,
        Story.model(current => {
          expect(heldKeys(current)).toBe(keys)
          expect(stepOf(current)).toEqual(Option.some('Trap'))
        }),
      )
    }),
  )

  it.effect('the skip button ends it at any step, for good', () =>
    Story.story(
      APPLICATION,
      Story.given(newSave),
      reachFirstBreak,
      Story.message(Message.ClickedSkipQuestButton()),
      Story.model(skipped => {
        expect(skipped.firstBreakQuest).toEqual(QuestTour.Over())
        expect(isPending(skipped.lessons.dareTour)).toBe(false)
      }),
      frame,
      Story.model(current => {
        expect(stepOf(current)).toEqual(Option.none())
        expect(maybeQuestMark(current)).toEqual(Option.none())
      }),
      Story.Command.resolveAll(),
    ),
  )

  it.effect('starting the wave ends it', () =>
    Story.story(
      APPLICATION,
      Story.given(newSave),
      reachFirstBreak,
      startWave,
      Story.model(waved => {
        expect(Phase.isAnyOf(['Wave'])(waved.phase)).toBe(true)
      }),
      frame,
      Story.model(current => {
        expect(current.firstBreakQuest).toEqual(QuestTour.Over())
        expect(isPending(current.lessons.dareTour)).toBe(false)
      }),
      Story.Command.resolveAll(),
    ),
  )

  // NOTE: the tour hands the player a Plank Pile, so a new save's dining
  // room crate holds one whatever the run's seed.
  it.effect('the dining room crate holds a Plank Pile in the tour', () =>
    Effect.forEach([1, 2, 3, 4, 5, 6], seed =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(tourBreak(newSave), {
            crates: crates =>
              modifyFields(crates, { rngState: () => seed * 7919 }),
          }),
        ),
        frame,
        Story.model(current => {
          expect(
            Array.map(current.crates.crates, ({ stock }) => stock),
          ).toEqual([CrateStock.Stocked({ trap: 'Barricade' })])
        }),
      ),
    ),
  )

  it.effect('a returning player never sees any of it', () =>
    Effect.gen(function* () {
      const veteran = modifyFields(asVeteran(newSave), {
        maybeSurface: () => newSave.maybeSurface,
      })
      const started = yield* startedRun(veteran)
      expect(Phase.isAnyOf(['Preparation'])(started.phase)).toBe(true)
      const caseFeats = Array.map(started.cases, ({ feat }) => feat)
      expect(caseFeats).not.toContainEqual(Feat.Kills({ count: 5 }))
      yield* Story.story(
        APPLICATION,
        Story.given(tourBreak(veteran)),
        frame,
        Story.model(current => {
          expect(current.firstBreakQuest).toEqual(QuestTour.Waiting())
          expect(stepOf(current)).toEqual(Option.none())
          expect(maybeQuestMark(current)).toEqual(Option.none())
        }),
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(tourBreak(asTutorialDone(asVeteran(initialModel)))),
        frame,
        Story.model(current => {
          expect(stepOf(current)).toEqual(Option.none())
        }),
      )
    }),
  )

  it.effect('a tutorial reset plays it again', () =>
    Story.story(
      APPLICATION,
      Story.given(tourBreak(forgetTutorial(asTutorialDone(newSave)))),
      frame,
      Story.model(current => {
        expect(current.firstBreakQuest).toEqual(QuestTour.Running())
      }),
    ),
  )

  it.effect('in co-op it never runs', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(tourBreak(newSave), { party: () => Party.Crew() }),
      ),
      frame,
      Story.model(current => {
        expect(stepOf(current)).toEqual(Option.none())
        expect(seatStateAt(current, 0).trapStock.Barricade).toBe(0)
      }),
    ),
  )
})
