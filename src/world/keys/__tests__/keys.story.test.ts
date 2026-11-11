import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  GameEvent,
  type Model,
  Pantry,
  Phase,
  type Zombie,
} from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  atFridge,
  crewInWave,
  freshRunModel,
  fridgeSeededFor,
  pastTimedBreaks,
  withKeys,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  bulletInto,
  holdToBuy,
  isKitchenOpen,
  press,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { FRIDGE_RULES } from '../../fridge/leftovers'
import { PANTRY_RULES, pantrySpotOf } from '../../kitchen/pantry'
import { levelOf } from '../../level/arena'
import { EXIT_RULES, KITCHEN_EXIT, exitKeysOf } from '../../level/exits'
import { maybePlayerAt, modifyFocus } from '../../party/party'
import { ZOMBIE_KINDS } from '../../zombies/zombies'

// Skeleton keys (src/world/keys/keys.ts): zombies drop them by kind onto
// the crew's one ring, and they open the padlocked boards and pull the
// fridge.

const FRAME_MS = FIXED_STEP_MS

// NOTE: zombies at one hit point, each with a bullet in it, mid-wave in the
// parlour with the kitchen open, so the next frame kills them all.
const shotDown = (
  victims: ReadonlyArray<Zombie>,
  base: Model = atFridge(0),
): Model =>
  modifyFields(base, {
    phase: () => Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => victims,
    bullets: () =>
      Array.map(victims, (victim, index) =>
        bulletInto(500 + index, victim, { knockback: 0 }),
      ),
  })

const oneDown = (kind: Zombie['kind']): Zombie =>
  zombieOf(kind, 100, 60, 85, { hp: 1 })

const keysAfterFrame = (start: Model) =>
  Story.story(APPLICATION, Story.given(start), tick(FRAME_MS)).pipe(
    Effect.map(({ keys }) => keys),
  )

describe('key drops by kind', () => {
  it.effect('a Big Lug drops two keys, a Kaboomer one', () =>
    Effect.gen(function* () {
      const lug = yield* keysAfterFrame(shotDown([oneDown('Tank')]))
      expect(lug.held).toBe(ZOMBIE_KINDS.Tank.keys)
      expect(lug.found).toBe(2)
      const boomer = yield* keysAfterFrame(shotDown([oneDown('Exploder')]))
      expect(boomer.held).toBe(1)
    }),
  )

  it.effect('a Groaner drops one only sometimes, with a key popup', () =>
    Story.story(
      APPLICATION,
      Story.given(
        shotDown(
          Array.makeBy(12, index =>
            zombieOf('Shambler', 100 + index, 40 + index * 10, 85, { hp: 1 }),
          ),
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.keys.held).toBeGreaterThan(0)
        expect(current.keys.held).toBeLessThan(12)
        expect(
          Array.filter(current.frameEvents, GameEvent.isAnyOf(['KeysFound']))
            .length,
        ).toBe(current.keys.held)
        expect(Array.some(current.popups, ({ kind }) => kind === 'Kill')).toBe(
          true,
        )
      }),
    ),
  )

  it.effect('Broke drops half: a Big Lug gives one', () =>
    Effect.gen(function* () {
      const broke = modifyFields(atFridge(0), {
        modifiers: modifiers => modifyFields(modifiers, { broke: () => true }),
      })
      const keys = yield* keysAfterFrame(shotDown([oneDown('Tank')], broke))
      expect(keys.held).toBe(1)
    }),
  )

  it.effect("the Penny Pincher's Big Lug drops three", () =>
    Effect.gen(function* () {
      const penny = modifyFocus(atFridge(0), {
        player: player =>
          modifyFields(player, { calling: () => 'PennyPincher' as const }),
      })
      const keys = yield* keysAfterFrame(shotDown([oneDown('Tank')], penny))
      expect(keys.held).toBe(3)
    }),
  )
})

describe('the crew shares one ring', () => {
  it.effect('a kill by seat 1 adds to the ring and to its own count', () => {
    const victim = oneDown('Tank')
    const crew = modifyFields(crewInWave(2), {
      zombies: () => [victim],
      bullets: () => [
        { ...bulletInto(500, victim, { knockback: 0 }), shooter: 1 },
      ],
    })
    return Story.story(
      APPLICATION,
      Story.given(crew),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.keys.held).toBe(2)
        expect(
          Option.map(maybePlayerAt(current, 1), ({ seat }) => seat.keysFound),
        ).toEqual(Option.some(2))
        expect(
          Option.map(maybePlayerAt(current, 0), ({ seat }) => seat.keysFound),
        ).toEqual(Option.some(0))
      }),
    )
  })
})

describe('spending keys', () => {
  const atBoards = (keys: number): Model =>
    modifyFocus(
      modifyFields(withKeys(pastTimedBreaks(freshRunModel()), keys), {
        phase: () =>
          Phase.Preparation({
            wave: 3,
            remainingMs: 15_000,
            durationMs: 20_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      {
        player: player =>
          modifyFields(player, {
            x: () => BELOW_KITCHEN_DOOR.x,
            y: () => BELOW_KITCHEN_DOOR.y,
          }),
      },
    )

  it.effect(
    'the kitchen padlock asks its price: one short is refused, the price opens it',
    () =>
      Effect.gen(function* () {
        expect(exitKeysOf(KITCHEN_EXIT)).toBe(EXIT_RULES.kitchenKeys)
        yield* Story.story(
          APPLICATION,
          Story.given(atBoards(EXIT_RULES.kitchenKeys - 1)),
          press('Enter'),
          ...ticks(HOLD_TICKS, FRAME_MS),
          Story.model(current => {
            expect(isKitchenOpen(current)).toBe(false)
            expect(current.keys.held).toBe(EXIT_RULES.kitchenKeys - 1)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(atBoards(EXIT_RULES.kitchenKeys)),
          press('Enter'),
          ...ticks(HOLD_TICKS, FRAME_MS),
          Story.model(current => {
            expect(isKitchenOpen(current)).toBe(true)
            expect(current.keys.held).toBe(0)
            expect(current.keys.spent).toBe(EXIT_RULES.kitchenKeys)
          }),
        )
      }),
  )

  it.effect('a fridge pull costs two, and the Dud gives one back', () =>
    Story.story(
      APPLICATION,
      Story.given(fridgeSeededFor(atFridge(2), 'Dud')),
      holdToBuy,
      Story.model(current => {
        expect(current.keys.held).toBe(
          2 - FRIDGE_RULES.keys + FRIDGE_RULES.dudRefund,
        )
        expect(current.keys.spent).toBe(FRIDGE_RULES.keys)
      }),
    ),
  )
})

describe('the pantry', () => {
  it.effect('its key goodie goes onto the ring', () => {
    const spot = Option.getOrThrow(pantrySpotOf(levelOf(atFridge(0))))
    const stocked = modifyFocus(
      modifyFields(atFridge(0), {
        pantry: () => Pantry.Stocked({ round: 5, goodie: 'Key' }),
      }),
      {
        player: player =>
          modifyFields(player, { x: () => spot.x, y: () => spot.y }),
      },
    )
    return Story.story(
      APPLICATION,
      Story.given(stocked),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.keys.held).toBe(PANTRY_RULES.keys)
        expect(current.pantry).toEqual(Pantry.Bare({ round: 5 }))
      }),
    )
  })
})
