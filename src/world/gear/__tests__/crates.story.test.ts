import { Array, Effect, Option, Order } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import {
  type Crate,
  CrateStock,
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  Trap,
  TrapHint,
  type TrapKind,
  type Vector,
} from '../../../app/model'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  breakBefore,
  trapReady,
} from '../../../test/model.fixture'
import {
  BELOW_NORTH_DOOR,
  checkModel,
  modelAfter,
  press,
  steps,
  tick,
  ticks,
} from '../../../test/testing'
import { START_LEVEL } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import { focusOf, modifyFocus } from '../../party/party'
import { crateSpotOf } from '../crates'
import { MEND_RULES, TRAPS } from '../traps'

const FRAME_MS = FIXED_STEP_MS

const readyModel: Model = trapReady

const standingAt = (base: Model, { x, y }: Vector): Model =>
  modifyFocus(base, {
    player: player =>
      UiStruct.evolve(player, {
        x: () => x,
        y: () => y,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

const diningCrate = (trap: TrapKind): Crate => ({
  room: 'Dining',
  stock: CrateStock.Stocked({ trap }),
})

const stockedBreak = (
  wave: number,
  crates: ReadonlyArray<Crate>,
  phase: Phase = breakBefore(wave),
): Model =>
  UiStruct.evolve(readyModel, {
    phase: () => phase,
    crates: current =>
      UiStruct.evolve(current, { wave: () => wave, crates: () => crates }),
  })

const onCrate = (base: Model): Model =>
  standingAt(base, crateSpotOf(START_LEVEL, 'Dining'))

const stocksOf = (current: Model): ReadonlyArray<CrateStock> =>
  Array.map(current.crates.crates, ({ stock }) => stock)

describe('trap crates', () => {
  it.effect(
    'walking onto an open crate takes its trap, and the first one brings up the hint',
    () =>
      modelAfter(
        onCrate(stockedBreak(3, [diningCrate('Turret')])),
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(focusOf(current).trapStock).toEqual({
              Barricade: 0,
              Turret: 1,
            })
            expect(focusOf(current).selectedTrap).toBe('Turret')
            expect(stocksOf(current)).toEqual([CrateStock.Taken()])
            expect(current.trapHint).toEqual(TrapHint.Showing())
            expect(
              Array.filter(current.frameEvents, GameEvent.guards.CrateTaken),
            ).toEqual([
              GameEvent.CrateTaken({
                ...crateSpotOf(START_LEVEL, 'Dining'),
                trap: 'Turret',
              }),
            ])
          }),
          ticks(10, FRAME_MS),
          checkModel(current => {
            expect(focusOf(current).trapStock.Turret).toBe(1)
          }),
        ),
      ),
  )

  it.effect(
    'a find left in the break waits in its wave, and the wave never rolls it again',
    () => {
      const inWave = Phase.Wave({
        wave: 3,
        elapsedMs: 0,
        spawns: [DISTANT_SPAWN],
      })
      return Effect.gen(function* () {
        yield* modelAfter(
          stockedBreak(3, [diningCrate('Barricade')], inWave),
          steps(
            ticks(10, FRAME_MS),
            checkModel(current => {
              expect(current.crates.wave).toBe(3)
              expect(stocksOf(current)).toEqual([
                CrateStock.Stocked({ trap: 'Barricade' }),
              ])
            }),
          ),
        )
        yield* modelAfter(
          onCrate(stockedBreak(3, [diningCrate('Barricade')], inWave)),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(focusOf(current).trapStock.Barricade).toBe(1)
              expect(stocksOf(current)).toEqual([CrateStock.Taken()])
            }),
          ),
        )
      })
    },
  )

  it.effect(
    'a crate still shut from the last round rolls when a wave starts one',
    () =>
      modelAfter(
        stockedBreak(
          3,
          [{ room: 'Dining', stock: CrateStock.Taken() }],
          Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
        ),
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(current.crates.wave).toBe(4)
            expect(
              Array.map(stocksOf(current), ({ _tag }) => _tag),
            ).not.toContain('Taken')
          }),
        ),
      ),
  )

  it.effect(
    'a player with two Plank Piles, placed or carried, leaves a plank crate be',
    () =>
      modelAfter(
        modifyFocus(
          UiStruct.evolve(
            onCrate(stockedBreak(3, [diningCrate('Barricade')])),
            {
              traps: () => [
                Trap.Barricade({
                  id: 1,
                  door: 'West',
                  hp: TRAPS.Barricade.hp,
                  maxHp: TRAPS.Barricade.hp,
                  hitRemainingMs: 0,
                }),
              ],
            },
          ),
          { trapStock: () => ({ Barricade: 1, Turret: 0 }) },
        ),
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(focusOf(current).trapStock.Barricade).toBe(1)
            expect(stocksOf(current)).toEqual([
              CrateStock.Stocked({ trap: 'Barricade' }),
            ])
          }),
        ),
      ),
  )

  it.effect(
    'each break every crate rolls a fresh find, and the kitchen gets its own once open',
    () =>
      modelAfter(
        UiStruct.evolve(readyModel, {
          phase: () => breakBefore(4),
          level: level =>
            UiStruct.evolve(level, { openExits: () => [KITCHEN_EXIT] }),
          crates: current =>
            UiStruct.evolve(current, {
              wave: () => 3,
              crates: () => [{ room: 'Dining', stock: CrateStock.Taken() }],
            }),
        }),
        steps(
          tick(FRAME_MS),
          checkModel(current => {
            expect(current.crates.wave).toBe(4)
            expect(
              Array.map(current.crates.crates, ({ room, stock }) => [
                room,
                stock._tag,
              ]),
            ).toEqual([
              ['Dining', 'Stocked'],
              ['Kitchen', 'Stocked'],
            ])
          }),
        ),
      ),
  )

  it.effect(
    'the finds roll from the crates own stream: both traps turn up across seeds',
    () =>
      Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], seed =>
        modelAfter(
          UiStruct.evolve(readyModel, {
            phase: () => breakBefore(3),
            crates: current =>
              UiStruct.evolve(current, { rngState: () => seed * 104_729 }),
          }),
          tick(FRAME_MS),
        ).pipe(
          Effect.map(current =>
            Array.flatMap(current.crates.crates, ({ stock }) =>
              CrateStock.match(stock, {
                Stocked: ({ trap }) => [trap],
                Heart: () => [],
                Taken: () => [],
              }),
            ),
          ),
        ),
      ).pipe(
        Effect.map(finds => {
          const kinds = Array.dedupe(Array.flatten(finds))
          expect(Array.sort(kinds, Order.String)).toEqual([
            'Barricade',
            'Turret',
          ])
        }),
      ),
  )
})

const restockedFrom = (
  seed: number,
  last: CrateStock,
  change: (base: Model) => Model = base => base,
) =>
  modelAfter(
    change(
      UiStruct.evolve(readyModel, {
        phase: () => breakBefore(4),
        crates: current =>
          UiStruct.evolve(current, {
            wave: () => 3,
            rngState: () => seed * 104_729,
            crates: () => [{ room: 'Dining', stock: last }],
          }),
      }),
    ),
    tick(FRAME_MS),
  ).pipe(Effect.map(stocksOf))

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('what a crate rolls', () => {
  it.effect('a crate still holding a gnome from last break rolls planks', () =>
    Effect.forEach(SEEDS, seed =>
      restockedFrom(seed, CrateStock.Stocked({ trap: 'Turret' })),
    ).pipe(
      Effect.map(rolls => {
        expect(Array.dedupe(Array.flatten(rolls))).toEqual([
          CrateStock.Stocked({ trap: 'Barricade' }),
        ])
      }),
    ),
  )

  it.effect(
    'with both Plank Piles out, a crate rolls a gnome, even one that held a gnome last break',
    () =>
      Effect.forEach(SEEDS, seed =>
        restockedFrom(seed, CrateStock.Stocked({ trap: 'Turret' }), base =>
          modifyFocus(base, {
            trapStock: () => ({ Barricade: TRAPS.Barricade.limit, Turret: 0 }),
          }),
        ),
      ).pipe(
        Effect.map(rolls => {
          expect(Array.dedupe(Array.flatten(rolls))).toEqual([
            CrateStock.Stocked({ trap: 'Turret' }),
          ])
        }),
      ),
  )
})

describe('a heart in a crate', () => {
  const hurt = (base: Model): Model =>
    modifyFocus(base, {
      player: player =>
        UiStruct.evolve(player, { hp: () => PLAYER_MAX_HP - 2 }),
    })

  const glass = (base: Model): Model =>
    UiStruct.evolve(base, {
      modifiers: modifiers => UiStruct.evolve(modifiers, { glass: () => true }),
    })

  const rolledFrom = (start: Model, seeds: ReadonlyArray<number>) =>
    Effect.forEach(seeds, seed =>
      modelAfter(
        UiStruct.evolve(start, {
          phase: () => breakBefore(3),
          crates: current =>
            UiStruct.evolve(current, { rngState: () => seed * 104_729 }),
        }),
        tick(FRAME_MS),
      ).pipe(Effect.map(current => stocksOf(current))),
    )

  it.effect(
    'a crate holds a heart in most breaks while someone is hurt, and never when nobody is',
    () =>
      Effect.gen(function* () {
        const whenHurt = yield* rolledFrom(hurt(readyModel), SEEDS)
        const whenWhole = yield* rolledFrom(readyModel, SEEDS)
        const hearts = Array.filter(
          Array.flatten(whenHurt),
          CrateStock.isAnyOf(['Heart']),
        )
        expect(hearts.length).toBeGreaterThanOrEqual(SEEDS.length / 2)
        expect(
          Array.some(Array.flatten(whenWhole), CrateStock.isAnyOf(['Heart'])),
        ).toBe(false)
      }),
  )

  it.effect('a crate never holds a heart in a Glass run', () =>
    rolledFrom(glass(hurt(readyModel)), SEEDS).pipe(
      Effect.map(stocks => {
        expect(
          Array.some(Array.flatten(stocks), CrateStock.isAnyOf(['Heart'])),
        ).toBe(false)
      }),
    ),
  )

  it.effect('walking onto it heals a hurt player one heart', () =>
    modelAfter(
      hurt(
        onCrate(
          stockedBreak(3, [{ room: 'Dining', stock: CrateStock.Heart() }]),
        ),
      ),
      steps(
        tick(FRAME_MS),
        checkModel(current => {
          expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP - 1)
          expect(stocksOf(current)).toEqual([CrateStock.Taken()])
          expect(
            Array.filter(current.frameEvents, GameEvent.guards.PickupGrabbed),
          ).toEqual([
            GameEvent.PickupGrabbed({
              ...crateSpotOf(START_LEVEL, 'Dining'),
              kind: 'Heart',
            }),
          ])
        }),
      ),
    ),
  )

  it.effect('a player with every heart leaves it for someone hurt', () =>
    modelAfter(
      onCrate(stockedBreak(3, [{ room: 'Dining', stock: CrateStock.Heart() }])),
      steps(
        tick(FRAME_MS),
        checkModel(current => {
          expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
          expect(stocksOf(current)).toEqual([CrateStock.Heart()])
        }),
      ),
    ),
  )
})

describe('mending traps', () => {
  const chewedPlank = (hp: number, phase: Phase = breakBefore(3)): Model =>
    UiStruct.evolve(standingAt(readyModel, BELOW_NORTH_DOOR), {
      phase: () => phase,
      traps: () => [
        Trap.Barricade({
          id: 1,
          door: 'North',
          hp,
          maxHp: TRAPS.Barricade.hp,
          hitRemainingMs: 0,
        }),
      ],
      trapHint: () => TrapHint.Seen(),
    })

  const hpOf = (current: Model): number =>
    Option.match(Array.head(current.traps), {
      onNone: () => 0,
      onSome: ({ hp }) => hp,
    })

  const FULL_MEND_TICKS = Math.ceil(MEND_RULES.fullMs / FRAME_MS)

  it.effect(
    'standing still beside a damaged trap in a break mends it for free',
    () =>
      modelAfter(
        chewedPlank(1),
        steps(
          ticks(Math.floor(FULL_MEND_TICKS / 2), FRAME_MS),
          checkModel(current => {
            expect(hpOf(current)).toBeGreaterThan(TRAPS.Barricade.hp / 3)
            expect(hpOf(current)).toBeLessThan(TRAPS.Barricade.hp)
          }),
          ticks(Math.ceil(FULL_MEND_TICKS / 2) + 1, FRAME_MS),
          checkModel(current => {
            expect(hpOf(current)).toBe(TRAPS.Barricade.hp)
            expect(current.keys).toEqual(readyModel.keys)
          }),
        ),
      ),
  )

  it.effect('the last bit of a mend says so', () =>
    Effect.gen(function* () {
      const events: Array<GameEvent> = []
      yield* modelAfter(
        chewedPlank(TRAPS.Barricade.hp - 1),
        steps(
          ...Array.flatMap(
            Array.makeBy(5, () => 0),
            () => [
              tick(FRAME_MS),
              checkModel((current: Model) => {
                events.push(
                  ...Array.filter(
                    current.frameEvents,
                    GameEvent.guards.TrapMended,
                  ),
                )
              }),
            ],
          ),
        ),
      )
      expect(events).toHaveLength(1)
    }),
  )

  it.effect('in a wave it mends at half the speed of a break', () =>
    modelAfter(
      chewedPlank(
        1,
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      ),
      steps(
        ticks(FULL_MEND_TICKS + 1, FRAME_MS),
        checkModel(current => {
          expect(hpOf(current)).toBeGreaterThan(TRAPS.Barricade.hp / 3)
          expect(hpOf(current)).toBeLessThan(TRAPS.Barricade.hp)
        }),
        ticks(
          Math.ceil(FULL_MEND_TICKS / MEND_RULES.waveScale) - FULL_MEND_TICKS,
          FRAME_MS,
        ),
        checkModel(current => {
          expect(hpOf(current)).toBe(TRAPS.Barricade.hp)
        }),
      ),
    ),
  )

  it.effect('nothing mends while the player moves', () =>
    modelAfter(
      chewedPlank(10),
      steps(
        press('KeyD'),
        ticks(30, FRAME_MS),
        checkModel(current => {
          expect(hpOf(current)).toBe(10)
        }),
      ),
    ),
  )
})

describe("the Handyman's traps", () => {
  const asHandyman = (base: Model): Model =>
    modifyFocus(base, {
      player: player => UiStruct.evolve(player, { calling: () => 'Handyman' }),
    })

  it.effect('a Plank Pile he sets down is half again as sturdy', () =>
    modelAfter(
      modifyFocus(
        asHandyman(
          UiStruct.evolve(standingAt(readyModel, BELOW_NORTH_DOOR), {
            phase: () => breakBefore(3),
            trapHint: () => TrapHint.Showing(),
          }),
        ),
        {
          trapStock: () => ({ Barricade: 1, Turret: 0 }),
          selectedTrap: () => 'Barricade',
        },
      ),
      steps(
        press('KeyT'),
        checkModel(({ traps }) => {
          expect(Array.map(traps, ({ hp, maxHp }) => [hp, maxHp])).toEqual([
            [TRAPS.Barricade.hp * 1.5, TRAPS.Barricade.hp * 1.5],
          ])
        }),
      ),
    ),
  )

  it.effect('he mends twice as fast', () => {
    const chewed = (base: Model): Model =>
      UiStruct.evolve(standingAt(base, BELOW_NORTH_DOOR), {
        phase: () => breakBefore(3),
        traps: () => [
          Trap.Barricade({
            id: 1,
            door: 'North',
            hp: 1,
            maxHp: TRAPS.Barricade.hp,
            hitRemainingMs: 0,
          }),
        ],
        trapHint: () => TrapHint.Seen(),
      })
    const halfMend = Math.ceil(MEND_RULES.fullMs / FRAME_MS / 2) + 1
    const mendedBy = (start: Model) =>
      modelAfter(start, ticks(halfMend, FRAME_MS)).pipe(
        Effect.map(({ traps }) =>
          Array.map(traps, ({ hp, maxHp }) => hp / maxHp),
        ),
      )
    return Effect.gen(function* () {
      const handyman = yield* mendedBy(chewed(asHandyman(readyModel)))
      const you = yield* mendedBy(chewed(readyModel))
      expect(handyman).toEqual([1])
      expect(you[0]).toBeLessThan(0.6)
    })
  })
})
