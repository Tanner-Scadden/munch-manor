import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  BreakClock,
  CrateStock,
  Invulnerability,
  type Model,
  Party,
  Phase,
  Tour,
  TrapHint,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { forgetTutorial } from '../../../platform/save'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import { APPLICATION, BELOW_NORTH_DOOR, press } from '../../../test/testing'
import { asTutorialDone, asVeteran } from '../../../test/veteran'
import { crateSpotOf } from '../../../world/gear/crates'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { type QuestStep, maybeQuestMark, questStepOf } from '../firstBreakQuest'
import { isStartWaveBeckoning } from '../onboarding'

// NOTE: the guided first break (src/features/onboarding/firstBreakQuest.ts): grab the Plank
// Pile from the parlour's trap crate, place it, then START WAVE.

const FRAME_MS = FIXED_STEP_MS

// NOTE: a new save's first break: it has played wave 1, so it has moved
// and fired.
const firstBreak = (base: Model = asVeteran(initialModel)): Model =>
  modifyFocus(
    modifyFields(base, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: PREPARATION_MS,
          durationMs: PREPARATION_MS,
          spawns: [DISTANT_SPAWN],
          clock: BreakClock.Waiting({ elapsedMs: 0 }),
        }),
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => BELOW_NORTH_DOOR.x,
          y: () => BELOW_NORTH_DOOR.y,
          facing: () => ({ x: 1, y: 0 }),
          invulnerability: () =>
            Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
        }),
    },
  )

const stepOf = (current: Model): Option.Option<QuestStep> =>
  questStepOf(current)

// NOTE: the player stepped onto the parlour's trap crate.
const onCrate = (current: Model): Model => {
  const spot = crateSpotOf('Dining')
  return modifyFocus(current, {
    player: player =>
      modifyFields(player, { x: () => spot.x, y: () => spot.y }),
  })
}

const offCrate = (current: Model): Model =>
  modifyFocus(current, {
    player: player =>
      modifyFields(player, {
        x: () => BELOW_NORTH_DOOR.x,
        y: () => BELOW_NORTH_DOOR.y,
      }),
  })

const frame = Story.message(Message.TickedFrame({ deltaTime: FRAME_MS }))

describe('the guided first break', () => {
  it.effect(
    'walks a new player from the crate to placing, then START WAVE',
    () =>
      Effect.gen(function* () {
        const started = yield* Story.story(
          APPLICATION,
          Story.given(firstBreak()),
          frame,
          Story.model(current => {
            expect(current.firstBreakQuest).toEqual(Tour.Running())
            expect(stepOf(current)).toEqual(Option.some('Grab'))
            expect(maybeQuestMark(current)).toEqual(
              Option.some(crateSpotOf('Dining')),
            )
          }),
        )
        const grabbed = yield* Story.story(
          APPLICATION,
          Story.given(onCrate(started)),
          frame,
          Story.model(current => {
            expect(focusOf(current).trapStock.Barricade).toBe(1)
            expect(stepOf(current)).toEqual(Option.some('Place'))
          }),
        )
        const ready = offCrate(grabbed)
        expect(maybeQuestMark(ready)).not.toEqual(
          Option.some(crateSpotOf('Dining')),
        )
        expect(Option.isSome(maybeQuestMark(ready))).toBe(true)

        yield* Story.story(
          APPLICATION,
          Story.given(ready),
          press('KeyT'),
          Story.model(current => {
            expect(current.trapHint).toEqual(TrapHint.Seen())
          }),
          frame,
          Story.model(current => {
            expect(Tour.isAnyOf(['Done'])(current.firstBreakQuest)).toBe(true)
            expect(stepOf(current)).toEqual(Option.none())
            expect(isStartWaveBeckoning(current)).toBe(true)
          }),
          Story.Command.resolveAll(),
        )
      }),
  )

  // NOTE: the tutorial teaches the Plank Pile, so a new player's parlour
  // crate holds one whatever the run's seed.
  it.effect('the parlour crate holds a Plank Pile in the first break', () =>
    Effect.forEach([1, 2, 3, 4, 5, 6], seed =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(firstBreak(), {
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

  it.effect('the skip button ends it at any step', () =>
    Story.story(
      APPLICATION,
      Story.given(firstBreak()),
      frame,
      Story.message(Message.ClickedSkipQuestButton()),
      Story.model(skipped => {
        expect(skipped.firstBreakQuest).toEqual(Tour.Over())
      }),
      frame,
      Story.model(current => {
        expect(stepOf(current)).toEqual(Option.none())
      }),
    ),
  )

  it.effect('starting the wave ends it', () =>
    Story.story(
      APPLICATION,
      Story.given(firstBreak()),
      frame,
      Story.message(Message.ClickedStartWaveButton()),
      Story.model(waved => {
        expect(Phase.isAnyOf(['Wave'])(waved.phase)).toBe(true)
      }),
      frame,
      Story.model(current => {
        expect(current.firstBreakQuest).toEqual(Tour.Over())
      }),
    ),
  )

  it.effect(
    'runs once per save: a player who has placed a trap never sees it',
    () => {
      const trapper = firstBreak(
        modifyFields(asVeteran(initialModel), {
          trapHint: () => TrapHint.Seen(),
        }),
      )
      const done = firstBreak(asTutorialDone(asVeteran(initialModel)))
      return Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(trapper),
          frame,
          Story.model(current => {
            expect(current.firstBreakQuest).toEqual(Tour.Waiting())
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(done),
          frame,
          Story.model(current => {
            expect(stepOf(current)).toEqual(Option.none())
          }),
        )
      })
    },
  )

  it.effect('a tutorial reset plays it again', () =>
    Story.story(
      APPLICATION,
      Story.given(
        firstBreak(
          forgetTutorial(firstBreak(asTutorialDone(asVeteran(initialModel)))),
        ),
      ),
      frame,
      Story.model(current => {
        expect(current.firstBreakQuest).toEqual(Tour.Running())
      }),
    ),
  )

  it.effect('in co-op it never runs', () => {
    const crew = modifyFields(firstBreak(), {
      party: () => Party.Crew(),
    })
    return Story.story(
      APPLICATION,
      Story.given(crew),
      frame,
      Story.model(current => {
        expect(stepOf(current)).toEqual(Option.none())
      }),
    )
  })
})
