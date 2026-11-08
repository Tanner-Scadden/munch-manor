import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  BreakClock,
  Invulnerability,
  Lesson,
  type Model,
  Party,
  Phase,
  ShopState,
  Tour,
  TrapHint,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { forgetTutorial } from '../../../platform/save'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_NORTH_DOOR,
  buyAtCounter,
  press,
} from '../../../test/testing'
import { asTutorialDone, asVeteran } from '../../../test/veteran'
import { TRAPS } from '../../../world/gear/traps'
import { focusOf, focusSlotOf, modifyFocus } from '../../../world/party/party'
import { isFirstPlankFree, priceFor } from '../../../world/shop/shop'
import { type QuestStep, maybeQuestDoor, questStepOf } from '../firstBreakQuest'
import { isStartWaveBeckoning } from '../onboarding'

// NOTE: the guided first break (src/features/onboarding/firstBreakQuest.ts): walk to Rattles,
// buy a Plank Pile (free this once), place it, then START WAVE.

const FRAME_MS = FIXED_STEP_MS

// NOTE: a new save's first break: it has played wave 1, so it has moved
// and fired, and has a little money, short of a Plank Pile.
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
      wallet: wallet => ({ ...wallet, balance: 12, shown: 12, earned: 12 }),
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

const browsing = (current: Model): Model =>
  modifyFocus(current, {
    shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
    shopCategory: () => 'Traps',
  })

// NOTE: the Plank Pile's row picked in Rattles' shop dialog.
const buyPlanks = buyAtCounter('Barricade')

const frame = Story.message(Message.TickedFrame({ deltaTime: FRAME_MS }))

const away = (current: Model): Model =>
  modifyFocus(current, { shop: () => ShopState.Dismissed() })

describe('the guided first break', () => {
  it.effect(
    'walks a new player from the stall to buying to placing, then START WAVE',
    () =>
      Effect.gen(function* () {
        const started = yield* Story.story(
          APPLICATION,
          Story.given(firstBreak()),
          frame,
          Story.model(current => {
            expect(current.firstBreakQuest).toEqual(Tour.Running())
            expect(stepOf(current)).toEqual(Option.some('Shop'))
          }),
        )
        const bought = yield* Story.story(
          APPLICATION,
          Story.given(browsing(started)),
          Story.model(current => {
            expect(stepOf(current)).toEqual(Option.some('Buy'))
          }),
          buyPlanks,
          Story.model(current => {
            expect(focusOf(current).trapStock.Barricade).toBe(1)
          }),
        )
        expect(stepOf(away(bought))).toEqual(Option.some('Place'))
        expect(Option.isSome(maybeQuestDoor(away(bought)))).toBe(true)

        yield* Story.story(
          APPLICATION,
          Story.given(away(bought)),
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

  it.effect('with no money for it, the first Plank Pile is free', () =>
    Effect.gen(function* () {
      const started = yield* Story.story(
        APPLICATION,
        Story.given(firstBreak()),
        frame,
      )
      expect(focusOf(started).wallet.balance).toBeLessThan(
        TRAPS.Barricade.price,
      )
      expect(priceFor(started, focusSlotOf(started), 'Barricade')).toBe(0)
      yield* Story.story(
        APPLICATION,
        Story.given(browsing(started)),
        buyPlanks,
        Story.model(bought => {
          expect(focusOf(bought).trapStock.Barricade).toBe(1)
          expect(focusOf(bought).wallet.balance).toBe(
            focusOf(started).wallet.balance,
          )
          expect(priceFor(bought, focusSlotOf(bought), 'Barricade')).toBe(
            TRAPS.Barricade.price,
          )
        }),
      )
    }),
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
    'runs once per save: a player who has shopped or bought a trap never sees it',
    () => {
      const shopped = firstBreak(
        modifyFields(asVeteran(initialModel), {
          lessons: lessons =>
            modifyFields(lessons, { shop: () => Lesson.Learned({ atMs: 0 }) }),
        }),
      )
      const trapper = firstBreak(
        modifyFields(asVeteran(initialModel), {
          trapHint: () => TrapHint.Seen(),
        }),
      )
      const done = firstBreak(asTutorialDone(asVeteran(initialModel)))
      expect(isFirstPlankFree(done, focusSlotOf(done), 'Barricade')).toBe(false)
      return Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(shopped),
          frame,
          Story.model(current => {
            expect(current.firstBreakQuest).toEqual(Tour.Waiting())
          }),
        )
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

  it.effect('in co-op it never runs and planks cost full price', () => {
    const crew = modifyFields(firstBreak(), {
      party: () => Party.Crew(),
    })
    expect(isFirstPlankFree(crew, focusSlotOf(crew), 'Barricade')).toBe(false)
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
