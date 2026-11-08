import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { ShopDialogBinding } from '../../../app/bindings'
import {
  Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  type ShopItemId,
  ShopState,
  type WeaponKind,
} from '../../../app/model'
import { Message as ShopMessage } from '../../../features/shop/message'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { DISTANT_SPAWN, newPlayerReady } from '../../../test/model.fixture'
import {
  APPLICATION,
  RESTART_GRACE_TICKS,
  holdFire,
  holdingSecond,
  maybeSpareGun,
  pistolOf,
  pistolOnly,
  press,
  tick,
  withPistol,
} from '../../../test/testing'
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
} from '../../gear/weapons'
import { TIER_LADDER } from '../../names'
import { focusOf, focusSlotOf, modifyFocus } from '../../party/party'
import { Verdict, verdictFor } from '../shop'

const FRAME_MS = FIXED_STEP_MS
const GRACE_TICK_MS = 50
const browsing = (balance: number, arsenal: Arsenal): Model =>
  modifyFocus(
    modifyFields(newPlayerReady, {
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: 15_000,
          durationMs: PREPARATION_MS,
          spawns: [DISTANT_SPAWN],
        }),
    }),
    {
      shop: () => ShopState.Browsing({ focusedItem: 'PistolUpgrade' }),
      wallet: () => ({ balance, earned: balance, shown: balance }),
      player: player => modifyFields(player, { arsenal: () => arsenal }),
    },
  )

const spare = (kind: WeaponKind, rounds: number, tier = 0): CarriedGun => ({
  kind,
  rounds,
  loaded: Math.min(rounds, magazineOf(kind, tier)),
  tier,
})

const buy = (item: ShopItemId) =>
  Story.messageIn(ShopDialogBinding, ShopMessage.PressedBuyKey({ item }))

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

  it.effect.each(UPGRADES)(
    'buying each $kind tier deducts its price, raises the tier, and is refused once maxed',
    ({ item, kind, arsenal }) => {
      const prices = tierPrices(kind)
      const total = Array.reduce(prices, 0, (sum, price) => sum + price)
      const start = total + 7
      const spentAfter = (tier: number): number =>
        Array.reduce(Array.take(prices, tier), 0, (sum, price) => sum + price)

      return Story.story(
        APPLICATION,
        Story.given(browsing(start, arsenal)),
        ...Array.flatMap(
          Array.makeBy(3, tier => tier + 1),
          tier => [
            buy(item),
            Story.model((current: Model) => {
              expect(tierOf(focusOf(current).player, kind)).toBe(tier)
              expect(focusOf(current).wallet.balance).toBe(
                start - spentAfter(tier),
              )
            }),
          ],
        ),
        Story.model(current => {
          expect(verdictFor(current, focusSlotOf(current), item)).toEqual(
            Verdict.Refused({ reason: 'Fully upgraded' }),
          )
        }),
        buy(item),
        Story.model(current => {
          expect(tierOf(focusOf(current).player, kind)).toBe(3)
          expect(focusOf(current).wallet.balance).toBe(7)
        }),
      )
    },
  )

  it.effect(
    'an upgrade is refused when broke, and the shop says how much is missing',
    () => {
      const price = tierPrices('Pistol')[0] ?? 0
      return Story.story(
        APPLICATION,
        Story.given(browsing(price - 5, pistolOnly())),
        Story.model(current => {
          expect(
            verdictFor(current, focusSlotOf(current), 'PistolUpgrade'),
          ).toEqual(Verdict.Refused({ reason: 'Need $5 more' }))
        }),
        buy('PistolUpgrade'),
        Story.model(({ seats: [{ player, wallet }] }) => {
          expect(pistolOf(player).tier).toBe(0)
          expect(wallet.balance).toBe(price - 5)
        }),
      )
    },
  )

  it.effect('a spare gun upgrade needs that gun in the second slot', () =>
    Story.story(
      APPLICATION,
      Story.given(browsing(1000, holdingSecond(spare('Smg', 120)))),
      Story.model(current => {
        expect(
          verdictFor(current, focusSlotOf(current), 'ShotgunUpgrade'),
        ).toEqual(Verdict.Refused({ reason: 'Needs the Barn Buster' }))
      }),
      buy('ShotgunUpgrade'),
      Story.model(({ seats: [{ wallet, player }] }) => {
        expect(wallet.balance).toBe(1000)
        expect(tierOf(player, 'Shotgun')).toBe(0)
      }),
    ),
  )

  it.effect(
    'firing reads the effective stats of the held gun at its tier',
    () =>
      Effect.gen(function* () {
        const fighting = (arsenal: Arsenal): Model =>
          modifyFocus(
            modifyFields(newPlayerReady, {
              phase: () =>
                Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
            }),
            {
              player: player =>
                modifyFields(player, {
                  arsenal: () => arsenal,
                }),
            },
          )

        yield* Story.story(
          APPLICATION,
          Story.given(fighting(pistolOnly({ ...STARTING_PISTOL, tier: 3 }))),
          holdFire,
          tick(FRAME_MS),
          Story.model(({ bullets, seats: [{ player }] }) => {
            expect(
              Array.map(bullets, ({ damage, knockback }) => [
                damage,
                knockback,
              ]),
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

        yield* Story.story(
          APPLICATION,
          Story.given(fighting(holdingSecond(spare('Shotgun', 16, 1)))),
          holdFire,
          tick(FRAME_MS),
          Story.model(({ bullets }) => {
            expect(bullets.length).toBe(statsAt('Shotgun', 1).pellets)
            expect(bullets.length).toBeGreaterThan(
              statsAt('Shotgun', 0).pellets,
            )
          }),
        )
      }),
  )

  test('every Barn Buster tier reloads faster than the one before', () => {
    Array.forEach([1, 2, 3], tier => {
      expect(statsAt('Shotgun', tier).reloadMs).toBeLessThan(
        statsAt('Shotgun', tier - 1).reloadMs,
      )
    })
  })

  it.effect(
    'a tier that raises the ammo cap lets a refill go past the old cap',
    () => {
      const baseCap = maxRounds('Smg', 0)
      const raisedCap = maxRounds('Smg', 2)
      expect(raisedCap).toBeGreaterThan(baseCap)

      return Story.story(
        APPLICATION,
        Story.given(browsing(1000, holdingSecond(spare('Smg', baseCap, 2)))),
        buy('SmgRounds'),
        Story.model(({ seats: [{ player }] }) => {
          expect(
            Option.map(maybeSpareGun(player.arsenal), ({ rounds }) => rounds),
          ).toEqual(Option.some(Math.min(raisedCap, baseCap + 120)))
        }),
      )
    },
  )
})

describe('tier resets', () => {
  it.effect(
    'buying a different spare gun replaces the slot and its upgrades',
    () =>
      Story.story(
        APPLICATION,
        Story.given(browsing(1000, holdingSecond(spare('Shotgun', 30, 2)))),
        buy('Smg'),
        Story.model(({ seats: [{ player }] }) => {
          expect(
            Option.map(maybeSpareGun(player.arsenal), gun => gun.tier),
          ).toEqual(Option.some(0))
          expect(tierOf(player, 'Smg')).toBe(0)
          expect(tierOf(player, 'Shotgun')).toBe(0)
        }),
        buy('Shotgun'),
        Story.model(({ seats: [{ player }] }) => {
          expect(maybeSpareGun(player.arsenal)).toEqual(
            Option.some(spare('Shotgun', 16, 0)),
          )
        }),
      ),
  )

  it.effect('the pistol tier survives a spare gun purchase', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(browsing(1000, pistolOnly()), {
          player: player =>
            withPistol(player, pistol => ({ ...pistol, tier: 2 })),
        }),
      ),
      buy('Smg'),
      Story.model(({ seats: [{ player }] }) => {
        expect(pistolOf(player).tier).toBe(2)
      }),
    ),
  )

  it.effect('a new run starts every gun at its base tier', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(newPlayerReady, {
            phase: () => Phase.GameOver({ wave: 5 }),
          }),
          {
            player: player =>
              modifyFields(player, {
                arsenal: () =>
                  Arsenal.HoldingSecond({
                    first: {
                      ...STARTING_PISTOL,
                      tier: 3,
                    },
                    second: spare('Smg', 200, 2),
                  }),
              }),
          },
        ),
      ),
      ...Array.makeBy(RESTART_GRACE_TICKS, () => tick(GRACE_TICK_MS)),
      press('Enter'),
      Story.model(({ phase, seats: [{ player }] }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(pistolOf(player).tier).toBe(0)
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    ),
  )
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
