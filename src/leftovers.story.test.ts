import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, PLAYER_MAX_HP } from './constants'
import {
  DUD_REFUND,
  FRIDGE_RULES,
  PRIZE_ORDER,
  pickPrize,
  prizeWeights,
} from './leftovers'
import { update } from './main'
import { Message } from './message'
import {
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  Melee,
  type Model,
  Phase,
  Purchase,
} from './model'
import {
  AT_FRIDGE,
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
} from './model.fixture'
import { maybePlayerAt, seatCrew, withSeat } from './party'
import { nextRandom } from './prng'
import { PURCHASE_RULES, offersOf } from './purchase'
import { stepWorld } from './stepWorld'
import {
  FRIDGE_OPEN_TICKS,
  HOLD_TICKS,
  holdingFirst,
  holdingSecond,
  pistolOnly,
  press,
  release,
  ticks,
} from './testing'
import { freshGun } from './weapons'
import { withWorld } from './world'
import { idleIntent, shutFridge } from './worldSchema'

// Mystery Leftovers (src/leftovers.ts): the fridge in the kitchen, bought
// with the hold to buy, and what comes out of it.

const FRAME_MS = FIXED_STEP_MS

const pull = [press('Enter'), ...ticks(HOLD_TICKS, FRAME_MS), release('Enter')]

const isFridgeOffered = (current: Model): boolean =>
  Array.some(offersOf(current), ({ target }) => target._tag === 'Fridge')

const isPrizeOffered = (current: Model): boolean =>
  Array.some(offersOf(current), ({ target }) => target._tag === 'Prize')

describe('pulling from Mystery Leftovers', () => {
  test('holding Enter at the fridge pays, swings the door open, and offers a weapon', () => {
    story(
      update,
      given(fridgeSeededFor(atFridge(100), 'Cooker')),
      ...pull,
      model(current => {
        expect(current.wallet.balance).toBe(100 - FRIDGE_RULES.price)
        expect(current.stats.purchases).toBe(1)
        expect(FridgeDoor.isAnyOf(['Open'])(current.fridge.door)).toBe(true)
        expect(current.fridge.pulls).toBe(1)
        expect(current.player.arsenal).toEqual(pistolOnly())
        expect(
          Array.some(current.particles, ({ kind }) => kind === 'Fog'),
        ).toBe(true)
        expect(isFridgeOffered(current)).toBe(false)
      }),
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      model(current => {
        expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(true)
        expect(isPrizeOffered(current)).toBe(true)
        expect(isFridgeOffered(current)).toBe(false)
      }),
    )
  })

  test('take it: holding again takes the weapon, which replaces the gun in hand', () => {
    story(
      update,
      given(
        fridgeSeededFor(
          modifyFields(atFridge(100), {
            player: player =>
              modifyFields(player, {
                arsenal: () => holdingSecond(freshGun('Smg')),
              }),
          }),
          'Cooker',
        ),
      ),
      ...pull,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      ...pull,
      model(current => {
        expect(current.player.arsenal).toEqual(
          holdingSecond(freshGun('Cooker')),
        )
        expect(current.player.melee).toEqual(Melee.Knife())
        expect(current.wallet.balance).toBe(100 - FRIDGE_RULES.price)
        expect(isPrizeOffered(current)).toBe(false)
        expect(FridgeDoor.isAnyOf(['Shut'])(current.fridge.door)).toBe(true)
      }),
    )
  })

  test('take the Pan: it goes in the melee slot in hand, in place of the knife, and both guns stay', () => {
    const guns = holdingSecond(freshGun('Smg'))
    story(
      update,
      given(
        fridgeSeededFor(
          modifyFields(atFridge(100), {
            player: player => modifyFields(player, { arsenal: () => guns }),
          }),
          'Pan',
        ),
      ),
      ...pull,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      ...pull,
      model(current => {
        expect(current.player.arsenal).toEqual(guns)
        expect(current.player.melee).toEqual(
          Melee.Pan({ pan: freshGun('Pan') }),
        )
        expect(current.player.wield).toBe('Melee')
        expect(FridgeDoor.isAnyOf(['Shut'])(current.fridge.door)).toBe(true)
      }),
    )
  })

  test('leave it: walking off sinks the weapon back and keeps your gun, still paid', () => {
    const smg = holdingFirst(freshGun('Smg'))
    story(
      update,
      given(
        fridgeSeededFor(
          modifyFields(atFridge(100), {
            player: player => modifyFields(player, { arsenal: () => smg }),
          }),
          'Pan',
        ),
      ),
      ...pull,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      model(current => {
        expect(isPrizeOffered(current)).toBe(true)
      }),
      message(Message.PressedKey({ code: 'KeyA' })),
      ...ticks(60, FRAME_MS),
      model(current => {
        expect(current.player.arsenal).toEqual(smg)
        expect(isPrizeOffered(current)).toBe(false)
        expect(FridgeDoor.isAnyOf(['Offering'])(current.fridge.door)).toBe(
          false,
        )
        expect(current.wallet.balance).toBe(100 - FRIDGE_RULES.price)
      }),
    )
  })

  test('leave it: when the timer runs out the weapon sinks back', () => {
    story(
      update,
      given(fridgeSeededFor(atFridge(100), 'Cooker')),
      ...pull,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      ...ticks(Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) - 10, FRAME_MS),
      model(current => {
        expect(isPrizeOffered(current)).toBe(true)
      }),
      ...ticks(12, FRAME_MS),
      model(current => {
        expect(isPrizeOffered(current)).toBe(false)
        expect(current.player.arsenal).toEqual(pistolOnly())
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['PrizeLeft'])) ||
            !FridgeDoor.isAnyOf(['Offering'])(current.fridge.door),
        ).toBe(true)
      }),
    )
  })

  test('a pull never touches the waves or the drops: only the fridge draws', () => {
    const start = fridgeSeededFor(atFridge(100), 'Pan')
    story(
      update,
      given(start),
      ...pull,
      model(current => {
        expect(current.rngState).toBe(start.rngState)
        expect(current.loot.rngState).toBe(start.loot.rngState)
        expect(current.loot.fridgeRngState).not.toBe(start.loot.fridgeRngState)
      }),
    )
  })

  test('the moldy sandwich heals a heart', () => {
    story(
      update,
      given(
        fridgeSeededFor(
          modifyFields(atFridge(100), {
            player: player => modifyFields(player, { hp: () => 2 }),
          }),
          'Sandwich',
        ),
      ),
      ...pull,
      model(current => {
        expect(current.player.hp).toBe(3)
        expect(current.player.arsenal).toEqual(pistolOnly())
        expect(current.player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP)
      }),
    )
  })

  test('a dud burps half the price back, without a popup to spoil the spin', () => {
    story(
      update,
      given(fridgeSeededFor(atFridge(100), 'Dud')),
      ...pull,
      model(current => {
        expect(current.wallet.balance).toBe(
          100 - FRIDGE_RULES.price + DUD_REFUND,
        )
        expect(
          Array.some(current.popups, ({ kind }) => kind === 'Payday'),
        ).toBe(false)
      }),
    )
  })

  test('short of the price, the tag shakes and nothing comes out', () => {
    story(
      update,
      given(atFridge(40)),
      press('Enter'),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(Purchase.isAnyOf(['Refused'])(current.purchase)).toBe(true)
        expect(current.fridge).toEqual(shutFridge)
        expect(current.wallet.balance).toBe(40)
      }),
    )
  })

  test('the fridge is not for sale while the kitchen is boarded', () => {
    const boarded = modifyFields(atFridge(500), {
      level: () => freshRunModel().level,
    })
    expect(isFridgeOffered(boarded)).toBe(false)
    expect(isFridgeOffered(atFridge(500))).toBe(true)
  })

  test('mid-wave, the fridge is for sale too', () => {
    const fighting = modifyFields(atFridge(100), {
      phase: () =>
        Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    story(
      update,
      given(fridgeSeededFor(fighting, 'Pan')),
      ...pull,
      model(current => {
        expect(current.wallet.balance).toBe(100 - FRIDGE_RULES.price)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
      }),
    )
  })
})

describe('the fridge slams shut', () => {
  const playAll = (start: Model, steps: ReadonlyArray<Message>): Model =>
    Array.reduce(steps, start, (current, sent) => update(current, sent).model)

  const pullOnce = (current: Model): Model =>
    playAll(current, [
      Message.PressedKey({ code: 'Enter' }),
      ...Array.makeBy(HOLD_TICKS, () =>
        Message.TickedFrame({ deltaTime: FRAME_MS }),
      ),
      Message.ReleasedKey({ code: 'Enter' }),
      ...Array.makeBy(
        FRIDGE_OPEN_TICKS + Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) + 2,
        () => Message.TickedFrame({ deltaTime: FRAME_MS }),
      ),
    ])

  test('it slams after its third or fourth pull, rests, and opens again luckier', () => {
    const pulls = Array.reduce(
      Array.makeBy(FRIDGE_RULES.maxPulls, index => index),
      [atFridge(1000)],
      (pulled: Array.NonEmptyReadonlyArray<Model>) =>
        FridgeDoor.isAnyOf(['Slammed'])(Array.lastNonEmpty(pulled).fridge.door)
          ? pulled
          : Array.append(pulled, pullOnce(Array.lastNonEmpty(pulled))),
    )
    const slammed = Array.lastNonEmpty(pulls)
    expect(pulls.length - 1).toBeGreaterThanOrEqual(
      FRIDGE_RULES.pullsBeforeSlam,
    )
    expect(pulls.length - 1).toBeLessThanOrEqual(FRIDGE_RULES.maxPulls)
    expect(FridgeDoor.isAnyOf(['Slammed'])(slammed.fridge.door)).toBe(true)
    expect(slammed.fridge.luck).toBe(1)
    expect(slammed.fridge.pulls).toBe(0)
    expect(isFridgeOffered(slammed)).toBe(false)
    expect(slammed.wallet.balance).toBeLessThan(1000)
    const rested = playAll(
      slammed,
      Array.makeBy(Math.ceil(FRIDGE_RULES.slamMs / FRAME_MS) + 1, () =>
        Message.TickedFrame({ deltaTime: FRAME_MS }),
      ),
    )
    expect(rested.fridge.door).toEqual(FridgeDoor.Shut())
    expect(isFridgeOffered(rested)).toBe(true)
  })

  test('the slam is heard and felt', () => {
    const slamming = modifyFields(atFridge(100), {
      fridge: () => ({
        door: FridgeDoor.Open({
          prize: 'Sandwich',
          slot: 0,
          remainingMs: FRAME_MS,
          durationMs: FRIDGE_RULES.openMs,
        }),
        pulls: FRIDGE_RULES.maxPulls,
        luck: 0,
      }),
    })
    const next = update(slamming, ticks(1, FRAME_MS)[0]!.message).model
    expect(
      Array.some(next.frameEvents, GameEvent.isAnyOf(['FridgeSlammed'])),
    ).toBe(true)
    expect(next.shake.trauma).toBeGreaterThan(0)
  })
})

describe('the odds', () => {
  const pistolCarrier = freshRunModel().player

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

  test('Brain Freeze is rare, the gags are one pull in five, and every slam makes the freeze a little likelier', () => {
    const first = prizeWeights(shutFridge, pistolCarrier)
    expect(shareOf(first, 'Freeze')).toBeCloseTo(0.08, 5)
    expect(shareOf(first, 'Sandwich') + shareOf(first, 'Dud')).toBeCloseTo(
      0.2,
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

  test('the player who holds pays and gets the prize; a teammate keeps their money and gun', () => {
    const crew = withWorld(atFridge(0), world => seatCrew(world, 2))
    const placedCrew = withWorld(crew, world =>
      withSeat(
        withSeat(world, 1, seat =>
          modifyFields(seat, {
            wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
            player: player =>
              modifyFields(player, {
                x: () => AT_FRIDGE.x,
                y: () => AT_FRIDGE.y,
              }),
          }),
        ),
        0,
        seat =>
          modifyFields(seat, {
            wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
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
    expect(holder.wallet.balance).toBeLessThanOrEqual(
      100 - FRIDGE_RULES.price + DUD_REFUND,
    )
    expect(teammate.wallet.balance).toBe(100)
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
          modifyFields(seat, {
            player: player =>
              modifyFields(player, {
                x: () => AT_FRIDGE.x - 6,
                y: () => AT_FRIDGE.y,
              }),
          }),
        ),
        0,
        seat =>
          modifyFields(seat, {
            player: player =>
              modifyFields(player, {
                x: () => AT_FRIDGE.x + 6,
                y: () => AT_FRIDGE.y,
              }),
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
