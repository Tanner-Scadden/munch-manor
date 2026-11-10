import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  Melee,
  type Model,
  Phase,
  Purchase,
} from '../../../app/model'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../../shared/constants'
import { nextRandom } from '../../../shared/prng'
import { holdingFirst, holdingSecond, pistolOnly } from '../../../test/arsenals'
import {
  AT_FRIDGE,
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
  withSeat,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  FRIDGE_OPEN_TICKS,
  holdToBuy,
  press,
  settleRunCommands,
  tick,
  ticks,
} from '../../../test/testing'
import { freshGun } from '../../gear/weapons'
import {
  focusOf,
  focusSlotOf,
  maybePlayerAt,
  modifyFocus,
  seatCrew,
} from '../../party/party'
import { withWorld } from '../../schema/world'
import { idleIntent, shutFridge } from '../../schema/worldSchema'
import { PURCHASE_RULES, offersOf } from '../../shop/purchase'
import { stepWorld } from '../../step/stepWorld'
import {
  FRIDGE_RULES,
  PRIZE_ORDER,
  pickPrize,
  prizeWeights,
} from '../leftovers'
import { isFridgeOffered } from './leftovers.fixture'

// Mystery Leftovers (src/world/fridge/leftovers.ts): the fridge in the kitchen, bought
// with the hold to buy, and what comes out of it.

const FRAME_MS = FIXED_STEP_MS

const isPrizeOffered = (current: Model): boolean =>
  Array.some(
    offersOf(current, focusSlotOf(current)),
    ({ target }) => target._tag === 'Prize',
  )

describe('pulling from Mystery Leftovers', () => {
  it.effect(
    'holding Enter at the fridge pays, swings the door open, and offers a weapon',
    () =>
      Story.story(
        APPLICATION,
        Story.given(fridgeSeededFor(atFridge(10), 'Cooker')),
        holdToBuy,
        Story.model(current => {
          expect(current.keys.held).toBe(10 - FRIDGE_RULES.keys)
          expect(current.keys.spent).toBe(FRIDGE_RULES.keys)
          expect(FridgeDoor.isAnyOf(['Open'])(current.fridge.door)).toBe(true)
          expect(current.fridge.pulls).toBe(1)
          expect(focusOf(current).player.arsenal).toEqual(pistolOnly())
          expect(
            Array.some(current.particles, ({ kind }) => kind === 'Fog'),
          ).toBe(true)
          expect(isFridgeOffered(current)).toBe(false)
        }),
        ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
        Story.model(current => {
          expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
            true,
          )
          expect(isPrizeOffered(current)).toBe(true)
          expect(isFridgeOffered(current)).toBe(false)
        }),
      ),
  )

  it.effect(
    'take it: holding again takes the weapon, which replaces the gun in hand',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          fridgeSeededFor(
            modifyFocus(atFridge(10), {
              player: player =>
                modifyFields(player, {
                  arsenal: () => holdingSecond(freshGun('Smg')),
                }),
            }),
            'Cooker',
          ),
        ),
        holdToBuy,
        ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
        holdToBuy,
        Story.model(current => {
          expect(focusOf(current).player.arsenal).toEqual(
            holdingSecond(freshGun('Cooker')),
          )
          expect(focusOf(current).player.melee).toEqual(Melee.Knife())
          expect(current.keys.held).toBe(10 - FRIDGE_RULES.keys)
          expect(isPrizeOffered(current)).toBe(false)
          expect(FridgeDoor.isAnyOf(['Shut'])(current.fridge.door)).toBe(true)
        }),
      ),
  )

  it.effect(
    'take the Pan: it goes in the melee slot in hand, in place of the knife, and both guns stay',
    () => {
      const guns = holdingSecond(freshGun('Smg'))
      return Story.story(
        APPLICATION,
        Story.given(
          fridgeSeededFor(
            modifyFocus(atFridge(10), {
              player: player => modifyFields(player, { arsenal: () => guns }),
            }),
            'Pan',
          ),
        ),
        holdToBuy,
        ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
        holdToBuy,
        Story.model(current => {
          expect(focusOf(current).player.arsenal).toEqual(guns)
          expect(focusOf(current).player.melee).toEqual(
            Melee.Pan({ pan: freshGun('Pan') }),
          )
          expect(focusOf(current).player.wield).toBe('Melee')
          expect(FridgeDoor.isAnyOf(['Shut'])(current.fridge.door)).toBe(true)
        }),
      )
    },
  )

  it.effect(
    'leave it: walking off sinks the weapon back and keeps your gun, still paid',
    () => {
      const smg = holdingFirst(freshGun('Smg'))
      return Story.story(
        APPLICATION,
        Story.given(
          fridgeSeededFor(
            modifyFocus(atFridge(10), {
              player: player => modifyFields(player, { arsenal: () => smg }),
            }),
            'Pan',
          ),
        ),
        holdToBuy,
        ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
        Story.model(current => {
          expect(isPrizeOffered(current)).toBe(true)
        }),
        Story.message(Message.PressedKey({ code: 'KeyA' })),
        ...ticks(60, FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).player.arsenal).toEqual(smg)
          expect(isPrizeOffered(current)).toBe(false)
          expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
            false,
          )
          expect(current.keys.held).toBe(10 - FRIDGE_RULES.keys)
        }),
      )
    },
  )

  it.effect('leave it: when the timer runs out the weapon sinks back', () =>
    Story.story(
      APPLICATION,
      Story.given(fridgeSeededFor(atFridge(10), 'Cooker')),
      holdToBuy,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      ...ticks(Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) - 10, FRAME_MS),
      Story.model(current => {
        expect(isPrizeOffered(current)).toBe(true)
      }),
      ...ticks(12, FRAME_MS),
      Story.model(current => {
        expect(isPrizeOffered(current)).toBe(false)
        expect(focusOf(current).player.arsenal).toEqual(pistolOnly())
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['PrizeLeft'])) ||
            !FridgeDoor.isAnyOf(['Offering'])(current.fridge.door),
        ).toBe(true)
      }),
    ),
  )

  it.effect(
    'a pull never touches the waves or the drops: only the fridge draws',
    () => {
      const start = fridgeSeededFor(atFridge(10), 'Pan')
      return Story.story(
        APPLICATION,
        Story.given(start),
        holdToBuy,
        Story.model(current => {
          expect(current.rngState).toBe(start.rngState)
          expect(current.loot.rngState).toBe(start.loot.rngState)
          expect(current.loot.fridgeRngState).not.toBe(
            start.loot.fridgeRngState,
          )
        }),
      )
    },
  )

  it.effect('the moldy sandwich heals a heart', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fridgeSeededFor(
          modifyFocus(atFridge(10), {
            player: player => modifyFields(player, { hp: () => 2 }),
          }),
          'Sandwich',
        ),
      ),
      holdToBuy,
      Story.model(current => {
        expect(focusOf(current).player.hp).toBe(3)
        expect(focusOf(current).player.arsenal).toEqual(pistolOnly())
        expect(focusOf(current).player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP)
      }),
    ),
  )

  it.effect('a dud burps a key back, without a popup to spoil the spin', () =>
    Story.story(
      APPLICATION,
      Story.given(fridgeSeededFor(atFridge(10), 'Dud')),
      holdToBuy,
      Story.model(current => {
        expect(current.keys.held).toBe(
          10 - FRIDGE_RULES.keys + FRIDGE_RULES.dudRefund,
        )
        expect(
          Array.some(current.popups, ({ kind }) => kind === 'Payday'),
        ).toBe(false)
      }),
    ),
  )

  it.effect('short of the price, the tag shakes and nothing comes out', () =>
    Story.story(
      APPLICATION,
      Story.given(atFridge(1)),
      press('Enter'),
      ...ticks(2, FRAME_MS),
      Story.model(current => {
        expect(Purchase.isAnyOf(['Refused'])(focusOf(current).purchase)).toBe(
          true,
        )
        expect(current.fridge).toEqual(shutFridge)
        expect(current.keys.held).toBe(1)
      }),
    ),
  )

  test('the fridge is not for sale while the kitchen is boarded', () => {
    const boarded = modifyFields(atFridge(10), {
      level: () => freshRunModel().level,
    })
    expect(isFridgeOffered(boarded)).toBe(false)
    expect(isFridgeOffered(atFridge(10))).toBe(true)
  })

  it.effect('mid-wave, the fridge is for sale too', () => {
    const fighting = modifyFields(atFridge(10), {
      phase: () =>
        Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    return Story.story(
      APPLICATION,
      Story.given(fridgeSeededFor(fighting, 'Pan')),
      holdToBuy,
      Story.model(current => {
        expect(current.keys.held).toBe(10 - FRIDGE_RULES.keys)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
      }),
    )
  })
})

describe('the fridge slams shut', () => {
  // NOTE: pulls until the door slams, and its rest, are in
  // leftovers.sim.test.ts.
  it.effect('the slam is heard and felt', () => {
    const slamming = modifyFields(atFridge(10), {
      fridge: () => ({
        ...shutFridge,
        door: FridgeDoor.Open({
          prize: 'Sandwich',
          slot: 0,
          remainingMs: FRAME_MS,
          durationMs: FRIDGE_RULES.openMs,
        }),
        pulls: FRIDGE_RULES.maxPulls,
      }),
    })
    return Story.story(
      APPLICATION,
      Story.given(slamming),
      tick(FRAME_MS),
      Story.model(next => {
        expect(
          Array.some(next.frameEvents, GameEvent.isAnyOf(['FridgeSlammed'])),
        ).toBe(true)
        expect(next.shake.trauma).toBeGreaterThan(0)
      }),
      settleRunCommands,
    )
  })
})

describe('the odds', () => {
  const pistolCarrier = focusOf(freshRunModel()).player

  const shareOf = (
    weights: ReadonlyArray<readonly [FridgePrize, number]>,
    prize: FridgePrize,
  ): number => {
    const total = Array.reduce(weights, 0, (sum, [, weight]) => sum + weight)
    return (
      Option.getOrElse(
        Option.map(
          Array.findFirst(weights, ([each]) => each === prize),
          ([, weight]) => weight,
        ),
        () => 0,
      ) / total
    )
  }

  test('Brain Freeze is rare, the gags are about one pull in seven, and every slam makes the freeze a little likelier', () => {
    const first = prizeWeights(shutFridge, pistolCarrier)
    expect(shareOf(first, 'Freeze')).toBeCloseTo(0.085, 5)
    expect(shareOf(first, 'Dud')).toBeCloseTo(0.04, 5)
    expect(shareOf(first, 'Cooker')).toBeCloseTo(0.3825, 5)
    expect(shareOf(first, 'Sandwich') + shareOf(first, 'Dud')).toBeCloseTo(
      0.15,
      5,
    )
    const lucky = prizeWeights({ ...shutFridge, luck: 2 }, pistolCarrier)
    expect(shareOf(lucky, 'Freeze')).toBeGreaterThan(shareOf(first, 'Freeze'))
    const luckiest = prizeWeights({ ...shutFridge, luck: 99 }, pistolCarrier)
    expect(shareOf(luckiest, 'Freeze')).toBeLessThan(0.2)
  })

  test('the weapon a player carries is never pulled again', () => {
    const withCooker = modifyFields(pistolCarrier, {
      arsenal: () => holdingSecond(freshGun('Cooker')),
    })
    const weights = prizeWeights(shutFridge, withCooker)
    expect(shareOf(weights, 'Cooker')).toBe(0)
    expect(
      Array.every(
        Array.makeBy(400, index => index / 400),
        roll => pickPrize(weights, roll) !== 'Cooker',
      ),
    ).toBe(true)
  })

  test('the draws follow the weights', () => {
    const weights = prizeWeights(shutFridge, pistolCarrier)
    const counts = Array.reduce(
      Array.makeBy(20_000, index => index),
      { state: 7, tally: new Map<FridgePrize, number>() },
      ({ state, tally }) => {
        const draw = nextRandom(state)
        const prize = pickPrize(weights, draw.value)
        tally.set(prize, (tally.get(prize) ?? 0) + 1)
        return { state: draw.nextState, tally }
      },
    ).tally
    Array.forEach(PRIZE_ORDER, prize => {
      expect((counts.get(prize) ?? 0) / 20_000).toBeCloseTo(
        shareOf(weights, prize),
        1,
      )
    })
  })
})

describe('the fridge in co-op', () => {
  const TICK_MS = FIXED_STEP_MS

  test("the player who holds pulls from the crew's ring and gets the prize; a teammate keeps their gun", () => {
    const crew = withWorld(atFridge(10), world => seatCrew(world, 2))
    const placedCrew = withWorld(crew, world =>
      withSeat(
        withSeat(world, 1, seat =>
          modifyFocus(seat, {
            player: player =>
              modifyFields(player, {
                x: () => AT_FRIDGE.x,
                y: () => AT_FRIDGE.y,
              }),
          }),
        ),
        0,
        seat =>
          modifyFocus(seat, {
            player: player =>
              modifyFields(player, { x: () => 60, y: () => 104 }),
          }),
      ),
    )
    const holding = new Map([[1, { ...idleIntent, interact: 'Held' as const }]])
    const bought = withWorld(placedCrew, world =>
      Array.reduce(
        Array.makeBy(Math.ceil(PURCHASE_RULES.holdMs / TICK_MS) + 2, () => 0),
        world,
        stepped => stepWorld(stepped, holding).world,
      ),
    )
    const holder = Option.getOrThrow(maybePlayerAt(bought, 1))
    const teammate = Option.getOrThrow(maybePlayerAt(bought, 0))
    expect(holder.seat.slot).toBe(1)
    expect(bought.keys.spent).toBe(FRIDGE_RULES.keys)
    expect(teammate.player.arsenal).toEqual(pistolOnly())
    expect(bought.fridge.pulls).toBe(1)
    expect(
      FridgeDoor.isAnyOf(['Open'])(bought.fridge.door) &&
        bought.fridge.door.slot,
    ).toBe(1)
  })

  test('only the puller can take the weapon on offer', () => {
    const offered = withWorld(fridgeSeededFor(atFridge(0), 'Pan'), world =>
      withSeat(
        withSeat(seatCrew(world, 2), 1, seat =>
          modifyFocus(seat, {
            player: player =>
              modifyFields(player, {
                x: () => AT_FRIDGE.x - 6,
                y: () => AT_FRIDGE.y,
              }),
          }),
        ),
        0,
        seat =>
          modifyFocus(
            modifyFields(seat, {
              fridge: fridge =>
                modifyFields(fridge, {
                  door: () =>
                    FridgeDoor.Offering({
                      prize: 'Pan',
                      slot: 1,
                      remainingMs: FRIDGE_RULES.offerMs,
                      durationMs: FRIDGE_RULES.offerMs,
                    }),
                }),
            }),
            {
              player: player =>
                modifyFields(player, {
                  x: () => AT_FRIDGE.x + 6,
                  y: () => AT_FRIDGE.y,
                }),
            },
          ),
      ),
    )
    const holdFor = (start: typeof offered, slot: number): typeof offered =>
      withWorld(start, world =>
        Array.reduce(
          Array.makeBy(Math.ceil(PURCHASE_RULES.holdMs / TICK_MS) + 2, () => 0),
          world,
          stepped =>
            stepWorld(
              stepped,
              new Map([[slot, { ...idleIntent, interact: 'Held' as const }]]),
            ).world,
        ),
      )
    const teammateTried = holdFor(offered, 0)
    expect(
      Option.getOrThrow(maybePlayerAt(teammateTried, 0)).player.arsenal,
    ).toEqual(pistolOnly())
    expect(FridgeDoor.isAnyOf(['Offering'])(teammateTried.fridge.door)).toBe(
      true,
    )
    const pullerTook = holdFor(offered, 1)
    const puller = Option.getOrThrow(maybePlayerAt(pullerTook, 1)).player
    expect(puller.arsenal).toEqual(pistolOnly())
    expect(puller.melee).toEqual(Melee.Pan({ pan: freshGun('Pan') }))
    expect(
      Option.getOrThrow(maybePlayerAt(pullerTook, 0)).player.melee,
    ).toEqual(Melee.Knife())
  })
})
