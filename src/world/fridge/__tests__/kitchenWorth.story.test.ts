import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import {
  type Arsenal,
  BreakClock,
  type Model,
  Pantry,
  type PantryGoodie,
  Phase,
  SOLO_SLOT,
  type Zombie,
} from '../../../app/model'
import { oddsPips } from '../../../features/fridge/fridgeView'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { holdingSecond } from '../../../test/arsenals'
import {
  DISTANT_SPAWN,
  atFridge,
  freshRunModel,
  fridgeSeededFor,
  withSeat,
} from '../../../test/model.fixture'
import {
  FIXED_FRAME,
  FRIDGE_OPEN_TICKS,
  bulletInto,
  checkModel,
  holdToBuy,
  modelAfter,
  playedThrough,
  steps,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { freshGun } from '../../gear/weapons'
import {
  KITCHEN_KEY_SCALE,
  isInKitchenAt,
  kitchenKeyScale,
} from '../../kitchen/kitchenKeys'
import { PANTRY_RULES, maybeStash, pantrySpotOf } from '../../kitchen/pantry'
import { levelOf, openExitIn } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import { focusOf, modifyFocus, seatCrew } from '../../party/party'
import { withWorld } from '../../schema/world'
import { offersOf } from '../../shop/purchase'
import {
  FRIDGE_RULES,
  fridgePriceFor,
  prizeOddsFor,
  pullFridge,
} from '../leftovers'

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
        UiStruct.evolve(player, {
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

  it.effect('a pull costs two keys, and the Dud burps one back', () =>
    modelAfter(
      fridgeSeededFor(atFridge(5), 'Dud'),
      steps(
        checkModel(current => {
          expect(fridgePriceOf(current)).toEqual(Option.some(FRIDGE_RULES.keys))
        }),
        holdToBuy,
        checkModel(current => {
          expect(current.keys.held).toBe(
            5 - FRIDGE_RULES.keys + FRIDGE_RULES.dudRefund,
          )
          expect(current.keys.spent).toBe(FRIDGE_RULES.keys)
        }),
        ticks(FRIDGE_OPEN_TICKS + 2, FRAME_MS),
        checkModel(current => {
          expect(fridgePriceOf(current)).toEqual(Option.some(FRIDGE_RULES.keys))
          const fighting = UiStruct.evolve(current, {
            phase: () =>
              Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
          })
          expect(fridgePriceFor(fighting)).toBe(FRIDGE_RULES.keys)
        }),
      ),
    ),
  )

  test('a pull with too few keys on the ring is refused', () => {
    expect(
      Option.isNone(pullFridge(atFridge(1), SOLO_SLOT, FRIDGE_RULES.keys)),
    ).toBe(true)
  })

  test("in co-op a pull spends the crew's one ring", () => {
    const crew = withWorld(atFridge(4), world => seatCrew(world, 2))
    const pulled = withWorld(crew, world =>
      Option.getOrThrow(pullFridge(world, 1, FRIDGE_RULES.keys)),
    )
    expect(pulled.keys.held).toBeLessThanOrEqual(4 - FRIDGE_RULES.keys + 1)
    expect(fridgePriceFor(pulled)).toBe(FRIDGE_RULES.keys)
  })

  it.effect('the Sandwich heals a heart and gives no key back', () =>
    modelAfter(
      fridgeSeededFor(
        modifyFocus(atFridge(5), {
          player: player => UiStruct.evolve(player, { hp: () => 2 }),
        }),
        'Sandwich',
      ),
      steps(
        holdToBuy,
        checkModel(current => {
          expect(focusOf(current).player.hp).toBe(3)
          expect(current.keys.held).toBe(5 - FRIDGE_RULES.keys)
        }),
      ),
    ),
  )
})

describe('a prize starts fresh in place of the gun it replaces', () => {
  const takeWith = (
    smgTier: number,
    prize: 'Cooker' | 'Freeze',
    expected: Arsenal,
  ) => {
    const smg = UiStruct.evolve(freshGun('Smg'), {
      tier: () => smgTier,
      kills: () => 150,
    })
    return modelAfter(
      fridgeSeededFor(
        modifyFocus(atFridge(100), {
          player: player =>
            UiStruct.evolve(player, { arsenal: () => holdingSecond(smg) }),
        }),
        prize,
      ),
      steps(
        holdToBuy,
        ticks(FRIDGE_OPEN_TICKS, FRAME_MS),
        holdToBuy,
        checkModel(current => {
          expect(focusOf(current).player.arsenal).toEqual(expected)
        }),
      ),
    )
  }

  it.effect(
    'a leveled Chatterbox gives way to a Cooker at tier 0, its kills gone with it',
    () => takeWith(2, 'Cooker', holdingSecond(freshGun('Cooker'))),
  )

  it.effect('Brain Freeze, with no tiers, comes fresh too', () =>
    takeWith(2, 'Freeze', holdingSecond(freshGun('Freeze'))),
  )
})

const PANTRY_SPOT = Option.getOrThrow(pantrySpotOf(levelOf(atFridge(0))))

const atPantry = (current: Model): Model =>
  modifyFocus(current, {
    player: player =>
      UiStruct.evolve(player, {
        x: () => PANTRY_SPOT.x,
        y: () => PANTRY_SPOT.y,
      }),
  })

const afterFrame = (current: Model): Effect.Effect<Model> =>
  playedThrough(current, [FIXED_FRAME])

const stocked = (current: Model, goodie: PantryGoodie): Model =>
  UiStruct.evolve(current, {
    pantry: () => Pantry.Stocked({ round: 5, goodie }),
  })
describe('the pantry stash', () => {
  it.effect(
    'a break with the kitchen open stocks it; a boarded kitchen never does',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          atFridge(0),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(Option.isSome(maybeStash(current))).toBe(true)
            }),
          ),
        )
        yield* modelAfter(
          UiStruct.evolve(atFridge(0), {
            level: () => freshRunModel().level,
          }),
          steps(
            ticks(3, FRAME_MS),
            checkModel(current => {
              expect(Option.isNone(maybeStash(current))).toBe(true)
              expect(current.pantry).toEqual(Pantry.Bare({ round: 0 }))
            }),
          ),
        )
      }),
  )

  it.effect(
    'its goodie is a key or a heart, by the World generator, which it never moves',
    () =>
      Effect.gen(function* () {
        const rolls = yield* Effect.forEach(Array.range(0, 59), index => {
          const start = UiStruct.evolve(atFridge(0), {
            rngState: () => index * 7919,
          })
          return afterFrame(start).pipe(
            Effect.map(next => {
              expect(next.rngState).toBe(start.rngState)
              expect(next.loot).toEqual(start.loot)
              return Option.getOrThrow(maybeStash(next))
            }),
          )
        })
        const goodies = Array.dedupe(Array.map(rolls, ({ goodie }) => goodie))
        expect(goodies).toHaveLength(2)
      }),
  )

  it.effect(
    'walking onto it takes it, once a break, and the next break restocks',
    () =>
      Effect.gen(function* () {
        const taken = yield* modelAfter(
          atPantry(stocked(atFridge(0), 'Key')),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(current.keys.held).toBe(PANTRY_RULES.keys)
              expect(current.pantry).toEqual(Pantry.Bare({ round: 5 }))
              expect(
                Array.some(
                  current.frameEvents,
                  event => event._tag === 'PantryTaken',
                ),
              ).toBe(true)
              expect(
                Array.some(
                  current.frameEvents,
                  event => event._tag === 'KeysFound',
                ),
              ).toBe(true)
            }),
            ticks(30, FRAME_MS),
            checkModel(current => {
              expect(current.keys.held).toBe(PANTRY_RULES.keys)
              expect(Option.isNone(maybeStash(current))).toBe(true)
            }),
          ),
        )
        const nextBreak = UiStruct.evolve(taken, {
          phase: () =>
            Phase.Preparation({
              clock: BreakClock.Counting(),
              wave: 6,
              remainingMs: 60_000,
              durationMs: 60_000,
              spawns: [DISTANT_SPAWN],
            }),
        })
        const restocked = yield* afterFrame(nextBreak)
        expect(restocked.pantry.round).toBe(6)
        expect(
          restocked.keys.held > PANTRY_RULES.keys ||
            focusOf(restocked).player.hp > focusOf(taken).player.hp ||
            Option.isSome(maybeStash(restocked)),
        ).toBe(true)
      }),
  )

  it.effect(
    "in co-op the first to walk on takes it for the crew's ring, once",
    () =>
      Effect.gen(function* () {
        const crew = withWorld(atPantry(stocked(atFridge(0), 'Key')), world =>
          withSeat(seatCrew(world, 2), 1, seat =>
            modifyFocus(seat, {
              player: player =>
                UiStruct.evolve(player, {
                  x: () => PANTRY_SPOT.x + 2,
                  y: () => PANTRY_SPOT.y,
                }),
            }),
          ),
        )
        const next = yield* afterFrame(crew)
        expect(next.keys.held).toBe(PANTRY_RULES.keys)
        expect(next.pantry).toEqual(Pantry.Bare({ round: 5 }))
      }),
  )

  it.effect(
    'a goodie left in the break waits in its wave, and the wave never restocks a taken one',
    () =>
      Effect.gen(function* () {
        const inWave = (current: Model): Model =>
          UiStruct.evolve(current, {
            phase: () =>
              Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
          })
        const taken = yield* afterFrame(
          inWave(atPantry(stocked(atFridge(0), 'Key'))),
        )
        expect(taken.keys.held).toBe(PANTRY_RULES.keys)
        expect(taken.pantry).toEqual(Pantry.Bare({ round: 5 }))
        const bare = yield* afterFrame(
          inWave(
            atPantry(
              UiStruct.evolve(atFridge(0), {
                pantry: () => Pantry.Bare({ round: 5 }),
              }),
            ),
          ),
        )
        expect(bare.keys.held).toBe(0)
        expect(Option.isNone(maybeStash(bare))).toBe(true)
      }),
  )

  it.effect(
    'a heart heals the hurt; at full health, or in Glass, it is a key',
    () =>
      Effect.gen(function* () {
        const hurt = modifyFocus(atPantry(stocked(atFridge(0), 'Heart')), {
          player: player => UiStruct.evolve(player, { hp: () => 2 }),
        })
        const healed = yield* afterFrame(hurt)
        expect(focusOf(healed).player.hp).toBe(3)
        expect(healed.keys.held).toBe(0)
        const whole = yield* afterFrame(atPantry(stocked(atFridge(0), 'Heart')))
        expect(whole.keys.held).toBe(PANTRY_RULES.keys)
        const glass = UiStruct.evolve(hurt, {
          modifiers: modifiers =>
            UiStruct.evolve(modifiers, { glass: () => true }),
        })
        const paid = yield* afterFrame(glass)
        expect(focusOf(paid).player.hp).toBe(2)
        expect(paid.keys.held).toBe(PANTRY_RULES.keys)
      }),
  )
})

describe('kitchen key odds', () => {
  const KITCHEN_SPOT = { x: 35, y: -55 }
  const START_SPOT = { x: 60, y: 85 }

  const shotDown = (
    at: Readonly<{ x: number; y: number }>,
    kind: Zombie['kind'] = 'Shambler',
  ): Model => {
    const victim = zombieOf(kind, 100, at.x, at.y, { hp: 1 })
    return UiStruct.evolve(atFridge(0), {
      phase: () =>
        Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => [victim],
      bullets: () => [bulletInto(500, victim, { knockback: 0 })],
    })
  }

  it.effect(
    'a Big Lug on a kitchen tile drops its two keys and sometimes a third',
    () =>
      modelAfter(
        shotDown(KITCHEN_SPOT, 'Tank'),
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(current.keys.held).toBeGreaterThanOrEqual(2)
            expect(current.keys.held).toBeLessThanOrEqual(3)
            expect(
              Array.some(
                current.cosmetics.popups,
                ({ kind }) => kind === 'Kill',
              ),
            ).toBe(true)
          }),
        ),
      ),
  )

  it.effect('in the dining room a Big Lug drops exactly two', () =>
    modelAfter(
      shotDown(START_SPOT, 'Tank'),
      steps(
        tick(FRAME_MS),
        checkModel(current => {
          expect(current.keys.held).toBe(2)
        }),
      ),
    ),
  )

  test('the kitchen counts only while it is open, and never out in the yard', () => {
    const open = levelOf({
      level: openExitIn(freshRunModel().level, KITCHEN_EXIT),
    })
    const boarded = levelOf(freshRunModel())
    expect(isInKitchenAt(open, KITCHEN_SPOT)).toBe(true)
    expect(isInKitchenAt(boarded, KITCHEN_SPOT)).toBe(false)
    expect(isInKitchenAt(open, { x: 250, y: -55 })).toBe(false)
    expect(isInKitchenAt(open, START_SPOT)).toBe(false)
    expect(kitchenKeyScale(open, KITCHEN_SPOT)).toBe(KITCHEN_KEY_SCALE)
    expect(kitchenKeyScale(open, START_SPOT)).toBe(1)
  })
})
