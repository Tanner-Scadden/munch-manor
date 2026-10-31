import { Array, Option, Result } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import {
  REVEAL_RULES,
  doorRevealOf,
  revealOf,
  revealStageAt,
} from './fridgeReveal'
import { FRIDGE_RULES, PRIZE_ORDER } from './leftovers'
import { update } from './main'
import { Message } from './message'
import { AudioState, FridgeDoor, type Model, PrizeFlight } from './model'
import { atFridge, fridgeSeededFor } from './model.fixture'
import { FIXED_FRAME, HOLD_TICKS, press, release, ticks } from './testing'
import { PlaySound } from './update/sound'
import { freshGun, maybeReplacedGun, takeGun } from './weapons'
import { Arsenal } from './worldSchema'

// The Mystery Leftovers reveal (src/fridgeReveal.ts): which look and sting
// each prize lands with, the spin that lands on it, and the weapon's flight
// into its HUD slot once taken.

const FRAME_MS = FIXED_STEP_MS
const audibleAtFridge = (balance: number): Model =>
  modifyFields(atFridge(balance), {
    audio: () => AudioState.Ready(),
    soundSetting: () => 'On',
    musicSetting: () => 'Off',
  })

// NOTE: replays Messages through `update` and keeps, for each Message, the
// sounds its Commands ask for, so a test can say on which frame a sound
// plays.
type Step = Readonly<{ model: Model; sounds: ReadonlyArray<unknown> }>

const replay = (
  start: Model,
  messages: ReadonlyArray<Message>,
): ReadonlyArray<Step> =>
  Array.reduce(messages, Array.empty<Step>(), (steps, next) => {
    const current = Option.match(Array.last(steps), {
      onNone: () => start,
      onSome: step => step.model,
    })
    const result = update(current, next)
    return [
      ...steps,
      {
        model: result.model,
        sounds: Array.map(
          Array.filter(
            result.commands ?? [],
            command => command.name === PlaySound.name,
          ),
          command => command.args?.['sound'],
        ),
      },
    ]
  })

const pullMessages: ReadonlyArray<Message> = [
  Message.PressedKey({ code: 'Enter' }),
  ...Array.makeBy(HOLD_TICKS, () => FIXED_FRAME),
  Message.ReleasedKey({ code: 'Enter' }),
  ...Array.makeBy(
    Math.ceil(FRIDGE_RULES.openMs / FRAME_MS) + 2,
    () => FIXED_FRAME,
  ),
]

const firstStepWith = (
  steps: ReadonlyArray<Step>,
  sound: string,
): Option.Option<number> =>
  Array.findFirstIndex(steps, step => Array.contains(step.sounds, sound))

const openedAt = (steps: ReadonlyArray<Step>): number =>
  Option.getOrThrow(
    Array.findFirstIndex(steps, step =>
      FridgeDoor.isAnyOf(['Open'])(step.model.fridge.door),
    ),
  )

describe('what each prize lands as', () => {
  test.each([
    ['Cooker', 'Common', 'PowerUp', 'BOOM', true],
    ['Pan', 'Common', 'PowerUp', 'BONK', true],
    ['Freeze', 'Rare', 'PrizeJackpot', 'BRRR', true],
    ['Sandwich', 'Snack', 'PrizeChomp', 'CHOMP', false],
    ['Dud', 'Dud', 'PrizeWomp', 'BLEH', false],
  ] as const)(
    '%s is %s, stings with %s, and says %s',
    (prize, rarity, sting, punchLine, isWeapon) => {
      expect(revealOf(prize)).toEqual({ rarity, sting, punchLine, isWeapon })
    },
  )
})

describe('the spin', () => {
  test('cycles every prize, slows down, and lands on the prize', () => {
    const faces = Array.map(
      Array.makeBy(REVEAL_RULES.landMs, elapsedMs => elapsedMs),
      elapsedMs => revealStageAt('Freeze', elapsedMs),
    )
    const shown = Array.dedupeAdjacentWith(
      Array.filterMap(faces, stage =>
        stage._tag === 'Spinning'
          ? Result.succeed(stage.step)
          : Result.failVoid,
      ),
      (first, second) => first === second,
    )
    expect(shown.length).toBe(10)
    const faceNames = Array.filterMap(faces, stage =>
      stage._tag === 'Spinning' ? Result.succeed(stage.face) : Result.failVoid,
    )
    expect(new Set(faceNames)).toEqual(new Set(PRIZE_ORDER))
    expect(revealStageAt('Freeze', REVEAL_RULES.landMs - 1)).toMatchObject({
      _tag: 'Spinning',
      face: 'Pan',
    })
    expect(revealStageAt('Freeze', REVEAL_RULES.landMs)).toEqual({
      _tag: 'Landed',
      sinceMs: 0,
    })
  })

  test('lands well before the door gives its prize away', () => {
    expect(REVEAL_RULES.landMs).toBeLessThan(FRIDGE_RULES.openMs)
    expect(REVEAL_RULES.landMs).toBeGreaterThanOrEqual(600)
    expect(REVEAL_RULES.landMs).toBeLessThanOrEqual(800)
  })
})

describe('the sting', () => {
  test.each([
    ['Freeze', 'PrizeJackpot'],
    ['Dud', 'PrizeWomp'],
    ['Sandwich', 'PrizeChomp'],
    ['Cooker', 'PowerUp'],
  ] as const)(
    'a pull of %s spins at once and plays %s only when it lands',
    (prize, sting) => {
      const steps = replay(
        fridgeSeededFor(audibleAtFridge(200), prize),
        pullMessages,
      )
      const opened = openedAt(steps)
      expect(firstStepWith(steps, 'FridgeSpin')).toEqual(Option.some(opened))
      const landed = Option.getOrThrow(firstStepWith(steps, sting))
      const landedMs = (landed - opened) * FRAME_MS
      expect(landedMs).toBeGreaterThanOrEqual(REVEAL_RULES.landMs - FRAME_MS)
      expect(landedMs).toBeLessThanOrEqual(REVEAL_RULES.landMs + FRAME_MS + 1)
      expect(
        Array.filter(steps, step => Array.contains(step.sounds, sting)).length,
      ).toBe(1)
    },
  )

  test('the door shows the pull from the moment it opens', () => {
    const steps = replay(
      fridgeSeededFor(audibleAtFridge(200), 'Pan'),
      pullMessages,
    )
    const opened = Option.getOrThrow(Array.get(steps, openedAt(steps)))
    const reveal = Option.getOrThrow(doorRevealOf(opened.model.fridge.door))
    expect(reveal.prize).toBe('Pan')
    expect(reveal.elapsedMs).toBeLessThan(REVEAL_RULES.landMs / 4)
  })
})

describe('the take', () => {
  const offering = (prize: 'Cooker' | 'Pan' | 'Freeze', slot: number): Model =>
    modifyFields(atFridge(0), {
      fridge: fridge =>
        modifyFields(fridge, {
          door: () =>
            FridgeDoor.Offering({
              prize,
              slot,
              remainingMs: 5000,
              durationMs: FRIDGE_RULES.offerMs,
            }),
        }),
    })

  test('a taken weapon flies into its slot, then the slot pulses and settles', () => {
    story(
      update,
      given(offering('Freeze', 0)),
      model(current => {
        expect(current.prizeFlight).toEqual(PrizeFlight.Grounded())
      }),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
          false,
        )
        expect(current.prizeFlight).toMatchObject({
          _tag: 'Flying',
          prize: 'Freeze',
        })
      }),
      release('Enter'),
      ...ticks(
        Math.ceil((REVEAL_RULES.flightMs + REVEAL_RULES.pulseMs) / FRAME_MS) +
          1,
        FRAME_MS,
      ),
      model(current => {
        expect(current.prizeFlight).toEqual(PrizeFlight.Grounded())
      }),
    )
  })

  test('a prize left in the fridge flies nowhere', () => {
    story(
      update,
      given(offering('Pan', 0)),
      ...ticks(Math.ceil(5000 / FRAME_MS) + 2, FRAME_MS),
      model(current => {
        expect(current.fridge.door._tag).not.toBe('Offering')
        expect(current.prizeFlight).toEqual(PrizeFlight.Grounded())
      }),
    )
  })
})

describe('the gun a prize would replace', () => {
  const pistol = freshGun('Pistol')
  const smg = freshGun('Smg')

  test('with a slot free, nothing is replaced', () => {
    expect(maybeReplacedGun(Arsenal.OneGun({ first: pistol }))).toEqual(
      Option.none(),
    )
  })

  test('with both slots full, the gun in the hands is replaced, and that is the one taking swaps out', () => {
    const holdingFirst = Arsenal.HoldingFirst({ first: pistol, second: smg })
    const holdingSecond = Arsenal.HoldingSecond({ first: pistol, second: smg })
    expect(maybeReplacedGun(holdingFirst)).toEqual(Option.some(pistol))
    expect(maybeReplacedGun(holdingSecond)).toEqual(Option.some(smg))
    const cooker = freshGun('Cooker')
    expect(takeGun(holdingFirst, cooker)).toEqual(
      Arsenal.HoldingFirst({ first: cooker, second: smg }),
    )
    expect(takeGun(holdingSecond, cooker)).toEqual(
      Arsenal.HoldingSecond({ first: pistol, second: cooker }),
    )
  })
})
