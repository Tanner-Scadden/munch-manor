import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { levelOf } from './arena'
import { cameraOf } from './camera'
import { FIXED_STEP_MS } from './constants'
import { EXIT_RULES, exitPriceFor } from './exits'
import { isKitchenOpen } from './kitchen'
import { type KitchenStep, kitchenStepOf } from './kitchenTour'
import {
  FRIDGE_RULES,
  fridgePriceFor,
  isFridgePrizeWeapon,
  pickPrize,
  prizeWeights,
} from './leftovers'
import { update } from './main'
import { Message } from './message'
import {
  FridgeDoor,
  type FridgePrize,
  type Model,
  Party,
  Phase,
  Tour,
} from './model'
import { AT_FRIDGE, atFridge, freshRunModel } from './model.fixture'
import { soloSeat } from './party'
import { nextRandom } from './prng'
import { forgetTutorial } from './save'
import { maybeBubbleKind } from './stallBubble'
import {
  BELOW_KITCHEN_DOOR,
  FRIDGE_OPEN_TICKS,
  HOLD_TICKS,
  nextFrame,
} from './testing'
import { isKitchenTourOn } from './tutorialRules'
import { asTutorialDone } from './veteran'

// NOTE: chapter 2 of the guided tutorial (src/kitchenTour.ts and
// src/tutorialRules.ts): in a new save's first timed break the clock holds
// still, the kitchen and the first fridge pull are free, the pull is a
// weapon, and the clock runs again once the fridge has been tried.

const FRAME_MS = FIXED_STEP_MS
const OFFER_FRAMES = Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) + 2
const BREAK_MS = 15_000

const frames = (current: Model, count: number): Model =>
  Array.reduce(
    Array.makeBy(count, () => 0),
    current,
    nextFrame,
  )

const holdEnter = (current: Model): Model =>
  update(
    frames(
      update(current, Message.PressedKey({ code: 'Enter' })).model,
      HOLD_TICKS,
    ),
    Message.ReleasedKey({ code: 'Enter' }),
  ).model

const remainingOf = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => 0,
    Preparation: ({ remainingMs }) => remainingMs,
    Wave: () => 0,
    Paused: () => 0,
    Victory: () => 0,
    GameOver: () => 0,
  })

const timedBreak = (current: Model): Model =>
  modifyFields(current, {
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: BREAK_MS,
        durationMs: BREAK_MS,
        spawns: [],
      }),
    wallet: () => ({ balance: 5, earned: 5, shown: 5 }),
  })

// NOTE: a new save in the break before wave 3, at the kitchen's boards.
const atBoards = (): Model =>
  timedBreak(
    modifyFields(freshRunModel(), {
      player: player =>
        modifyFields(player, {
          x: () => BELOW_KITCHEN_DOOR.x,
          y: () => BELOW_KITCHEN_DOOR.y,
        }),
    }),
  )

// NOTE: the same break with the kitchen open, at the fridge, its stream
// set so the next draw would be `prize` without the tour's rig.
const atOpenFridge = (prize: FridgePrize): Model => {
  const opened = timedBreak(atFridge(5, 3))
  const seed = Option.getOrThrow(
    Array.findFirst(
      Array.makeBy(500, index => index + 1),
      candidate =>
        pickPrize(
          prizeWeights(opened.fridge, opened.player),
          nextRandom(candidate).value,
        ) === prize,
    ),
  )
  return modifyFields(opened, {
    loot: loot => modifyFields(loot, { fridgeRngState: () => seed }),
  })
}

const stepOf = (current: Model): Option.Option<KitchenStep> =>
  kitchenStepOf(current)

const isTourRunning = (current: Model): boolean =>
  Tour.isAnyOf(['Running'])(current.kitchenTour)

const isTourDone = (current: Model): boolean =>
  Tour.isAnyOf(['Done'])(current.kitchenTour)

const walkAway = (current: Model): Model =>
  modifyFields(current, {
    player: player =>
      modifyFields(player, {
        x: () => AT_FRIDGE.x,
        y: () => AT_FRIDGE.y + FRIDGE_RULES.leavePx + 30,
      }),
  })

describe('the kitchen tour', () => {
  test('holds the clock, gives the kitchen away, and points at the fridge', () => {
    const started = frames(atBoards(), 10)
    expect(isTourRunning(started)).toBe(true)
    expect(stepOf(started)).toEqual(Option.some('Boards'))
    expect(remainingOf(started)).toBe(BREAK_MS)
    expect(exitPriceFor(started)).toBe(0)

    const opened = holdEnter(started)
    expect(isKitchenOpen(levelOf(opened))).toBe(true)
    expect(opened.wallet.balance).toBe(5)
    expect(stepOf(opened)).toEqual(Option.some('Fridge'))
    expect(remainingOf(frames(opened, 10))).toBe(BREAK_MS)
  })

  test('the free pull is always a weapon, from the fridge stream', () => {
    Array.forEach(['Sandwich', 'Dud', 'Cooker'] as const, prize => {
      const start = frames(atOpenFridge(prize), 1)
      expect(fridgePriceFor(start)).toBe(0)
      const pulled = holdEnter(start)
      expect(pulled.wallet.balance).toBe(5)
      expect(pulled.fridge.pulls).toBe(1)
      const door = pulled.fridge.door
      const pulledPrize = FridgeDoor.isAnyOf(['Open', 'Offering'])(door)
        ? door.prize
        : 'Dud'
      expect(isFridgePrizeWeapon(pulledPrize)).toBe(true)
      expect(pulled.loot.fridgeRngState).not.toBe(start.loot.fridgeRngState)
      expect(stepOf(pulled)).toEqual(Option.some('Choose'))
      expect(remainingOf(frames(pulled, 5))).toBe(BREAK_MS)
    })
  })

  test('taking the prize ends it, and the clock runs', () => {
    const offered = frames(
      holdEnter(frames(atOpenFridge('Cooker'), 1)),
      FRIDGE_OPEN_TICKS,
    )
    expect(FridgeDoor.isAnyOf(['Offering'])(offered.fridge.door)).toBe(true)
    const taken = frames(holdEnter(offered), 1)
    expect(isTourDone(taken)).toBe(true)
    expect(remainingOf(frames(taken, 10))).toBeLessThan(BREAK_MS)
  })

  test('walking away from the prize ends it, and the clock runs', () => {
    const offered = frames(
      holdEnter(frames(atOpenFridge('Pan'), 1)),
      FRIDGE_OPEN_TICKS,
    )
    const left = frames(walkAway(offered), 3)
    expect(isTourDone(left)).toBe(true)
    expect(remainingOf(frames(left, 10))).toBeLessThan(BREAK_MS)
  })

  test('letting the prize time out ends it, and the clock runs', () => {
    const offered = frames(
      holdEnter(frames(atOpenFridge('Pan'), 1)),
      FRIDGE_OPEN_TICKS,
    )
    const sunk = frames(offered, OFFER_FRAMES)
    expect(isTourDone(sunk)).toBe(true)
    expect(remainingOf(frames(sunk, 10))).toBeLessThan(BREAK_MS)
  })

  test.each(['Sandwich', 'Dud'] as const)(
    'a %s settled at once counts as trying the fridge',
    prize => {
      const running = frames(atOpenFridge('Cooker'), 1)
      const gagged = modifyFields(running, {
        fridge: fridge =>
          modifyFields(fridge, {
            pulls: () => 1,
            door: () =>
              FridgeDoor.Open({
                prize,
                slot: soloSeat.slot,
                remainingMs: FRIDGE_RULES.openMs,
                durationMs: FRIDGE_RULES.openMs,
              }),
          }),
      })
      expect(isKitchenTourOn(gagged)).toBe(true)
      const shut = frames(gagged, FRIDGE_OPEN_TICKS)
      expect(isTourDone(shut)).toBe(true)
      expect(remainingOf(frames(shut, 10))).toBeLessThan(BREAK_MS)
    },
  )

  test("Rattles' trap bubble steps aside while the kitchen tour runs", () => {
    const running = frames(atBoards(), 2)
    expect(isTourRunning(running)).toBe(true)
    expect(maybeBubbleKind(running, cameraOf(running))).toEqual(Option.none())
  })

  test('the skip button ends it: the clock runs and prices are back', () => {
    const started = frames(atBoards(), 2)
    const skipped = update(
      started,
      Message.ClickedSkipKitchenTourButton(),
    ).model
    expect(skipped.kitchenTour).toEqual(Tour.Over())
    expect(exitPriceFor(skipped)).toBe(EXIT_RULES.price)
    expect(remainingOf(frames(skipped, 10))).toBeLessThan(BREAK_MS)
  })

  test('runs once per save, and a tutorial reset plays it again', () => {
    const done = asTutorialDone(atBoards())
    expect(isKitchenTourOn(done)).toBe(false)
    expect(stepOf(frames(done, 2))).toEqual(Option.none())
    expect(remainingOf(frames(done, 10))).toBeLessThan(BREAK_MS)
    expect(exitPriceFor(done)).toBe(EXIT_RULES.price)

    const reset = forgetTutorial(done)
    expect(isTourRunning(frames(reset, 2))).toBe(true)
  })

  test('in co-op it never runs: full prices and the shared clock keeps going', () => {
    const crew = modifyFields(atBoards(), {
      party: () => Party.Crew({ lead: soloSeat, mates: [] }),
    })
    expect(isKitchenTourOn(crew)).toBe(false)
    expect(exitPriceFor(crew)).toBe(EXIT_RULES.price)
    expect(fridgePriceFor(crew)).toBe(FRIDGE_RULES.price)
    expect(stepOf(frames(crew, 2))).toEqual(Option.none())
  })
})
