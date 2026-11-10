import { Array, Effect, Option, Order } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  breakBefore,
  trapReady,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_NORTH_DOOR,
  press,
  tick,
  ticks,
} from '../../../test/testing'
import { KITCHEN_EXIT } from '../../level/exits'
import { focusOf, modifyFocus } from '../../party/party'
import { crateSpotOf } from '../crates'
import { MEND_RULES, TRAPS } from '../traps'

// Traps found in the house (docs/ESCAPE_PLAN.md, layer 6): the trap crates
// (src/world/gear/crates.ts) and free mending in a break
// (src/world/gear/traps.ts).

const FRAME_MS = FIXED_STEP_MS

const readyModel: Model = trapReady

const standingAt = (base: Model, { x, y }: Vector): Model =>
  modifyFocus(base, {
    player: player =>
      modifyFields(player, {
        x: () => x,
        y: () => y,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

const parlourCrate = (trap: TrapKind): Crate => ({
  room: 'Parlour',
  stock: CrateStock.Stocked({ trap }),
})

// NOTE: a break before `wave` whose crates were already stocked for it, so
// the tick takes from them and never rolls them again.
const stockedBreak = (
  wave: number,
  crates: ReadonlyArray<Crate>,
  phase: Phase = breakBefore(wave),
): Model =>
  modifyFields(readyModel, {
    phase: () => phase,
    crates: current =>
      modifyFields(current, { wave: () => wave, crates: () => crates }),
  })

const onCrate = (base: Model): Model => standingAt(base, crateSpotOf('Parlour'))

const stocksOf = (current: Model): ReadonlyArray<CrateStock> =>
  Array.map(current.crates.crates, ({ stock }) => stock)

describe('trap crates', () => {
  it.effect(
    'walking onto an open crate takes its trap, and the first one brings up the hint',
    () =>
      Story.story(
        APPLICATION,
        Story.given(onCrate(stockedBreak(3, [parlourCrate('Turret')]))),
        tick(FRAME_MS),
        Story.model(current => {
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
              ...crateSpotOf('Parlour'),
              trap: 'Turret',
            }),
          ])
        }),
        ...ticks(10, FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).trapStock.Turret).toBe(1)
        }),
      ),
  )

  it.effect('a crate stays shut through a wave', () =>
    Story.story(
      APPLICATION,
      Story.given(
        onCrate(
          stockedBreak(
            3,
            [parlourCrate('Barricade')],
            Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
          ),
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).trapStock.Barricade).toBe(0)
        expect(stocksOf(current)).toEqual([
          CrateStock.Stocked({ trap: 'Barricade' }),
        ])
      }),
    ),
  )

  it.effect(
    'a player with two Plank Piles, placed or carried, leaves a plank crate be',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(
            modifyFields(
              onCrate(stockedBreak(3, [parlourCrate('Barricade')])),
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
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).trapStock.Barricade).toBe(1)
          expect(stocksOf(current)).toEqual([
            CrateStock.Stocked({ trap: 'Barricade' }),
          ])
        }),
      ),
  )

  it.effect(
    'each break every crate rolls a fresh find, and the kitchen gets its own once open',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(readyModel, {
            phase: () => breakBefore(4),
            level: level =>
              modifyFields(level, { openExits: () => [KITCHEN_EXIT] }),
            crates: current =>
              modifyFields(current, {
                wave: () => 3,
                crates: () => [{ room: 'Parlour', stock: CrateStock.Taken() }],
              }),
          }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(current.crates.wave).toBe(4)
          expect(
            Array.map(current.crates.crates, ({ room, stock }) => [
              room,
              stock._tag,
            ]),
          ).toEqual([
            ['Parlour', 'Stocked'],
            ['Kitchen', 'Stocked'],
          ])
        }),
      ),
  )

  it.effect(
    'the finds roll from the crates own stream: both traps turn up across seeds',
    () =>
      Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], seed =>
        Story.story(
          APPLICATION,
          Story.given(
            modifyFields(readyModel, {
              phase: () => breakBefore(3),
              crates: current =>
                modifyFields(current, { rngState: () => seed * 104_729 }),
            }),
          ),
          tick(FRAME_MS),
        ).pipe(
          Effect.map(current =>
            Array.flatMap(current.crates.crates, ({ stock }) =>
              CrateStock.match(stock, {
                Stocked: ({ trap }) => [trap],
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

describe('mending traps', () => {
  // NOTE: a Plank Pile across the north door, chewed down to `hp`, and the
  // player standing still just below it.
  const chewedPlank = (hp: number, phase: Phase = breakBefore(3)): Model =>
    modifyFields(standingAt(readyModel, BELOW_NORTH_DOOR), {
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
      Story.story(
        APPLICATION,
        Story.given(chewedPlank(1)),
        ...ticks(Math.floor(FULL_MEND_TICKS / 2), FRAME_MS),
        Story.model(current => {
          expect(hpOf(current)).toBeGreaterThan(TRAPS.Barricade.hp / 3)
          expect(hpOf(current)).toBeLessThan(TRAPS.Barricade.hp)
        }),
        ...ticks(Math.ceil(FULL_MEND_TICKS / 2) + 1, FRAME_MS),
        Story.model(current => {
          expect(hpOf(current)).toBe(TRAPS.Barricade.hp)
          expect(focusOf(current).wallet).toEqual(focusOf(readyModel).wallet)
        }),
      ),
  )

  it.effect('the last bit of a mend says so', () =>
    Effect.gen(function* () {
      const events: Array<GameEvent> = []
      yield* Story.story(
        APPLICATION,
        Story.given(chewedPlank(TRAPS.Barricade.hp - 1)),
        ...Array.flatMap(
          Array.makeBy(5, () => 0),
          () => [
            tick(FRAME_MS),
            Story.model((current: Model) => {
              events.push(
                ...Array.filter(
                  current.frameEvents,
                  GameEvent.guards.TrapMended,
                ),
              )
            }),
          ],
        ),
      )
      expect(events).toHaveLength(1)
    }),
  )

  it.effect('nothing mends in a wave, or while the player moves', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(
          chewedPlank(
            10,
            Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
          ),
        ),
        ...ticks(30, FRAME_MS),
        Story.model(current => {
          expect(hpOf(current)).toBe(10)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(chewedPlank(10)),
        press('KeyD'),
        ...ticks(30, FRAME_MS),
        Story.model(current => {
          expect(hpOf(current)).toBe(10)
        }),
      )
    }),
  )
})

describe("the Handyman's traps", () => {
  const asHandyman = (base: Model): Model =>
    modifyFocus(base, {
      player: player => modifyFields(player, { calling: () => 'Handyman' }),
    })

  it.effect('a Plank Pile he sets down is half again as sturdy', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          asHandyman(
            modifyFields(standingAt(readyModel, BELOW_NORTH_DOOR), {
              phase: () => breakBefore(3),
              trapHint: () => TrapHint.Showing(),
            }),
          ),
          {
            trapStock: () => ({ Barricade: 1, Turret: 0 }),
            selectedTrap: () => 'Barricade',
          },
        ),
      ),
      press('KeyT'),
      Story.model(({ traps }) => {
        expect(Array.map(traps, ({ hp, maxHp }) => [hp, maxHp])).toEqual([
          [TRAPS.Barricade.hp * 1.5, TRAPS.Barricade.hp * 1.5],
        ])
      }),
    ),
  )

  it.effect('he mends twice as fast', () => {
    const chewed = (base: Model): Model =>
      modifyFields(standingAt(base, BELOW_NORTH_DOOR), {
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
      Story.story(
        APPLICATION,
        Story.given(start),
        ...ticks(halfMend, FRAME_MS),
      ).pipe(
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
