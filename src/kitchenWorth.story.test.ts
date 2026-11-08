import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { levelOf, openExitIn } from './arena'
import { killEvent } from './combat'
import { FIXED_STEP_MS, SHAMBLER_BOUNTY } from './constants'
import { KITCHEN_EXIT } from './exits'
import { oddsPips } from './fridgeView'
import { KITCHEN_PAY_SCALE, isInKitchenAt, kitchenBounty } from './kitchenPay'
import {
  DUD_REFUND,
  FRIDGE_RULES,
  carriedTierFor,
  fridgePriceFor,
  prizeOddsFor,
  pullFridge,
} from './leftovers'
import {
  type Model,
  Pantry,
  type PantryGoodie,
  Phase,
  SOLO_SLOT,
  type Zombie,
} from './model'
import {
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
  withSeat,
} from './model.fixture'
import { PANTRY_RULES, maybeStash, pantrySpotOf } from './pantry'
import { focusOf, maybePlayerAt, modifyFocus, seatCrew } from './party'
import { offersOf } from './purchase'
import { update } from './pureApp'
import {
  FRIDGE_OPEN_TICKS,
  bulletInto,
  holdToBuy,
  holdingSecond,
  pistolOnly,
  tick,
  ticks,
  zombieOf,
} from './testing'
import { freshGun, maxTier } from './weapons'
import { withWorld } from './world'

// The kitchen is worth the walk (owner, 2026-11-02): the fridge's odds on
// its door and its cheaper first pull a round (src/leftovers.ts), the
// pantry's stash (src/pantry.ts), and kitchen kill pay (src/kitchenPay.ts).

const FRAME_MS = FIXED_STEP_MS

const fridgePriceOf = (current: Model): Option.Option<number> =>
  Option.map(
    Array.findFirst(
      offersOf(current, SOLO_SLOT),
      ({ target }) => target._tag === 'Fridge',
    ),
    ({ price }) => price,
  )

describe('the fridge is worth a pull', () => {
  test('its odds are a share of 1 for the seat, and a carried weapon shows none', () => {
    const odds = prizeOddsFor(atFridge(100), SOLO_SLOT)
    const total = Array.reduce(odds, 0, (sum, [, share]) => sum + share)
    expect(total).toBeCloseTo(1, 5)
    expect(odds).toContainEqual(['Dud', 0.04])
    const withCooker = modifyFocus(atFridge(100), {
      player: player =>
        modifyFields(player, {
          arsenal: () => holdingSecond(freshGun('Cooker')),
        }),
    })
    expect(prizeOddsFor(withCooker, SOLO_SLOT)).toContainEqual(['Cooker', 0])
  })

  test('the odds card shows a pip for every 5 in 100, one at least', () => {
    expect(oddsPips(0.3825)).toBe(8)
    expect(oddsPips(0.085)).toBe(2)
    expect(oddsPips(0.04)).toBe(1)
    expect(oddsPips(0)).toBe(0)
  })

  test('the first pull of a round is cheaper; the next one this break and mid-wave is not', () => {
    story(
      update,
      given(fridgeSeededFor(atFridge(300), 'Dud')),
      model(current => {
        expect(fridgePriceOf(current)).toEqual(
          Option.some(FRIDGE_RULES.firstPrice),
        )
      }),
      holdToBuy,
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(
          300 - FRIDGE_RULES.firstPrice + DUD_REFUND,
        )
      }),
      ...ticks(FRIDGE_OPEN_TICKS + 2, FRAME_MS),
      model(current => {
        expect(fridgePriceOf(current)).toEqual(Option.some(FRIDGE_RULES.price))
        const fighting = modifyFields(current, {
          phase: () =>
            Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
        })
        expect(fridgePriceFor(fighting, SOLO_SLOT)).toBe(FRIDGE_RULES.price)
        const nextBreak = modifyFields(current, {
          phase: () =>
            Phase.Preparation({
              wave: 6,
              remainingMs: 60_000,
              durationMs: 60_000,
              spawns: [DISTANT_SPAWN],
            }),
        })
        expect(fridgePriceFor(nextBreak, SOLO_SLOT)).toBe(
          FRIDGE_RULES.firstPrice,
        )
      }),
    )
  })

  test('a pull mid-wave spends that round, so the break before it already did', () => {
    const fighting = modifyFields(atFridge(300), {
      phase: () =>
        Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    const pulled = Option.getOrThrow(
      pullFridge(fighting, SOLO_SLOT, FRIDGE_RULES.firstPrice),
    )
    expect(fridgePriceFor(pulled, SOLO_SLOT)).toBe(FRIDGE_RULES.price)
  })

  test('in co-op each seat has its own cheap first pull', () => {
    const crew = withWorld(atFridge(300), world =>
      withSeat(seatCrew(world, 2), 1, seat =>
        modifyFocus(seat, {
          wallet: () => ({ balance: 300, earned: 300, shown: 300 }),
        }),
      ),
    )
    const pulled = withWorld(crew, world =>
      Option.getOrThrow(pullFridge(world, 1, FRIDGE_RULES.firstPrice)),
    )
    expect(fridgePriceFor(pulled, 1)).toBe(FRIDGE_RULES.price)
    expect(fridgePriceFor(pulled, 0)).toBe(FRIDGE_RULES.firstPrice)
    expect(
      Option.map(maybePlayerAt(pulled, 1), ({ wallet }) => wallet.balance),
    ).toEqual(Option.some(300 - FRIDGE_RULES.firstPrice))
  })

  test('the Sandwich heals a heart and burps the Dud refund back', () => {
    story(
      update,
      given(
        fridgeSeededFor(
          modifyFocus(atFridge(100), {
            player: player => modifyFields(player, { hp: () => 2 }),
          }),
          'Sandwich',
        ),
      ),
      holdToBuy,
      model(current => {
        expect(focusOf(current).player.hp).toBe(3)
        expect(focusOf(current).wallet.balance).toBe(
          100 - FRIDGE_RULES.firstPrice + DUD_REFUND,
        )
      }),
    )
  })
})

describe('a prize keeps the tier of the gun it replaces', () => {
  const takeWith = (smgTier: number, prize: 'Cooker' | 'Freeze'): Model => {
    const smg = modifyFields(freshGun('Smg'), { tier: () => smgTier })
    let taken = atFridge(100)
    story(
      update,
      given(
        fridgeSeededFor(
          modifyFocus(atFridge(100), {
            player: player =>
              modifyFields(player, { arsenal: () => holdingSecond(smg) }),
          }),
          prize,
        ),
      ),
      holdToBuy,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      holdToBuy,
      model(current => {
        taken = current
      }),
    )
    return taken
  }

  test('an upgraded Chatterbox gives way to a Cooker at its tier', () => {
    expect(focusOf(takeWith(2, 'Cooker')).player.arsenal).toEqual(
      holdingSecond(freshGun('Cooker', 'You', 2)),
    )
  })

  test("the tier stops at the prize's own top tier, and Brain Freeze has none", () => {
    const top = maxTier('Cooker')
    const smg = modifyFields(freshGun('Smg'), { tier: () => top + 2 })
    const player = modifyFields(focusOf(atFridge(0)).player, {
      arsenal: () => holdingSecond(smg),
    })
    expect(carriedTierFor(player, 'Cooker')).toBe(top)
    expect(focusOf(takeWith(2, 'Freeze')).player.arsenal).toEqual(
      holdingSecond(freshGun('Freeze')),
    )
  })

  test('into an empty slot it starts at tier 0', () => {
    const pistol = modifyFields(freshGun('Pistol'), { tier: () => 2 })
    const player = modifyFields(focusOf(atFridge(0)).player, {
      arsenal: () => pistolOnly(pistol),
    })
    expect(carriedTierFor(player, 'Cooker')).toBe(0)
  })
})

// THE PANTRY

const PANTRY_SPOT = Option.getOrThrow(pantrySpotOf(levelOf(atFridge(0))))

const atPantry = (current: Model): Model =>
  modifyFocus(current, {
    player: player =>
      modifyFields(player, {
        x: () => PANTRY_SPOT.x,
        y: () => PANTRY_SPOT.y,
      }),
  })

const stocked = (current: Model, goodie: PantryGoodie, cash = 20): Model =>
  modifyFields(current, {
    pantry: () => Pantry.Stocked({ round: 5, goodie, cash }),
  })

describe('the pantry stash', () => {
  test('a break with the kitchen open stocks it; a boarded kitchen never does', () => {
    story(
      update,
      given(atFridge(0)),
      tick(FRAME_MS),
      model(current => {
        expect(Option.isSome(maybeStash(current))).toBe(true)
      }),
    )
    story(
      update,
      given(modifyFields(atFridge(0), { level: () => freshRunModel().level })),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(Option.isNone(maybeStash(current))).toBe(true)
        expect(current.pantry).toEqual(Pantry.Bare({ round: 0 }))
      }),
    )
  })

  test('its goodie is cash from 15 to 30, Lids, or a heart, by the World generator, which it never moves', () => {
    const rolls = Array.makeBy(60, index => {
      const start = modifyFields(atFridge(0), { rngState: () => index * 7919 })
      const next = update(start, ticks(1, FRAME_MS)[0]!.message).model
      expect(next.rngState).toBe(start.rngState)
      expect(next.loot).toEqual(start.loot)
      return Option.getOrThrow(maybeStash(next))
    })
    const goodies = Array.dedupe(Array.map(rolls, ({ goodie }) => goodie))
    expect(goodies).toHaveLength(3)
    Array.forEach(rolls, ({ cash }) => {
      expect(cash).toBeGreaterThanOrEqual(PANTRY_RULES.minCash)
      expect(cash).toBeLessThanOrEqual(PANTRY_RULES.maxCash)
    })
  })

  test('walking onto it takes it, once a break, and the next break restocks', () => {
    story(
      update,
      given(atPantry(stocked(atFridge(0), 'Cash', 23))),
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(23)
        expect(current.pantry).toEqual(Pantry.Bare({ round: 5 }))
        expect(
          Array.some(
            current.frameEvents,
            event => event._tag === 'PantryTaken',
          ),
        ).toBe(true)
        expect(
          Array.some(current.popups, ({ kind }) => kind === 'Payday'),
        ).toBe(true)
      }),
      ...ticks(30, FRAME_MS),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(23)
        expect(Option.isNone(maybeStash(current))).toBe(true)
        const nextBreak = modifyFields(current, {
          phase: () =>
            Phase.Preparation({
              wave: 6,
              remainingMs: 60_000,
              durationMs: 60_000,
              spawns: [DISTANT_SPAWN],
            }),
        })
        const restocked = update(
          nextBreak,
          ticks(1, FRAME_MS)[0]!.message,
        ).model
        expect(restocked.pantry.round).toBe(6)
        expect(focusOf(restocked).wallet.balance).toBeGreaterThan(23)
      }),
    )
  })

  test('in co-op the first to walk on takes it, and a teammate there too gets nothing', () => {
    const crew = withWorld(atPantry(stocked(atFridge(0), 'Cash', 25)), world =>
      withSeat(seatCrew(world, 2), 1, seat =>
        modifyFocus(seat, {
          player: player =>
            modifyFields(player, {
              x: () => PANTRY_SPOT.x + 2,
              y: () => PANTRY_SPOT.y,
            }),
        }),
      ),
    )
    const next = update(crew, ticks(1, FRAME_MS)[0]!.message).model
    const balances = Array.map(next.seats, ({ wallet }) => wallet.balance)
    expect(balances).toEqual([25, 0])
  })

  test('mid-wave it is gone', () => {
    const fighting = modifyFields(atPantry(stocked(atFridge(0), 'Cash')), {
      phase: () =>
        Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    })
    const next = update(fighting, ticks(1, FRAME_MS)[0]!.message).model
    expect(focusOf(next).wallet.balance).toBe(0)
    expect(Option.isNone(maybeStash(next))).toBe(true)
  })

  test('Lids fill a Cooker carrier; without a Cooker they pay the cash', () => {
    const cooker = modifyFields(freshGun('Cooker'), { rounds: () => 4 })
    const carrier = modifyFocus(atPantry(stocked(atFridge(0), 'Lids', 18)), {
      player: player =>
        modifyFields(player, { arsenal: () => holdingSecond(cooker) }),
    })
    const filled = update(carrier, ticks(1, FRAME_MS)[0]!.message).model
    expect(focusOf(filled).player.arsenal).toEqual(
      holdingSecond(modifyFields(cooker, { rounds: () => 12 })),
    )
    expect(focusOf(filled).wallet.balance).toBe(0)
    const none = update(
      atPantry(stocked(atFridge(0), 'Lids', 18)),
      ticks(1, FRAME_MS)[0]!.message,
    ).model
    expect(focusOf(none).wallet.balance).toBe(18)
  })

  test('a heart heals the hurt; at full health, or in Glass, it pays the cash', () => {
    const hurt = modifyFocus(atPantry(stocked(atFridge(0), 'Heart', 17)), {
      player: player => modifyFields(player, { hp: () => 2 }),
    })
    const healed = update(hurt, ticks(1, FRAME_MS)[0]!.message).model
    expect(focusOf(healed).player.hp).toBe(3)
    expect(focusOf(healed).wallet.balance).toBe(0)
    const whole = update(
      atPantry(stocked(atFridge(0), 'Heart', 17)),
      ticks(1, FRAME_MS)[0]!.message,
    ).model
    expect(focusOf(whole).wallet.balance).toBe(17)
    const glass = modifyFields(hurt, {
      modifiers: modifiers => modifyFields(modifiers, { glass: () => true }),
    })
    const paid = update(glass, ticks(1, FRAME_MS)[0]!.message).model
    expect(focusOf(paid).player.hp).toBe(2)
    expect(focusOf(paid).wallet.balance).toBe(17)
  })
})

// KITCHEN KILL PAY

describe('kitchen kill pay', () => {
  const KITCHEN_SPOT = { x: 35, y: -55 }
  const PARLOUR_SPOT = { x: 60, y: 85 }

  const shotDown = (
    at: Readonly<{ x: number; y: number }>,
    kind: Zombie['kind'] = 'Shambler',
  ): Model => {
    const victim = zombieOf(kind, 100, at.x, at.y, { hp: 1 })
    return modifyFields(atFridge(0), {
      phase: () =>
        Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => [victim],
      bullets: () => [bulletInto(500, victim, { knockback: 0 })],
    })
  }

  test('a kill on a kitchen tile pays a quarter more, rounded, with a popup and coins to say so', () => {
    story(
      update,
      given(shotDown(KITCHEN_SPOT)),
      tick(FRAME_MS),
      model(current => {
        const pay = Math.round(SHAMBLER_BOUNTY * KITCHEN_PAY_SCALE)
        expect(focusOf(current).wallet.balance).toBe(pay)
        expect(
          Array.some(
            current.popups,
            ({ kind, value }) => kind === 'Kill' && value === pay,
          ),
        ).toBe(true)
        expect(
          Array.some(current.particles, ({ kind }) => kind === 'Coin'),
        ).toBe(true)
      }),
    )
  })

  test('a Big Lug in the kitchen pays 25 for 20', () => {
    story(
      update,
      given(shotDown(KITCHEN_SPOT, 'Tank')),
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(25)
      }),
    )
  })

  test('in the parlour a kill pays as it always has', () => {
    story(
      update,
      given(shotDown(PARLOUR_SPOT)),
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(SHAMBLER_BOUNTY)
      }),
    )
  })

  test('the kitchen counts only while it is open, and never out in the yard', () => {
    const open = levelOf({
      level: openExitIn(freshRunModel().level, KITCHEN_EXIT),
    })
    const boarded = levelOf(freshRunModel())
    expect(isInKitchenAt(open, KITCHEN_SPOT)).toBe(true)
    expect(isInKitchenAt(boarded, KITCHEN_SPOT)).toBe(false)
    expect(isInKitchenAt(open, { x: 250, y: -55 })).toBe(false)
    expect(isInKitchenAt(open, PARLOUR_SPOT)).toBe(false)
    const killed = killEvent(
      zombieOf('Shambler', 1, KITCHEN_SPOT.x, KITCHEN_SPOT.y),
      { x: 1, y: 0 },
    )
    expect(
      killed._tag === 'ZombieKilled' &&
        kitchenBounty(open, killed, killed.bounty),
    ).toBe(3)
  })
})
