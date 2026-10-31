import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { MANOR, levelOf, openExitIn, startingLevel } from './arena'
import { cameraFor } from './camera'
import { FIXED_STEP_MS } from './constants'
import { doorCounts, rollSpawns } from './endlessWaves'
import { EXIT_RULES, KITCHEN_EXIT } from './exits'
import { OVEN_RULES, flameBoxOf, ovenBoxesOf } from './kitchen'
import { update } from './main'
import { Message } from './message'
import {
  GameEvent,
  type Model,
  Oven,
  Phase,
  type PlannedSpawn,
  Purchasable,
  Purchase,
  ShopState,
  Stick,
  ZombieAction,
} from './model'
import { DISTANT_SPAWN, freshRunModel, pastTimedBreaks } from './model.fixture'
import { PURCHASE_RULES, holdProgress } from './purchase'
import { freshRun } from './runReset'
import {
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  isKitchenOpen,
  press,
  release,
  tick,
  ticks,
  zombieOf,
} from './testing'
import { JOIN_LEAD_MS, beginPreparation, joinNewDoors } from './waves'

const FRAME_MS = FIXED_STEP_MS
const base: Model = pastTimedBreaks(freshRunModel())

const inBreak = (wave: number, balance: number): Model =>
  modifyFields(base, {
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 15_000,
        durationMs: 20_000,
        spawns: [DISTANT_SPAWN],
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player =>
      modifyFields(player, {
        x: () => BELOW_KITCHEN_DOOR.x,
        y: () => BELOW_KITCHEN_DOOR.y,
      }),
  })

const [, WAVE_FOUR] = rollSpawns(41, 4)

const midWave = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  balance: number,
): Model =>
  modifyFields(inBreak(wave, balance), {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
  })

const waveClockOf = (current: Model): number =>
  Phase.isAnyOf(['Wave'])(current.phase) ? current.phase.elapsedMs : 0

const withKitchen = (current: Model): Model =>
  modifyFields(current, {
    level: level => openExitIn(level, KITCHEN_EXIT),
  })

const fightingInKitchen = (current: Model): Model =>
  modifyFields(withKitchen(current), {
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

const KITCHEN_TARGET = Purchasable.Exit({ exit: KITCHEN_EXIT })

const holdToBuy = [press('Enter'), ...ticks(HOLD_TICKS, FRAME_MS)]

const awayFromDoor = (current: Model): Model =>
  modifyFields(current, {
    player: player => modifyFields(player, { y: () => 120 }),
  })

const eventsOver = (
  start: Model,
  messages: ReadonlyArray<Message>,
): ReadonlyArray<GameEvent> =>
  Array.reduce(
    messages,
    { current: start, events: Array.empty<GameEvent>() },
    ({ current, events }, sent) => {
      const next = update(current, sent).model
      return { current: next, events: [...events, ...next.frameEvents] }
    },
  ).events

describe('holding to buy the kitchen open', () => {
  test('holding Enter at the boards for half a second buys it and smashes it open, with no dialog', () => {
    story(
      update,
      given(inBreak(3, 85)),
      press('Enter'),
      ...ticks(HOLD_TICKS - 4, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(Purchase.isAnyOf(['Holding'])(current.purchase)).toBe(true)
        expect(holdProgress(current.purchase)).toBeGreaterThan(0.8)
        expect(current.shop).toEqual(ShopState.Away())
        expect(current.shopDialog.isOpen).toBe(false)
        expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
      }),
      ...ticks(4, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
        expect(current.wallet.balance).toBe(85 - EXIT_RULES.price)
        expect(current.stats.purchases).toBe(1)
        expect(current.purchase).toEqual(Purchase.Done())
        expect(levelOf(current).doorIds).toEqual([
          'North',
          'West',
          'East',
          'South',
          'Back',
          'Window',
        ])
        expect(
          Array.some(current.particles, ({ kind }) => kind === 'Splinter'),
        ).toBe(true)
        expect(current.shake.trauma).toBeGreaterThan(0)
      }),
      release('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(current.purchase).toEqual(Purchase.Spent())
      }),
    )
  })

  test('the smash and the coins come from the tick that buys it', () => {
    const events = eventsOver(inBreak(3, 85), [
      Message.PressedKey({ code: 'Enter' }),
      ...Array.makeBy(HOLD_TICKS, () =>
        Message.TickedFrame({ deltaTime: FRAME_MS }),
      ),
    ])
    expect(
      Array.filter(events, GameEvent.isAnyOf(['ExitOpened'])),
    ).toHaveLength(1)
    expect(Array.filter(events, GameEvent.isAnyOf(['Purchased']))).toHaveLength(
      1,
    )
  })

  test('letting go and stepping off before the ring fills cancels, and the next hold starts over', () => {
    story(
      update,
      given(inBreak(3, 85)),
      press('Enter'),
      ...ticks(HOLD_TICKS - 6, FRAME_MS),
      press('KeyD'),
      release('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(current.purchase).toEqual(Purchase.Idle())
        expect(isKitchenOpen(current)).toBe(false)
      }),
      release('KeyD'),
      press('Enter'),
      ...ticks(HOLD_TICKS - 6, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(current.wallet.balance).toBe(85)
      }),
    )
  })

  test('walking out of reach cancels the hold', () => {
    story(
      update,
      given(inBreak(3, 85)),
      press('Enter'),
      ...ticks(10, FRAME_MS),
      press('KeyS'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(current.player.y).toBeGreaterThan(BELOW_KITCHEN_DOOR.y + 10)
        expect(Purchase.isAnyOf(['Holding'])(current.purchase)).toBe(false)
        expect(isKitchenOpen(current)).toBe(false)
        expect(current.wallet.balance).toBe(85)
      }),
    )
  })

  test('short of the price, the tag shakes red with the shortfall and nothing is bought', () => {
    const short = inBreak(3, EXIT_RULES.price - 7)
    expect(
      Array.filter(
        eventsOver(short, [
          Message.PressedKey({ code: 'Enter' }),
          Message.TickedFrame({ deltaTime: FRAME_MS }),
        ]),
        GameEvent.isAnyOf(['PurchaseRefused']),
      ),
    ).toHaveLength(1)
    story(
      update,
      given(short),
      press('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(current.purchase).toEqual(
          Purchase.Refused({ target: KITCHEN_TARGET, shortBy: 7, sinceMs: 0 }),
        )
      }),
      ...ticks(HOLD_TICKS * 2, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(current.wallet.balance).toBe(EXIT_RULES.price - 7)
        expect(Purchase.isAnyOf(['Refused'])(current.purchase)).toBe(true)
      }),
      release('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(current.purchase).toEqual(Purchase.Idle())
      }),
    )
  })

  test('at the boards Enter holds to buy, and away from them it starts the wave', () => {
    story(
      update,
      given(inBreak(3, 85)),
      press('Enter'),
      tick(FRAME_MS),
      model(current => {
        expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
      }),
    )
    story(
      update,
      given(awayFromDoor(inBreak(3, 85))),
      press('Enter'),
      model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
      }),
    )
  })

  test('mid-wave the hold buys it while the wave and the zombies keep going', () => {
    const fighting = modifyFields(midWave(4, WAVE_FOUR, 85), {
      zombies: () => [zombieOf('Shambler', 900, 150, 104, { speed: 30 })],
    })
    story(
      update,
      given(fighting),
      ...holdToBuy,
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
        expect(current.wallet.balance).toBe(85 - EXIT_RULES.price)
        expect(waveClockOf(current)).toBeGreaterThan(
          (HOLD_TICKS - 1) * FRAME_MS,
        )
        const shambler = Array.findFirst(
          current.zombies,
          ({ id }) => id === 900,
        )
        expect(
          Option.exists(shambler, ({ x, y }) => x !== 150 || y !== 104),
        ).toBe(true)
        expect(current.shopDialog.isOpen).toBe(false)
      }),
    )
  })

  test('on touch, the hold button buys it and the move stick keeps its finger', () => {
    const touching = modifyFields(inBreak(3, 85), {
      lastDevice: () => 'Touch' as const,
    })
    story(
      update,
      given(touching),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Touch',
          clientX: 100,
          clientY: 300,
        }),
      ),
      message(Message.PressedHoldButton({ pointerId: 2 })),
      ...ticks(HOLD_TICKS, FRAME_MS),
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
        expect(current.wallet.balance).toBe(85 - EXIT_RULES.price)
        expect(Stick.isAnyOf(['Active'])(current.input.moveStick)).toBe(true)
        expect(Stick.isAnyOf(['Idle'])(current.input.aimStick)).toBe(true)
      }),
      message(Message.ReleasedPointer({ pointerId: 2 })),
      tick(FRAME_MS),
      model(current => {
        expect(current.purchase).toEqual(Purchase.Spent())
        expect(Stick.isAnyOf(['Active'])(current.input.moveStick)).toBe(true)
      }),
    )
  })

  test('on touch, lifting the holding finger drops to standing speed, and lifting a stick finger does not cancel', () => {
    const touching = modifyFields(inBreak(3, 85), {
      lastDevice: () => 'Touch' as const,
    })
    story(
      update,
      given(touching),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Touch',
          clientX: 700,
          clientY: 300,
        }),
      ),
      message(Message.PressedHoldButton({ pointerId: 2 })),
      ...ticks(10, FRAME_MS),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(Purchase.isAnyOf(['Holding'])(current.purchase)).toBe(true)
      }),
      message(Message.ReleasedPointer({ pointerId: 2 })),
      tick(FRAME_MS),
      model(current => {
        expect(Purchase.isAnyOf(['Holding'])(current.purchase)).toBe(true)
        expect(holdProgress(current.purchase)).toBeLessThan(
          (13 * FRAME_MS) / PURCHASE_RULES.holdMs,
        )
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
  })

  test('the boards stay shut in the first break and in the waves before the third', () => {
    story(
      update,
      given(inBreak(2, 500)),
      ...holdToBuy,
      model(current => {
        expect(current.purchase).toEqual(Purchase.Idle())
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
    story(
      update,
      given(
        modifyFields(inBreak(2, 500), {
          phase: () =>
            Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
        }),
      ),
      ...holdToBuy,
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
  })

  test('the next run starts with the kitchen boarded and the ovens ready', () => {
    const run = freshRun(fightingInKitchen(base))
    expect(run.level).toEqual(startingLevel)
    expect(Array.every(run.ovens, Oven.guards.Ready)).toBe(true)
    expect(run.ovens).toHaveLength(ovenBoxesOf(MANOR).length)
  })
})

describe('the kitchen in the waves', () => {
  const doorsOf = (
    current: Pick<Model, 'phase'>,
  ): ReadonlyArray<PlannedSpawn> =>
    Phase.isAnyOf(['Preparation', 'Wave'])(current.phase)
      ? current.phase.spawns
      : []

  const isKitchenDoor = ({ door }: PlannedSpawn): boolean =>
    door === 'Back' || door === 'Window'

  test('bought mid-wave, its doors take some of the packs still to come in this wave', () => {
    const fighting = midWave(4, WAVE_FOUR, 500)
    const before = doorsOf(fighting)
    story(
      update,
      given(fighting),
      ...holdToBuy,
      model(current => {
        const after = doorsOf(current)
        const clockMs = waveClockOf(current)
        expect(isKitchenOpen(current)).toBe(true)
        expect(Array.some(after, isKitchenDoor)).toBe(true)
        expect(
          Array.every(after, spawn =>
            Array.some(
              before,
              planned =>
                planned.atMs === spawn.atMs &&
                planned.kind === spawn.kind &&
                planned.pack === spawn.pack &&
                planned.offset === spawn.offset,
            ),
          ),
        ).toBe(true)
        expect(
          Array.every(
            Array.filter(after, ({ atMs }) => atMs < clockMs + JOIN_LEAD_MS),
            spawn => !isKitchenDoor(spawn),
          ),
        ).toBe(true)
      }),
    )
  })

  test('bought in the break, its doors join the wave the markers show', () => {
    const shopping = modifyFields(inBreak(4, 500), {
      phase: () =>
        Phase.Preparation({
          wave: 4,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: WAVE_FOUR,
        }),
    })
    story(
      update,
      given(shopping),
      ...holdToBuy,
      model(current => {
        const after = doorsOf(current)
        expect(after).toHaveLength(WAVE_FOUR.length)
        expect(Array.some(after, isKitchenDoor)).toBe(true)
        expect(
          Array.some(
            doorCounts(after, current.traps, levelOf(current).doorIds),
            ({ door }) => door === 'Back' || door === 'Window',
          ),
        ).toBe(true)
      }),
    )
  })

  test('a pack due soon or already rattled keeps its door, and the rest keep their times', () => {
    const elapsedMs = 6000
    const fightingFrom = (seed: number): Model => {
      const [, spawns] = rollSpawns(seed, 4)
      return withKitchen(
        modifyFields(midWave(4, spawns, 0), {
          phase: () =>
            Phase.Wave({
              wave: 4,
              elapsedMs,
              spawns: Array.filter(spawns, ({ atMs }) => atMs >= elapsedMs),
            }),
          rngState: () => seed,
        }),
      )
    }
    const seeds = Array.makeBy(16, index => index * 31 + 7)
    const moved = Array.flatMap(seeds, seed => {
      const fighting = fightingFrom(seed)
      const free = joinNewDoors(fighting, ['Back', 'Window'])
      expect(Array.map(doorsOf(free), ({ atMs }) => atMs)).toEqual(
        Array.map(doorsOf(fighting), ({ atMs }) => atMs),
      )
      expect(joinNewDoors(fighting, ['Back', 'Window'])).toEqual(free)
      const rattled = modifyFields(fighting, {
        pacing: pacing =>
          modifyFields(pacing, {
            warnedPacks: () => Array.map(doorsOf(fighting), ({ pack }) => pack),
          }),
      })
      expect(doorsOf(joinNewDoors(rattled, ['Back', 'Window']))).toEqual(
        doorsOf(fighting),
      )
      return Array.filter(doorsOf(free), isKitchenDoor)
    })
    expect(moved.length).toBeGreaterThan(0)
    expect(
      Array.every(moved, ({ atMs }) => atMs >= elapsedMs + JOIN_LEAD_MS),
    ).toBe(true)
  })

  test('its doors join the roll once open, and never spawn while it is shut', () => {
    const seeds = Array.makeBy(12, index => index * 97 + 5)
    const kitchenDoors = (doors: ReadonlyArray<string>) =>
      Array.filter(doors, door => door === 'Back' || door === 'Window')
    Array.forEach(seeds, seed => {
      const [, shut] = rollSpawns(seed, 5)
      expect(kitchenDoors(Array.map(shut, ({ door }) => door))).toEqual([])
    })
    const opened = Array.flatMap(seeds, seed =>
      Array.map(
        rollSpawns(seed, 5, levelOf(withKitchen(base)).doorIds)[1],
        ({ door }) => door,
      ),
    )
    expect(kitchenDoors(opened).length).toBeGreaterThan(0)
  })

  test('a wave rolled after the kitchen opens can use its doors', () => {
    const opened = beginPreparation(withKitchen(base), 6, 20_000)
    const doors = Phase.isAnyOf(['Preparation'])(opened.phase)
      ? Array.map(opened.phase.spawns, ({ door }) => door)
      : []
    expect(
      Array.every(doors, door => Array.contains(levelOf(opened).doorIds, door)),
    ).toBe(true)
  })

  test('the camera stays on the parlour until the kitchen opens', () => {
    const atTop = { x: 70, y: 24 }
    expect(cameraFor(levelOf(base), atTop).y).toBe(0)
    expect(cameraFor(levelOf(withKitchen(base)), atTop).y).toBeLessThan(0)
  })
})

describe('ovens', () => {
  const [firstOven] = ovenBoxesOf(MANOR)
  const oven = Option.getOrThrow(Option.fromNullishOr(firstOven))
  const flames = flameBoxOf(oven)
  const victim = zombieOf(
    'Shambler',
    700,
    (flames.left + flames.right) / 2,
    flames.top + 12,
  )

  const shotAtOven = (ovens: ReadonlyArray<Oven>): Model =>
    modifyFields(fightingInKitchen(base), {
      ovens: () => ovens,
      zombies: () => [victim],
      bullets: () => [
        {
          id: 900,
          x: (oven.left + oven.right) / 2,
          y: oven.bottom + 3,
          velocityX: 0,
          velocityY: -300,
          remainingMs: 500,
          weapon: 'Pistol',
          damage: 1,
          knockback: 0,
          glaze: 'Plain',
          pierce: { _tag: 'Stops' },
        },
      ],
      player: player =>
        modifyFields(player, {
          x: () => oven.left - 30,
          y: () => oven.bottom + 30,
        }),
    })

  test('a shot into a ready oven belches fire that burns the zombie in front of it', () => {
    story(
      update,
      given(shotAtOven(Array.map(ovenBoxesOf(MANOR), () => Oven.Ready()))),
      tick(FRAME_MS),
      model(current => {
        expect(
          Array.some(current.frameEvents, GameEvent.guards.OvenBelched),
        ).toBe(true)
        expect(Oven.guards.Belching(current.ovens[0] ?? Oven.Ready())).toBe(
          true,
        )
        expect(
          Array.some(
            current.zombies,
            ({ id, hp }) => id === victim.id && hp < victim.hp,
          ) || !Array.some(current.zombies, ({ id }) => id === victim.id),
        ).toBe(true)
      }),
      ...ticks(Math.ceil(OVEN_RULES.belchMs / FRAME_MS) + 20, FRAME_MS),
      model(current => {
        expect(Oven.guards.Cooling(current.ovens[0] ?? Oven.Ready())).toBe(true)
      }),
    )
  })

  test('a cooling oven only takes the bullet', () => {
    story(
      update,
      given(
        shotAtOven(
          Array.map(ovenBoxesOf(MANOR), () =>
            Oven.Cooling({ remainingMs: OVEN_RULES.cooldownMs }),
          ),
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(
          Array.some(current.frameEvents, GameEvent.guards.OvenBelched),
        ).toBe(false)
        expect(
          Array.findFirst(current.zombies, ({ id }) => id === victim.id).pipe(
            Option.map(({ hp }) => hp),
          ),
        ).toEqual(Option.some(victim.hp))
      }),
    )
  })
})

describe('slippery soup', () => {
  const soupLeft = { x: 34, y: -95 }

  const walkingInto = (kind: 'Shambler' | 'Tank'): Model =>
    modifyFields(fightingInKitchen(base), {
      zombies: () => [
        zombieOf(kind, 800, soupLeft.x, soupLeft.y, { speed: 40 }),
      ],
      player: player => modifyFields(player, { x: () => 110, y: () => -95 }),
    })

  test('a Groaner that steps into the soup slips and lies dazed', () => {
    story(
      update,
      given(walkingInto('Shambler')),
      ...ticks(30, FRAME_MS),
      model(current => {
        expect(
          Array.some(current.zombies, ({ action }) =>
            ZombieAction.guards.Dazed(action),
          ),
        ).toBe(true)
      }),
    )
  })

  test('a Big Lug keeps his feet in it', () => {
    story(
      update,
      given(walkingInto('Tank')),
      ...ticks(40, FRAME_MS),
      model(current => {
        expect(
          Array.some(current.zombies, ({ action }) =>
            ZombieAction.guards.Dazed(action),
          ),
        ).toBe(false)
      }),
    )
  })
})
