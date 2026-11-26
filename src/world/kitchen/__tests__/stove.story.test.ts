import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import {
  BreakClock,
  type CarriedGun,
  GameEvent,
  type GunPerk,
  type Model,
  Phase,
  Pierce,
  Purchase,
} from '../../../app/model'
import {
  FIXED_STEP_MS,
  PISTOL_DAMAGE,
  PISTOL_MAGAZINE,
  PISTOL_RELOAD_MS,
} from '../../../shared/constants'
import type { Calling } from '../../../shared/playerData'
import { nextRandom } from '../../../shared/prng'
import { holdingSecond, pistolOnly } from '../../../test/arsenals'
import {
  DISTANT_SPAWN,
  atFridge,
  atStove,
  freshRunModel,
  fridgeSeededFor,
  kitchenBreak,
  withFeatsOf,
} from '../../../test/model.fixture'
import {
  FRIDGE_OPEN_TICKS,
  HOLD_TICKS,
  checkModel,
  holdEnter,
  holdFire,
  modelAfter,
  press,
  release,
  steps,
  tick,
  ticks,
  ticksFor,
} from '../../../test/testing'
import {
  PERK_RULES,
  carriedMagazine,
  freshGun,
  heldGun,
} from '../../gear/weapons'
import { focusOf, focusSlotOf, modifyFocus } from '../../party/party'
import { Arsenal } from '../../schema/worldSchema'
import { offersOf } from '../../shop/purchase'
import { STOVE_RULES, maybeStoveLock, rollStove } from '../stove'

// The kitchen's stove bench (src/world/kitchen/stove.ts): a perk cooked into the gun in
// hand, one a round (its break and its wave), free once its feat (kitchen kills) is done, and what
// each perk does.

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
      UiStruct.evolve(player, { arsenal: () => holdingSecond(second) }),
  })

const withPistolOf = (base: Model, pistol: CarriedGun): Model =>
  modifyFocus(base, {
    player: player =>
      UiStruct.evolve(player, { arsenal: () => pistolOnly(pistol) }),
  })

// NOTE: a wave under way in a veteran's run, on a measured surface, so a
// thumb on the aim stick fires.
const midWave: Model = UiStruct.evolve(freshRunModel(), {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

const withCooking = (base: Model, cooks: number, lastWave = 0): Model =>
  modifyFocus(base, { cooking: () => ({ cooks, lastWave }) })

// NOTE: the stove's roll, made in place, so a test can start from any
// perk on offer.
const offering = (base: Model, perk: GunPerk): Model =>
  UiStruct.evolve(base, {
    stove: stove => UiStruct.evolve(stove, { perk: () => perk, wave: () => 5 }),
  })

const cookedPistol = (perk: GunPerk): CarriedGun => ({
  ...freshGun('Pistol'),
  perk,
})

describe('the stove rolls its perk', () => {
  it.effect(
    'each break rolls one perk from its own generator, and keeps it all break',
    () => {
      const start = atStove(500)
      const firstState = start.stove.rngState
      return modelAfter(
        start,
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(current.stove.wave).toBe(5)
            expect(current.stove.perk).toBe(rolledFrom(firstState))
            expect(current.stove.rngState).toBe(
              nextRandom(firstState).nextState,
            )
          }),
          ticks(30, FRAME_MS),
          checkModel(current => {
            expect(current.stove.perk).toBe(rolledFrom(firstState))
            expect(current.stove.rngState).toBe(
              nextRandom(firstState).nextState,
            )
          }),
        ),
      )
    },
  )

  test('the next break rolls again from where the last left off, and no other roll moves', () => {
    const rolled = rollStove(atStove(500))
    const next = rollStove(
      UiStruct.evolve(rolled, { phase: () => kitchenBreak(6) }),
    )
    expect(next.stove.wave).toBe(6)
    expect(next.stove.perk).toBe(rolledFrom(rolled.stove.rngState))
    expect(next.rngState).toBe(atStove(500).rngState)
    expect(rollStove(next)).toBe(next)
    expect(rollStove(atStove(500))).toEqual(rolled)
  })

  it.effect(
    "the break's perk stays on offer through its wave, and a wave starting a round rolls one",
    () => {
      const rolled = rollStove(atStove(500))
      const inWave = (wave: number): Phase =>
        Phase.Wave({ wave, elapsedMs: 5000, spawns: [DISTANT_SPAWN] })
      return Effect.gen(function* () {
        yield* modelAfter(
          UiStruct.evolve(rolled, { phase: () => inWave(5) }),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(current.stove).toEqual(rolled.stove)
              expect(Option.isSome(stoveOffer(current))).toBe(true)
            }),
          ),
        )
        yield* modelAfter(
          UiStruct.evolve(rolled, { phase: () => inWave(6) }),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(current.stove.wave).toBe(6)
              expect(current.stove.perk).toBe(rolledFrom(rolled.stove.rngState))
            }),
          ),
        )
      })
    },
  )
})

describe('cooking a gun', () => {
  it.effect(
    'holding Enter at the stove for a second cooks the perk into the gun in hand, free',
    () =>
      modelAfter(
        offering(withArsenalOf(atStove(500), freshGun('Smg')), 'Crispy'),
        steps(
          press('Enter'),
          ticks(HOLD_TICKS, FRAME_MS),
          checkModel(current => {
            expect(Option.isNone(heldPerk(current))).toBe(true)
            expect(current.keys.held).toBe(500)
          }),
          ticks(COOK_TICKS - HOLD_TICKS, FRAME_MS),
          release('Enter'),
          checkModel(current => {
            expect(heldPerk(current)).toEqual(Option.some('Crispy'))
            expect(current.keys.held).toBe(500)
            expect(focusOf(current).cooking).toEqual({ cooks: 1, lastWave: 5 })
          }),
        ),
      ),
  )

  test('the stove waits for its feat: 15 kitchen kills, half for the Line Cook', () => {
    const killsOf = (kills: number, calling: Calling): Model =>
      modifyFocus(
        withFeatsOf(rollStove(atStove(0)), tally =>
          UiStruct.evolve(tally, { kitchenKills: () => kills }),
        ),
        {
          player: player => UiStruct.evolve(player, { calling: () => calling }),
        },
      )
    const isOffered = (model: Model): boolean =>
      Option.isSome(stoveOffer(model))
    const isLocked = (model: Model): boolean =>
      Option.isSome(maybeStoveLock(model, focusSlotOf(model)))
    expect(isOffered(killsOf(STOVE_RULES.kitchenKills - 1, 'You'))).toBe(false)
    expect(isLocked(killsOf(STOVE_RULES.kitchenKills - 1, 'You'))).toBe(true)
    expect(isOffered(killsOf(STOVE_RULES.kitchenKills, 'You'))).toBe(true)
    expect(isLocked(killsOf(STOVE_RULES.kitchenKills, 'You'))).toBe(false)
    expect(isOffered(killsOf(8, 'LineCook'))).toBe(true)
    expect(isOffered(killsOf(7, 'LineCook'))).toBe(false)
    expect(
      Option.map(stoveOffer(killsOf(15, 'You')), ({ price }) => price),
    ).toEqual(Option.some(0))
  })

  it.effect('a wave beginning starts the kitchen kills again', () =>
    modelAfter(
      UiStruct.evolve(atStove(0), {
        phase: () =>
          Phase.Preparation({
            clock: BreakClock.Counting(),
            wave: 5,
            remainingMs: FRAME_MS,
            durationMs: 120_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      steps(
        ticks(3, FRAME_MS),
        checkModel(current => {
          expect(current.phase._tag).toBe('Wave')
          expect(focusOf(current).feats.kitchenKills).toBe(0)
        }),
      ),
    ),
  )

  it.effect(
    'one cook a break: once cooked the stove offers nothing more until the next break',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          offering(atStove(1000), 'Spicy'),
          steps(
            cook,
            checkModel(current => {
              expect(heldPerk(current)).toEqual(Option.some('Spicy'))
              expect(Option.isNone(stoveOffer(current))).toBe(true)
            }),
            cook,
            checkModel(current => {
              expect(focusOf(current).cooking.cooks).toBe(1)
            }),
          ),
        )
        const nextBreak = rollStove(
          withCooking(
            UiStruct.evolve(atStove(1000), { phase: () => kitchenBreak(6) }),
            1,
            5,
          ),
        )
        expect(Option.isSome(stoveOffer(nextBreak))).toBe(true)
      }),
  )

  it.effect(
    'mid-wave the stove cooks too, once a round: a cook in the break leaves nothing in its wave',
    () => {
      const inWave = (base: Model): Model =>
        UiStruct.evolve(base, {
          phase: () =>
            Phase.Wave({ wave: 5, elapsedMs: 5000, spawns: [DISTANT_SPAWN] }),
        })
      return Effect.gen(function* () {
        yield* modelAfter(
          inWave(offering(atStove(500), 'Crispy')),
          steps(
            cook,
            checkModel(current => {
              expect(heldPerk(current)).toEqual(Option.some('Crispy'))
              expect(focusOf(current).cooking).toEqual({
                cooks: 1,
                lastWave: 5,
              })
            }),
          ),
        )
        const cookedInBreak = inWave(
          withCooking(offering(atStove(500), 'Crispy'), 1, 5),
        )
        expect(Option.isNone(stoveOffer(cookedInBreak))).toBe(true)
      })
    },
  )

  it.effect('cooking a gun that has a perk puts the new one in its place', () =>
    modelAfter(
      offering(withArsenalOf(atStove(500), cookedPistol('Hearty')), 'Spicy'),
      steps(
        cook,
        checkModel(current => {
          expect(heldPerk(current)).toEqual(Option.some('Spicy'))
        }),
      ),
    ),
  )
})

describe('what the stove will not cook', () => {
  const knifeOut = modifyFocus(atStove(500), {
    player: player => UiStruct.evolve(player, { wield: () => 'Melee' }),
  })
  const freezeInHand = withArsenalOf(atStove(500), freshGun('Freeze'))

  it.effect.each([
    ['the knife', knifeOut],
    ['a fridge weapon', freezeInHand],
  ] as const)(
    '%s in hand is refused, briefly, and nothing is cooked',
    ([, base]) =>
      modelAfter(
        base,
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(
              Option.map(stoveOffer(current), ({ isFull }) => isFull),
            ).toEqual(Option.some(true))
          }),
          press('Enter'),
          tick(FRAME_MS),
          checkModel(current => {
            expect(
              Purchase.isAnyOf(['Refused'])(focusOf(current).purchase),
            ).toBe(true)
            expect(
              Array.some(
                current.frameEvents,
                GameEvent.isAnyOf(['PurchaseRefused']),
              ),
            ).toBe(true)
          }),
          ticks(COOK_TICKS, FRAME_MS),
          release('Enter'),
          checkModel(current => {
            expect(current.keys.held).toBe(500)
            expect(focusOf(current).cooking.cooks).toBe(0)
            expect(Option.isNone(heldPerk(current))).toBe(true)
          }),
        ),
      ),
  )
})

describe('what each perk does', () => {
  it.effect('Spicy hits 30% harder and glows hot', () =>
    modelAfter(
      withPistolOf(midWave, cookedPistol('Spicy')),
      steps(
        holdFire,
        tick(FRAME_MS),
        checkModel(({ bullets }) => {
          const bullet = Option.getOrThrow(Array.head(bullets))
          expect(bullet.damage).toBeCloseTo(
            PISTOL_DAMAGE * PERK_RULES.spicyDamageScale,
            9,
          )
          expect(bullet.glaze).toBe('Spicy')
        }),
      ),
    ),
  )

  it.effect('Crispy skewers one zombie more', () =>
    modelAfter(
      withPistolOf(midWave, cookedPistol('Crispy')),
      steps(
        holdFire,
        tick(FRAME_MS),
        checkModel(({ bullets }) => {
          const bullet = Option.getOrThrow(Array.head(bullets))
          expect(bullet.pierce).toEqual(
            Pierce.Skewers({ left: PERK_RULES.crispyPierce, struck: [] }),
          )
          expect(bullet.damage).toBe(PISTOL_DAMAGE)
        }),
      ),
    ),
  )

  it.effect(
    'Hearty holds a quarter more, rounded, and a reload fills it',
    () => {
      const hearty = cookedPistol('Hearty')
      const bigger = Math.round(
        PISTOL_MAGAZINE * PERK_RULES.heartyMagazineScale,
      )
      expect(carriedMagazine('You', hearty)).toBe(bigger)
      expect(carriedMagazine('You', freshGun('Pistol'))).toBe(PISTOL_MAGAZINE)
      return modelAfter(
        withPistolOf(midWave, { ...hearty, loaded: 0 }),
        steps(
          press('KeyR'),
          ticksFor(PISTOL_RELOAD_MS + 100, FRAME_MS),
          checkModel(current => {
            expect(heldGun(focusOf(current).player.arsenal).loaded).toBe(bigger)
          }),
        ),
      )
    },
  )

  it.effect(
    'a new gun in its place comes plain: the perk goes with the old gun',
    () => {
      const spicySmg: CarriedGun = { ...freshGun('Smg'), perk: 'Spicy' }
      const crispyPistol = cookedPistol('Crispy')
      const start = fridgeSeededFor(
        modifyFocus(atFridge(500), {
          player: player =>
            UiStruct.evolve(player, {
              arsenal: () =>
                Arsenal.HoldingSecond({
                  first: crispyPistol,
                  second: spicySmg,
                }),
            }),
        }),
        'Cooker',
      )
      const pull = holdEnter(HOLD_TICKS)
      return modelAfter(
        start,
        steps(
          pull,
          ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
          pull,
          checkModel(current => {
            expect(focusOf(current).player.arsenal).toEqual(
              Arsenal.HoldingSecond({
                first: crispyPistol,
                second: freshGun('Cooker'),
              }),
            )
          }),
        ),
      )
    },
  )
})
