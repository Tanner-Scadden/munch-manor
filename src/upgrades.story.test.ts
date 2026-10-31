import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  type Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  type ShopItemId,
  ShopState,
  type WeaponKind,
} from './model'
import { DISTANT_SPAWN, newPlayerReady } from './model.fixture'
import { TIER_LADDER } from './names'
import { Verdict, verdictFor } from './shop'
import {
  RESTART_GRACE_TICKS,
  holdFire,
  holdingSecond,
  maybeSpareGun,
  pistolOf,
  pistolOnly,
  press,
  tick,
  withPistol,
} from './testing'
import {
  STARTING_PISTOL,
  UPGRADE_TIERS,
  WEAPONS,
  magazineOf,
  maxRounds,
  maxTier,
  statsAt,
  tierName,
  tierOf,
} from './weapons'

const FRAME_MS = FIXED_STEP_MS
const GRACE_TICK_MS = 50
const browsing = (balance: number, arsenal: Arsenal): Model =>
  modifyFields(newPlayerReady, {
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [DISTANT_SPAWN],
      }),
    shop: () => ShopState.Browsing({ focusedItem: 'PistolUpgrade' }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player => modifyFields(player, { arsenal: () => arsenal }),
  })

const spare = (kind: WeaponKind, rounds: number, tier = 0): CarriedGun => ({
  kind,
  rounds,
  loaded: Math.min(rounds, magazineOf(kind, tier)),
  tier,
})

const buy = (item: ShopItemId) => message(Message.PressedBuyKey({ item }))

const tierPrices = (kind: WeaponKind): ReadonlyArray<number> =>
  Array.map(UPGRADE_TIERS[kind], ({ price }) => price)

const UPGRADES: ReadonlyArray<
  Readonly<{ item: ShopItemId; kind: WeaponKind; arsenal: Arsenal }>
> = [
  { item: 'PistolUpgrade', kind: 'Pistol', arsenal: pistolOnly() },
  {
    item: 'ShotgunUpgrade',
    kind: 'Shotgun',
    arsenal: holdingSecond(spare('Shotgun', 16)),
  },
  {
    item: 'SmgUpgrade',
    kind: 'Smg',
    arsenal: holdingSecond(spare('Smg', 120)),
  },
]

describe('upgrade tiers', () => {
  test('every gun has three tiers beyond its base, each changing its stats', () => {
    Array.forEach(UPGRADES, ({ kind }) => {
      expect(maxTier(kind)).toBe(3)
      Array.forEach(
        Array.makeBy(3, tier => tier),
        tier => {
          expect(statsAt(kind, tier + 1)).not.toEqual(statsAt(kind, tier))
        },
      )
    })
  })

  test.each(UPGRADES)(
    'buying each $kind tier deducts its price, raises the tier, and is refused once maxed',
    ({ item, kind, arsenal }) => {
      const prices = tierPrices(kind)
      const total = Array.reduce(prices, 0, (sum, price) => sum + price)
      const start = total + 7
      const spentAfter = (tier: number): number =>
        Array.reduce(Array.take(prices, tier), 0, (sum, price) => sum + price)

      story(
        update,
        given(browsing(start, arsenal)),
        ...Array.flatMap(
          Array.makeBy(3, tier => tier + 1),
          tier => [
            buy(item),
            model((current: Model) => {
              expect(tierOf(current.player, kind)).toBe(tier)
              expect(current.wallet.balance).toBe(start - spentAfter(tier))
            }),
          ],
        ),
        model(current => {
          expect(verdictFor(current, item)).toEqual(
            Verdict.Refused({ reason: 'Fully upgraded' }),
          )
        }),
        buy(item),
        model(current => {
          expect(tierOf(current.player, kind)).toBe(3)
          expect(current.wallet.balance).toBe(7)
        }),
      )
    },
  )

  test('an upgrade is refused when broke, and the shop says how much is missing', () => {
    const price = tierPrices('Pistol')[0] ?? 0
    story(
      update,
      given(browsing(price - 5, pistolOnly())),
      model(current => {
        expect(verdictFor(current, 'PistolUpgrade')).toEqual(
          Verdict.Refused({ reason: 'Need $5 more' }),
        )
      }),
      buy('PistolUpgrade'),
      model(({ player, wallet }) => {
        expect(pistolOf(player).tier).toBe(0)
        expect(wallet.balance).toBe(price - 5)
      }),
    )
  })

  test('a spare gun upgrade needs that gun in the second slot', () => {
    story(
      update,
      given(browsing(1000, holdingSecond(spare('Smg', 120)))),
      model(current => {
        expect(verdictFor(current, 'ShotgunUpgrade')).toEqual(
          Verdict.Refused({ reason: 'Needs the Barn Buster' }),
        )
      }),
      buy('ShotgunUpgrade'),
      model(({ wallet, player }) => {
        expect(wallet.balance).toBe(1000)
        expect(tierOf(player, 'Shotgun')).toBe(0)
      }),
    )
  })

  test('firing reads the effective stats of the held gun at its tier', () => {
    const fighting = (arsenal: Arsenal): Model =>
      modifyFields(newPlayerReady, {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
        player: player =>
          modifyFields(player, {
            arsenal: () => arsenal,
          }),
      })

    story(
      update,
      given(fighting(pistolOnly({ ...STARTING_PISTOL, tier: 3 }))),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets, player }) => {
        expect(
          Array.map(bullets, ({ damage, knockback }) => [damage, knockback]),
        ).toEqual([[2, statsAt('Pistol', 3).knockback]])
        expect(statsAt('Pistol', 3).knockback).toBeGreaterThan(
          statsAt('Pistol', 0).knockback,
        )
        expect(player.fireCooldownMs).toBe(
          statsAt('Pistol', 3).fireIntervalMs - FRAME_MS,
        )
        expect(statsAt('Pistol', 3).fireIntervalMs).toBeLessThan(
          statsAt('Pistol', 0).fireIntervalMs,
        )
      }),
    )

    story(
      update,
      given(fighting(holdingSecond(spare('Shotgun', 16, 1)))),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets }) => {
        expect(bullets.length).toBe(statsAt('Shotgun', 1).pellets)
        expect(bullets.length).toBeGreaterThan(statsAt('Shotgun', 0).pellets)
      }),
    )
  })

  test('every Barn Buster tier reloads faster than the one before', () => {
    Array.forEach([1, 2, 3], tier => {
      expect(statsAt('Shotgun', tier).reloadMs).toBeLessThan(
        statsAt('Shotgun', tier - 1).reloadMs,
      )
    })
  })

  test('a tier that raises the ammo cap lets a refill go past the old cap', () => {
    const baseCap = maxRounds('Smg', 0)
    const raisedCap = maxRounds('Smg', 2)
    expect(raisedCap).toBeGreaterThan(baseCap)

    story(
      update,
      given(browsing(1000, holdingSecond(spare('Smg', baseCap, 2)))),
      buy('SmgRounds'),
      model(({ player }) => {
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ rounds }) => rounds),
        ).toEqual(Option.some(Math.min(raisedCap, baseCap + 120)))
      }),
    )
  })
})

describe('tier resets', () => {
  test('buying a different spare gun replaces the slot and its upgrades', () => {
    story(
      update,
      given(browsing(1000, holdingSecond(spare('Shotgun', 30, 2)))),
      buy('Smg'),
      model(({ player }) => {
        expect(
          Option.map(maybeSpareGun(player.arsenal), gun => gun.tier),
        ).toEqual(Option.some(0))
        expect(tierOf(player, 'Smg')).toBe(0)
        expect(tierOf(player, 'Shotgun')).toBe(0)
      }),
      buy('Shotgun'),
      model(({ player }) => {
        expect(maybeSpareGun(player.arsenal)).toEqual(
          Option.some(spare('Shotgun', 16, 0)),
        )
      }),
    )
  })

  test('the pistol tier survives a spare gun purchase', () => {
    story(
      update,
      given(
        modifyFields(browsing(1000, pistolOnly()), {
          player: player =>
            withPistol(player, pistol => ({ ...pistol, tier: 2 })),
        }),
      ),
      buy('Smg'),
      model(({ player }) => {
        expect(pistolOf(player).tier).toBe(2)
      }),
    )
  })

  test('a new run starts every gun at its base tier', () => {
    story(
      update,
      given(
        modifyFields(newPlayerReady, {
          phase: () => Phase.GameOver({ wave: 5 }),
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingSecond(spare('Smg', 200, 2), {
                  ...STARTING_PISTOL,
                  tier: 3,
                }),
            }),
        }),
      ),
      ...Array.makeBy(RESTART_GRACE_TICKS, () => tick(GRACE_TICK_MS)),
      press('Enter'),
      model(({ phase, player }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(pistolOf(player).tier).toBe(0)
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    )
  })
})

describe('tier names', () => {
  const GUNS: ReadonlyArray<WeaponKind> = ['Pistol', 'Shotgun', 'Smg']

  const namesOf = (kind: WeaponKind): ReadonlyArray<string> =>
    Array.makeBy(maxTier(kind) + 1, tier => tierName(kind, tier))

  test('every gun climbs the same ladder of tier words around its base name', () => {
    expect(Array.map(GUNS, namesOf)).toEqual([
      [
        'Pop Pistol',
        'Beefy Pop Pistol',
        'Pop Pistol DELUXE',
        'Pop Pistol 3000',
      ],
      [
        'Barn Buster',
        'Beefy Barn Buster',
        'Barn Buster DELUXE',
        'Barn Buster 3000',
      ],
      [
        'Chatterbox',
        'Beefy Chatterbox',
        'Chatterbox DELUXE',
        'Chatterbox 3000',
      ],
    ])
  })

  test('the ladder has a word for every tier of every gun', () => {
    Array.forEach(GUNS, kind => {
      expect(maxTier(kind)).toBeLessThan(TIER_LADDER.length)
      Array.forEach(namesOf(kind), (name, tier) =>
        expect(name).toBe(TIER_LADDER[tier]?.(WEAPONS[kind].name)),
      )
    })
  })
})
