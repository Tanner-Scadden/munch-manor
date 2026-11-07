import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  FIXED_STEP_MS,
  PISTOL_DAMAGE,
  PISTOL_MAGAZINE,
  PISTOL_RELOAD_MS,
} from './constants'
import { update } from './main'
import {
  type CarriedGun,
  GameEvent,
  type GunPerk,
  type Model,
  Phase,
  Pierce,
  Purchase,
} from './model'
import {
  DISTANT_SPAWN,
  atFridge,
  atStove,
  fighting,
  freshRunModel,
  fridgeSeededFor,
  kitchenBreak,
} from './model.fixture'
import { focusOf, focusSlotOf, modifyFocus } from './party'
import { nextRandom } from './prng'
import { offersOf } from './purchase'
import { STOVE_RULES, rollStove } from './stove'
import {
  FRIDGE_OPEN_TICKS,
  HOLD_TICKS,
  holdEnter,
  holdFire,
  holdingSecond,
  pistolOnly,
  press,
  release,
  tick,
  ticks,
  ticksFor,
} from './testing'
import { PERK_RULES, carriedMagazine, freshGun, heldGun } from './weapons'
import { Arsenal } from './worldSchema'

// The kitchen's stove bench (src/stove.ts): a perk cooked into the gun in
// hand, one a break, at a price that climbs, and what each perk does.

const FRAME_MS = FIXED_STEP_MS

const COOK_TICKS = Math.ceil(STOVE_RULES.holdMs / FRAME_MS) + 3

const cook = holdEnter(COOK_TICKS)

const PERK_ROLLS: ReadonlyArray<GunPerk> = ['Spicy', 'Crispy', 'Hearty']

const rolledFrom = (state: number): GunPerk =>
  Option.getOrThrow(
    Array.get(PERK_ROLLS, Math.floor(nextRandom(state).value * 3)),
  )

const stoveOffer = (current: Model) =>
  Array.findFirst(
    offersOf(current, focusSlotOf(current)),
    ({ target }) => target._tag === 'Stove',
  )

const heldPerk = (current: Model): Option.Option<GunPerk> =>
  Option.fromNullishOr(heldGun(focusOf(current).player.arsenal).perk)

const withArsenalOf = (base: Model, second: CarriedGun): Model =>
  modifyFocus(base, {
    player: player =>
      modifyFields(player, { arsenal: () => holdingSecond(second) }),
  })

const withPistolOf = (base: Model, pistol: CarriedGun): Model =>
  modifyFocus(base, {
    player: player =>
      modifyFields(player, { arsenal: () => pistolOnly(pistol) }),
  })

// NOTE: a wave under way in a veteran's run, on a measured surface, so a
// thumb on the aim stick fires.
const midWave: Model = modifyFields(freshRunModel(), {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

const withCooking = (base: Model, cooks: number, lastWave = 0): Model =>
  modifyFocus(base, { cooking: () => ({ cooks, lastWave }) })

// NOTE: the stove's roll, made in place, so a test can start from any
// perk on offer.
const offering = (base: Model, perk: GunPerk): Model =>
  modifyFields(base, {
    stove: stove => modifyFields(stove, { perk: () => perk, wave: () => 5 }),
  })

const cookedPistol = (perk: GunPerk): CarriedGun => ({
  ...freshGun('Pistol'),
  perk,
})

describe('the stove rolls its perk', () => {
  test('each break rolls one perk from its own generator, and keeps it all break', () => {
    const start = atStove(500)
    const firstState = start.stove.rngState
    story(
      update,
      given(start),
      tick(FRAME_MS),
      model(current => {
        expect(current.stove.wave).toBe(5)
        expect(current.stove.perk).toBe(rolledFrom(firstState))
        expect(current.stove.rngState).toBe(nextRandom(firstState).nextState)
      }),
      ...ticks(30, FRAME_MS),
      model(current => {
        expect(current.stove.perk).toBe(rolledFrom(firstState))
        expect(current.stove.rngState).toBe(nextRandom(firstState).nextState)
      }),
    )
  })

  test('the next break rolls again from where the last left off, and no other roll moves', () => {
    const rolled = rollStove(atStove(500))
    const next = rollStove(
      modifyFields(rolled, { phase: () => kitchenBreak(6) }),
    )
    expect(next.stove.wave).toBe(6)
    expect(next.stove.perk).toBe(rolledFrom(rolled.stove.rngState))
    expect(next.rngState).toBe(atStove(500).rngState)
    expect(rollStove(next)).toBe(next)
    expect(rollStove(atStove(500))).toEqual(rolled)
  })

  test('mid-wave nothing rolls and the stove offers nothing', () => {
    expect(rollStove(fighting)).toBe(fighting)
    expect(Option.isNone(stoveOffer(fighting))).toBe(true)
  })
})

describe('cooking a gun', () => {
  test('holding Enter at the stove for a second pays and cooks the perk into the gun in hand', () => {
    story(
      update,
      given(offering(withArsenalOf(atStove(500), freshGun('Smg')), 'Crispy')),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(Option.isNone(heldPerk(current))).toBe(true)
        expect(focusOf(current).wallet.balance).toBe(500)
      }),
      ...ticks(COOK_TICKS - HOLD_TICKS, FRAME_MS),
      release('Enter'),
      model(current => {
        expect(heldPerk(current)).toEqual(Option.some('Crispy'))
        expect(focusOf(current).wallet.balance).toBe(
          500 - STOVE_RULES.prices[0],
        )
        expect(focusOf(current).cooking).toEqual({ cooks: 1, lastWave: 5 })
        expect(current.stats.purchases).toBe(1)
      }),
    )
  })

  test('the price climbs with each cook: $90, $180, then $300 for good', () => {
    const priceAt = (cooks: number): number =>
      Option.getOrThrow(
        stoveOffer(withCooking(rollStove(atStove(1000)), cooks)),
      ).price
    expect(Array.map([0, 1, 2, 3, 6], priceAt)).toEqual([
      90, 180, 300, 300, 300,
    ])
  })

  test('one cook a break: once cooked the stove offers nothing more until the next break', () => {
    story(
      update,
      given(offering(atStove(1000), 'Spicy')),
      ...cook,
      model(current => {
        expect(heldPerk(current)).toEqual(Option.some('Spicy'))
        expect(Option.isNone(stoveOffer(current))).toBe(true)
      }),
      ...cook,
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(
          1000 - STOVE_RULES.prices[0],
        )
        expect(focusOf(current).cooking.cooks).toBe(1)
      }),
    )
    const nextBreak = rollStove(
      withCooking(
        modifyFields(atStove(1000), { phase: () => kitchenBreak(6) }),
        1,
        5,
      ),
    )
    expect(Option.map(stoveOffer(nextBreak), ({ price }) => price)).toEqual(
      Option.some(STOVE_RULES.prices[1]),
    )
  })

  test('cooking a gun that has a perk puts the new one in its place', () => {
    story(
      update,
      given(
        offering(withArsenalOf(atStove(500), cookedPistol('Hearty')), 'Spicy'),
      ),
      ...cook,
      model(current => {
        expect(heldPerk(current)).toEqual(Option.some('Spicy'))
      }),
    )
  })
})

describe('what the stove will not cook', () => {
  const knifeOut = modifyFocus(atStove(500), {
    player: player => modifyFields(player, { wield: () => 'Melee' }),
  })
  const freezeInHand = withArsenalOf(atStove(500), freshGun('Freeze'))

  test.each([
    ['the knife', knifeOut],
    ['a fridge weapon', freezeInHand],
  ])('%s in hand is refused, briefly, and nothing is cooked', (_, base) => {
    story(
      update,
      given(base),
      tick(FRAME_MS),
      model(current => {
        expect(Option.map(stoveOffer(current), ({ isFull }) => isFull)).toEqual(
          Option.some(true),
        )
      }),
      press('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(Purchase.isAnyOf(['Refused'])(focusOf(current).purchase)).toBe(
          true,
        )
        expect(
          Array.some(
            current.frameEvents,
            GameEvent.isAnyOf(['PurchaseRefused']),
          ),
        ).toBe(true)
      }),
      ...ticks(COOK_TICKS, FRAME_MS),
      release('Enter'),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(500)
        expect(focusOf(current).cooking.cooks).toBe(0)
        expect(Option.isNone(heldPerk(current))).toBe(true)
      }),
    )
  })
})

describe('what each perk does', () => {
  test('Spicy hits 30% harder and glows hot', () => {
    story(
      update,
      given(withPistolOf(midWave, cookedPistol('Spicy'))),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets }) => {
        const bullet = Option.getOrThrow(Array.head(bullets))
        expect(bullet.damage).toBeCloseTo(
          PISTOL_DAMAGE * PERK_RULES.spicyDamageScale,
          9,
        )
        expect(bullet.glaze).toBe('Spicy')
      }),
    )
  })

  test('Crispy skewers one zombie more', () => {
    story(
      update,
      given(withPistolOf(midWave, cookedPistol('Crispy'))),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets }) => {
        const bullet = Option.getOrThrow(Array.head(bullets))
        expect(bullet.pierce).toEqual(
          Pierce.Skewers({ left: PERK_RULES.crispyPierce, struck: [] }),
        )
        expect(bullet.damage).toBe(PISTOL_DAMAGE)
      }),
    )
  })

  test('Hearty holds a quarter more, rounded, and a reload fills it', () => {
    const hearty = cookedPistol('Hearty')
    const bigger = Math.round(PISTOL_MAGAZINE * PERK_RULES.heartyMagazineScale)
    expect(carriedMagazine('You', hearty)).toBe(bigger)
    expect(carriedMagazine('You', freshGun('Pistol'))).toBe(PISTOL_MAGAZINE)
    story(
      update,
      given(withPistolOf(midWave, { ...hearty, loaded: 0 })),
      press('KeyR'),
      ...ticksFor(PISTOL_RELOAD_MS + 100, FRAME_MS),
      model(current => {
        expect(heldGun(focusOf(current).player.arsenal).loaded).toBe(bigger)
      }),
    )
  })

  test('a new gun in its place comes plain: the perk goes with the old gun', () => {
    const spicySmg: CarriedGun = { ...freshGun('Smg'), perk: 'Spicy' }
    const crispyPistol = cookedPistol('Crispy')
    const start = fridgeSeededFor(
      modifyFocus(atFridge(500), {
        player: player =>
          modifyFields(player, {
            arsenal: () =>
              Arsenal.HoldingSecond({ first: crispyPistol, second: spicySmg }),
          }),
      }),
      'Cooker',
    )
    const pull = holdEnter(HOLD_TICKS)
    story(
      update,
      given(start),
      ...pull,
      ...ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
      ...pull,
      model(current => {
        expect(focusOf(current).player.arsenal).toEqual(
          Arsenal.HoldingSecond({
            first: crispyPistol,
            second: freshGun('Cooker'),
          }),
        )
      }),
    )
  })
})
