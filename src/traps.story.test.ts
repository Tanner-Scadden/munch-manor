import { Array, Option, Result, pipe } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { MANOR, PARLOUR, doorSpawnPoint, isInsideRoomAt } from './arena'
import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  PLAYER_RADIUS,
  PREPARATION_MS,
  TURRET_RANGE_PX,
} from './constants'
import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  ShopState,
  Trap,
  TrapHint,
  TrapNotice,
  TurretGun,
  type Vector,
  type Zombie,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { DISTANT_SPAWN, WAVE_2_FIGHT, pastFirstBreak } from './model.fixture'
import {
  StockTag,
  Verdict,
  itemsIn,
  priceFor,
  repairItemId,
  stockTag,
  verdictFor,
} from './shop'
import { scoreOf } from './stats'
import {
  BELOW_NORTH_DOOR,
  countdownTicks,
  holdFire,
  holdFireToward,
  press,
  release,
  tick,
  ticks,
  zombieOf,
} from './testing'
import { distanceAt, flowFieldToward } from './pathing'
import { TRAPS, repairPrice, stageOf, tollsOf } from './traps'
import { WEAPONS } from './weapons'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

const FRAME_MS = FIXED_STEP_MS
const LONG_FRAME_MS = 50

const PEA_INTERVAL_MS = WEAPONS.Peashooter.fireIntervalMs

const PLANNED_SPAWNS: ReadonlyArray<PlannedSpawn> = [
  { ...DISTANT_SPAWN, atMs: 2000, door: 'West' },
  { ...DISTANT_SPAWN, atMs: 4000, door: 'East', kind: 'Runner' },
]

const ROOM_MIDDLE: Vector = { x: 160, y: 95 }

const readyModel: Model = modifyFields(pastFirstBreak(initialModel), {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const preparing = (spawns: ReadonlyArray<PlannedSpawn> = [DISTANT_SPAWN]) =>
  Phase.Preparation({
    wave: 2,
    remainingMs: 15_000,
    durationMs: PREPARATION_MS,
    spawns,
  })

const withPlayer = (
  base: Model,
  { x, y }: Vector,
  facing: Vector = { x: 1, y: 0 },
): Model =>
  modifyFields(base, {
    player: player =>
      modifyFields(player, {
        x: () => x,
        y: () => y,
        facing: () => facing,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

const stocked = (
  barricades: number,
  turrets: number,
  at: Vector = BELOW_NORTH_DOOR,
  facing: Vector = { x: 1, y: 0 },
): Model =>
  modifyFields(withPlayer(readyModel, at, facing), {
    phase: () => preparing(),
    trapStock: () => ({ Barricade: barricades, Turret: turrets }),
    selectedTrap: () => (barricades > 0 ? 'Barricade' : 'Turret'),
    trapHint: () => TrapHint.Showing(),
  })

const barricade = (
  id: number,
  door: 'North' | 'West' | 'East' | 'South',
  hp = TRAPS.Barricade.hp,
): Trap => Trap.Barricade({ id, door, hp, hitRemainingMs: 0 })

const turret = (
  id: number,
  column: number,
  row: number,
  hp = TRAPS.Turret.hp,
): Trap =>
  Trap.Turret({
    id,
    column,
    row,
    hp,
    hitRemainingMs: 0,
    facing: { x: 1, y: 0 },
    gun: TurretGun.Armed(),
  })

const fightingWith = (
  traps: ReadonlyArray<Trap>,
  zombies: ReadonlyArray<Zombie>,
  playerAt: Vector,
): Model =>
  modifyFields(withPlayer(readyModel, playerAt), {
    phase: () => WAVE_2_FIGHT,
    traps: () => traps,
    zombies: () => zombies,
  })

const recordTicks = (count: number, deltaTime: number, frames: Array<Model>) =>
  Array.flatMap(ticks(count, deltaTime), frame => [
    frame,
    model((current: Model) => {
      frames.push(current)
    }),
  ])

const refusal = (current: Model): Option.Option<string> =>
  TrapNotice.match(current.trapNotice, {
    Quiet: () => Option.none(),
    Refused: ({ reason }) => Option.some(reason),
  })

const eventsOf = (
  frames: ReadonlyArray<Model>,
  isMatch: (event: GameEvent) => boolean,
): ReadonlyArray<GameEvent> =>
  Array.flatMap(frames, ({ frameEvents }) => Array.filter(frameEvents, isMatch))

const firedPeas = (current: Model): ReadonlyArray<GameEvent> =>
  Array.filter(
    current.frameEvents,
    event => GameEvent.guards.Fired(event) && event.weapon === 'Peashooter',
  )

describe('buying traps', () => {
  test('a Plank Pile goes into the trap pack and turns on the first-time hint', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => preparing(),
          shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
          wallet: () => ({ balance: 300, earned: 150, shown: 150 }),
        }),
      ),
      message(Message.ClickedBuyButton({ item: 'Barricade' })),
      model(({ wallet, trapStock, trapHint, selectedTrap }) => {
        expect(wallet.balance).toBe(300 - TRAPS.Barricade.price)
        expect(trapStock).toEqual({ Barricade: 1, Turret: 0 })
        expect(selectedTrap).toBe('Barricade')
        expect(trapHint).toEqual(TrapHint.Showing())
      }),
      message(Message.ClickedBuyButton({ item: 'Turret' })),
      model(({ wallet, trapStock }) => {
        expect(wallet.balance).toBe(
          300 - TRAPS.Barricade.price - TRAPS.Turret.price,
        )
        expect(trapStock).toEqual({ Barricade: 1, Turret: 1 })
      }),
    )
  })

  test('the shop refuses a trap past its limit', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => preparing(),
          shop: () => ShopState.Browsing({ focusedItem: 'Turret' }),
          wallet: () => ({ balance: 500, earned: 500, shown: 500 }),
          traps: () => [turret(1, 5, 5)],
          trapStock: () => ({ Barricade: 0, Turret: 1 }),
        }),
      ),
      message(Message.ClickedBuyButton({ item: 'Turret' })),
      model(({ wallet, trapStock }) => {
        expect(wallet.balance).toBe(500)
        expect(trapStock.Turret).toBe(1)
      }),
    )
  })

  test('the shop stops at two Plank Piles, placed or in the pack', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => preparing(),
          shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
          wallet: () => ({ balance: 500, earned: 500, shown: 500 }),
          traps: () => [barricade(1, 'West')],
          trapStock: () => ({ Barricade: 1, Turret: 0 }),
        }),
      ),
      model(current => {
        expect(verdictFor(current, 'Barricade')).toEqual(
          Verdict.Refused({ reason: 'Two Plank Piles max' }),
        )
      }),
      message(Message.ClickedBuyButton({ item: 'Barricade' })),
      model(({ wallet, trapStock }) => {
        expect(wallet.balance).toBe(500)
        expect(trapStock.Barricade).toBe(1)
      }),
    )
  })
})

describe('placing a barricade', () => {
  test('T boards up the doorway the player stands next to, with a dust puff', () => {
    const start = stocked(1, 0)
    story(
      update,
      given(start),
      press('KeyT'),
      model(({ traps, trapStock, trapHint, nextEntityId, particles }) => {
        expect(traps).toEqual([barricade(start.nextEntityId, 'North')])
        expect(trapStock.Barricade).toBe(0)
        expect(trapHint).toEqual(TrapHint.Seen())
        expect(nextEntityId).toBe(start.nextEntityId + 1)
        expect(
          Array.filter(particles, ({ kind }) => kind === 'Dust').length,
        ).toBeGreaterThan(0)
      }),
    )
  })

  test('the PLACE button boards it up too', () => {
    story(
      update,
      given(stocked(1, 0)),
      message(Message.ClickedPlaceTrapButton()),
      model(({ traps }) => {
        expect(Array.map(traps, trap => trap._tag)).toEqual(['Barricade'])
      }),
    )
  })

  test('a player standing in the doorway is nudged into the room', () => {
    story(
      update,
      given(stocked(1, 0, { x: 5, y: 90 })),
      press('KeyT'),
      model(({ traps, player }) => {
        expect(traps).toHaveLength(1)
        expect(player.x).toBeGreaterThanOrEqual(
          PARLOUR.thresholds.West.box.right + PLAYER_RADIUS,
        )
      }),
      ...ticks(5, FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBeGreaterThanOrEqual(
          PARLOUR.thresholds.West.box.right + PLAYER_RADIUS,
        )
      }),
    )
  })

  test('placement is refused away from a doorway, outside Preparation, and over the limit', () => {
    story(
      update,
      given(stocked(1, 0, ROOM_MIDDLE)),
      press('KeyT'),
      model(current => {
        expect(current.traps).toEqual([])
        expect(current.trapStock.Barricade).toBe(1)
        expect(refusal(current)).toEqual(
          Option.some('Stand in a doorway to board it up'),
        )
      }),
    )

    story(
      update,
      given(modifyFields(stocked(1, 0), { phase: () => WAVE_2_FIGHT })),
      press('KeyT'),
      model(current => {
        expect(current.traps).toEqual([])
        expect(refusal(current)).toEqual(
          Option.some('Traps go down between waves'),
        )
      }),
    )

    story(
      update,
      given(
        modifyFields(stocked(1, 0), {
          traps: () => [barricade(1, 'West'), barricade(2, 'East')],
        }),
      ),
      press('KeyT'),
      model(current => {
        expect(current.traps).toHaveLength(2)
        expect(current.trapStock.Barricade).toBe(1)
        expect(refusal(current)).toEqual(Option.some('Two Plank Piles max'))
      }),
    )

    story(
      update,
      given(
        modifyFields(stocked(1, 0), { traps: () => [barricade(1, 'North')] }),
      ),
      press('KeyT'),
      model(current => {
        expect(current.traps).toHaveLength(1)
        expect(refusal(current)).toEqual(
          Option.some('This doorway is already boarded up'),
        )
      }),
    )
  })

  test('the refusal notice fades after a moment', () => {
    story(
      update,
      given(stocked(1, 0, ROOM_MIDDLE)),
      press('KeyT'),
      ...ticks(40, LONG_FRAME_MS),
      model(current => {
        expect(current.trapNotice).toEqual(TrapNotice.Quiet())
      }),
    )
  })
})

describe('placing a turret', () => {
  test('T sets a Grumpy Gnome on the free tile in front of the player', () => {
    story(
      update,
      given(stocked(0, 1, ROOM_MIDDLE)),
      press('KeyT'),
      model(({ traps, trapStock }) => {
        expect(traps).toHaveLength(1)
        const placed = Option.getOrThrow(Array.head(traps))
        expect(placed._tag).toBe('Turret')
        expect(
          Trap.guards.Turret(placed) && [placed.column, placed.row],
        ).toEqual([17, 9])
        expect(trapStock.Turret).toBe(0)
      }),
    )
  })

  test('placement is refused on walls, doorways, and over the limit, even with free floor nearby', () => {
    const refusedWith = (start: Model, reason: string) =>
      story(
        update,
        given(start),
        press('KeyT'),
        model(current => {
          expect(current.traps).toEqual(start.traps)
          expect(refusal(current)).toEqual(Option.some(reason))
        }),
      )

    refusedWith(
      stocked(0, 1, { x: 165, y: 25 }, { x: 0, y: -1 }),
      'Something is in the way',
    )
    refusedWith(
      stocked(0, 1, { x: 15, y: 90 }, { x: -1, y: 0 }),
      'Doorways are for Plank Piles',
    )
    refusedWith(
      modifyFields(stocked(0, 1, ROOM_MIDDLE), {
        traps: () => [turret(1, 3, 9), turret(2, 25, 9)],
      }),
      'All 2 Grumpy Gnomes are out',
    )
  })

  test('a blocked front tile falls back to the nearest free tile ahead', () => {
    const placedTile = (start: Model) => {
      const placed: Array<readonly [number, number]> = []
      story(
        update,
        given(start),
        press('KeyT'),
        model(({ traps }) => {
          Array.forEach(traps, trap => {
            if (Trap.guards.Turret(trap) && trap.id !== 1) {
              placed.push([trap.column, trap.row])
            }
          })
        }),
      )
      return placed
    }

    expect(
      placedTile(stocked(0, 1, { x: 168, y: 95 }, { x: 1, y: 0 })),
    ).toEqual([[18, 9]])
    expect(
      placedTile(
        modifyFields(stocked(0, 1, ROOM_MIDDLE), {
          traps: () => [turret(1, 17, 9)],
        }),
      ),
    ).toEqual([[16, 8]])
    const besideStall = placedTile(
      stocked(0, 1, { x: 275, y: 135 }, { x: 0, y: 1 }),
    )
    expect(besideStall).toHaveLength(1)
    expect(besideStall).not.toContainEqual([27, 14])
    expect(besideStall).not.toContainEqual([26, 14])
  })

  test('G and the NEXT button switch between the kinds the player owns', () => {
    story(
      update,
      given(stocked(1, 1)),
      press('KeyG'),
      model(({ selectedTrap }) => {
        expect(selectedTrap).toBe('Turret')
      }),
      message(Message.ClickedNextTrapButton()),
      model(({ selectedTrap }) => {
        expect(selectedTrap).toBe('Barricade')
      }),
      press('KeyT'),
      model(({ traps, selectedTrap, trapStock }) => {
        expect(Array.map(traps, trap => trap._tag)).toEqual(['Barricade'])
        expect(trapStock).toEqual({ Barricade: 0, Turret: 1 })
        expect(selectedTrap).toBe('Barricade')
      }),
      press('KeyG'),
      model(({ selectedTrap }) => {
        expect(selectedTrap).toBe('Barricade')
      }),
      release('KeyG'),
      press('KeyS'),
      ...ticks(4, LONG_FRAME_MS),
      release('KeyS'),
      press('KeyT'),
      model(({ traps }) => {
        expect(Array.map(traps, trap => trap._tag)).toEqual([
          'Barricade',
          'Turret',
        ])
      }),
    )
  })

  test('the trap selection stays put outside a round', () => {
    story(
      update,
      given(
        modifyFields(stocked(1, 1), {
          phase: () => Phase.Victory(),
        }),
      ),
      press('KeyG'),
      model(({ selectedTrap }) => {
        expect(selectedTrap).toBe('Barricade')
      }),
      message(Message.ClickedNextTrapButton()),
      model(({ selectedTrap }) => {
        expect(selectedTrap).toBe('Barricade')
      }),
    )
  })
})

describe('barricades and pathing', () => {
  const northSpawn = doorSpawnPoint(PARLOUR, 'North', 0)
  const isNearNorthDoor = ({ x, y }: Vector) =>
    y >= 0 && y < 30 && x > 205 && x < 235

  test('a barricade tolls its doorway in the flow field', () => {
    const start = fightingWith([barricade(1, 'North')], [], ROOM_MIDDLE)
    const tolls = tollsOf(MANOR, start.traps)
    const innerTile = Option.getOrThrow(
      Array.head(MANOR.thresholds.North.indices),
    )
    Array.forEach(['Narrow', 'Wide'] as const, clearance => {
      const bare = flowFieldToward(MANOR, start.player, clearance, [])
      const tolled = flowFieldToward(MANOR, start.player, clearance, tolls)
      expect(distanceAt(tolled.distances, innerTile)).toBeGreaterThan(
        TRAPS.Barricade.pathCost,
      )
      expect(distanceAt(tolled.distances, innerTile)).toBeGreaterThan(
        distanceAt(bare.distances, innerTile),
      )
    })
  })

  test('a zombie at a boarded door walks around to another door when that is shorter', () => {
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [barricade(1, 'North')],
          [zombieOf('Shambler', 50, northSpawn.x, northSpawn.y, { speed: 40 })],
          { x: 230, y: 100 },
        ),
      ),
      ...recordTicks(240, LONG_FRAME_MS, frames),
    )

    const positions = Array.flatMap(frames, ({ zombies }) => zombies)
    expect(Array.some(positions, isNearNorthDoor)).toBe(false)
    expect(
      Array.some(
        positions,
        zombie => isInsideRoomAt(PARLOUR, zombie) && zombie.x > 290,
      ),
    ).toBe(true)
    expect(
      Array.every(frames, ({ traps }) =>
        Array.every(traps, trap => trap.hp === TRAPS.Barricade.hp),
      ),
    ).toBe(true)
  })

  test('a zombie chews through a barricade when it is the only way in', () => {
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [
            barricade(1, 'North'),
            barricade(2, 'West'),
            barricade(3, 'East'),
            barricade(4, 'South'),
          ],
          [zombieOf('Shambler', 50, northSpawn.x, northSpawn.y, { speed: 40 })],
          ROOM_MIDDLE,
        ),
      ),
      ...recordTicks(520, LONG_FRAME_MS, frames),
    )

    expect(
      Array.some(frames, ({ traps }) =>
        Array.some(
          traps,
          trap => trap._tag === 'Barricade' && trap.hp < TRAPS.Barricade.hp,
        ),
      ),
    ).toBe(true)
    expect(eventsOf(frames, GameEvent.guards.TrapBroken)).toHaveLength(1)
    const last = Option.getOrThrow(Array.last(frames))
    expect(last.traps).toHaveLength(3)
    expect(
      Array.some(last.zombies, zombie => zombie.y > 40 && zombie.y < 170),
    ).toBe(true)
  })

  test('a zombie chews through a barricade when going around is much longer', () => {
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [barricade(1, 'North')],
          [zombieOf('Shambler', 50, northSpawn.x, northSpawn.y, { speed: 40 })],
          { x: 220, y: 32 },
        ),
      ),
      ...recordTicks(60, LONG_FRAME_MS, frames),
    )

    const last = Option.getOrThrow(Array.last(frames))
    expect(Array.some(last.traps, trap => trap.hp < TRAPS.Barricade.hp)).toBe(
      true,
    )
    expect(Array.every(last.zombies, isNearNorthDoor)).toBe(true)
  })
})

describe('barricade damage', () => {
  const pressedAgainstNorth: Vector = { x: 220, y: 5 }

  test('a Groaner chews it through three stages, with splinters, and it breaks with a crash', () => {
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [barricade(1, 'North')],
          [
            zombieOf(
              'Shambler',
              50,
              pressedAgainstNorth.x,
              pressedAgainstNorth.y,
              { speed: 30 },
            ),
          ],
          { x: 220, y: 40 },
        ),
      ),
      ...recordTicks(500, LONG_FRAME_MS, frames),
    )

    const hps = Array.filterMap(frames, ({ traps }) =>
      Option.match(Array.head(traps), {
        onNone: () => Result.failVoid,
        onSome: trap => Result.succeed(trap.hp),
      }),
    )
    expect(
      Array.every(
        Array.zip(hps, Array.drop(hps, 1)),
        ([before, after]) => after <= before,
      ),
    ).toBe(true)
    expect(
      Array.dedupe(Array.map(hps, hp => stageOf('Barricade', hp))),
    ).toEqual(['Sturdy', 'Cracked', 'Splintered'])
    expect(eventsOf(frames, GameEvent.guards.TrapCracked)).toHaveLength(2)
    expect(
      eventsOf(frames, GameEvent.guards.TrapHit).length,
    ).toBeGreaterThanOrEqual(TRAPS.Barricade.hp - 1)
    expect(eventsOf(frames, GameEvent.guards.TrapBroken)).toEqual([
      GameEvent.TrapBroken({ x: 220, y: 15, kind: 'Barricade' }),
    ])
    expect(
      Array.some(frames, ({ particles }) =>
        Array.some(particles, ({ kind }) => kind === 'Plank'),
      ),
    ).toBe(true)
    const brokenAt = Option.getOrThrow(
      Array.findFirstIndex(frames, ({ traps }) =>
        Array.isReadonlyArrayEmpty(traps),
      ),
    )
    const secondsToBreak = (brokenAt + 1) * (LONG_FRAME_MS / 1000)
    expect(secondsToBreak).toBeCloseTo(
      TRAPS.Barricade.hp / ZOMBIE_KINDS.Shambler.trapBitePerSecond,
      0,
    )
  })

  test('a Big Lug hits it much harder than a Groaner', () => {
    const chewedAfterOneSecond = (kind: ZombieKind): number => {
      const frames: Array<Model> = []
      story(
        update,
        given(
          fightingWith(
            [barricade(1, 'North')],
            [zombieOf(kind, 50, 220, 2, { speed: 20 })],
            { x: 220, y: 40 },
          ),
        ),
        ...recordTicks(20, LONG_FRAME_MS, frames),
      )
      return pipe(
        Array.last(frames),
        Option.flatMap(({ traps }) => Array.head(traps)),
        Option.match({
          onNone: () => TRAPS.Barricade.hp,
          onSome: trap => TRAPS.Barricade.hp - trap.hp,
        }),
      )
    }

    expect(chewedAfterOneSecond('Tank')).toBeCloseTo(
      ZOMBIE_KINDS.Tank.trapBitePerSecond,
      0,
    )
    expect(chewedAfterOneSecond('Tank')).toBeGreaterThan(
      chewedAfterOneSecond('Shambler') * 3,
    )
  })

  test('the player cannot walk through a barricade but bullets fly through it', () => {
    story(
      update,
      given(
        modifyFields(
          fightingWith([barricade(1, 'West')], [], { x: 20, y: 90 }),
          {
            player: player =>
              modifyFields(player, { facing: () => ({ x: -1, y: 0 }) }),
          },
        ),
      ),
      press('KeyA'),
      holdFireToward({ x: -1, y: 0 }),
      ...ticks(Math.ceil(FIRE_INTERVAL_MS / FRAME_MS) + 2, FRAME_MS),
      model(({ player, frameEvents, bullets }) => {
        expect(player.x).toBeCloseTo(
          PARLOUR.thresholds.West.box.right + PLAYER_RADIUS,
          1,
        )
        expect(frameEvents).not.toContainEqual(
          expect.objectContaining({ _tag: 'BulletStruck' }),
        )
        expect(
          Array.some(bullets, ({ x }) => x < PARLOUR.thresholds.West.box.right),
        ).toBe(true)
      }),
    )
  })
})

describe('bursts and traps', () => {
  test('a Kaboomer burst damages a barricade and a gnome in reach, but not one out of it', () => {
    const blast = {
      ...zombieOf('Exploder', 60, 222, 25),
      hp: 0,
      state: ZombieState.Fusing({ remainingMs: 0 }),
    }
    const burstDamage = 15
    story(
      update,
      given(
        fightingWith(
          [barricade(1, 'North'), turret(2, 22, 3), turret(3, 5, 14)],
          [blast],
          ROOM_MIDDLE,
        ),
      ),
      tick(FRAME_MS),
      model(({ traps, frameEvents }) => {
        expect(Array.map(traps, ({ id, hp }) => [id, hp])).toEqual([
          [1, TRAPS.Barricade.hp - burstDamage],
          [2, TRAPS.Turret.hp - burstDamage],
          [3, TRAPS.Turret.hp],
        ])
        expect(Array.filter(frameEvents, GameEvent.guards.TrapBroken)).toEqual(
          [],
        )
      }),
    )
  })

  test('a Kaboomer that walks into a barricade fuses and blows it apart', () => {
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [barricade(1, 'North', 10)],
          [zombieOf('Exploder', 60, 220, 1, { speed: 20 })],
          { x: 220, y: 60 },
        ),
      ),
      ...recordTicks(60, FRAME_MS, frames),
    )

    expect(eventsOf(frames, GameEvent.guards.Exploded)).toHaveLength(1)
    expect(eventsOf(frames, GameEvent.guards.TrapBroken)).toHaveLength(1)
  })
})

describe('turrets', () => {
  const TURRET_TILE = { column: 16, row: 9 }
  const turretCenter = { x: 165, y: 95 }
  const tough = (id: number, at: Vector) =>
    zombieOf('Shambler', id, at.x, at.y, { speed: 0, hp: 999 })

  test('fires at the nearest zombie in range, then waits out its cooldown', () => {
    const far = tough(70, { x: 205, y: 95 })
    const near = tough(71, { x: 140, y: 95 })
    const cooldownTicks = countdownTicks(PEA_INTERVAL_MS)
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
          [far, near],
          { x: 40, y: 160 },
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        const shots = firedPeas(current)
        expect(shots).toHaveLength(1)
        const shot = Option.getOrThrow(Array.head(shots))
        expect(GameEvent.guards.Fired(shot) && shot.direction.x).toBeCloseTo(-1)
        const placed = Option.getOrThrow(Array.head(current.traps))
        expect(Trap.guards.Turret(placed) && placed.gun).toEqual(
          TurretGun.CoolingDown({ remainingMs: PEA_INTERVAL_MS }),
        )
        expect(
          Array.filter(
            current.bullets,
            ({ weapon }) => weapon === 'Peashooter',
          ),
        ).toHaveLength(1)
      }),
      ...recordTicks(cooldownTicks + 1, FRAME_MS, frames),
    )

    const shotFrames = Array.filterMap(frames, (frame, index) =>
      Array.isReadonlyArrayNonEmpty(firedPeas(frame))
        ? Result.succeed(index + 1)
        : Result.failVoid,
    )
    expect(shotFrames).toEqual([cooldownTicks])
  })

  test('does not shoot through cover or past its range', () => {
    const hidden = tough(72, { x: 165, y: 100 })
    const visible = tough(73, { x: 230, y: 145 })
    const behindCouch = [turret(1, 16, 14)]

    story(
      update,
      given(fightingWith(behindCouch, [hidden, visible], { x: 40, y: 160 })),
      tick(FRAME_MS),
      model(current => {
        const shot = Option.getOrThrow(Array.head(firedPeas(current)))
        expect(
          GameEvent.guards.Fired(shot) && shot.direction.x,
        ).toBeGreaterThan(0.9)
      }),
    )

    story(
      update,
      given(fightingWith(behindCouch, [hidden], { x: 40, y: 160 })),
      ...ticks(10, FRAME_MS),
      model(current => {
        expect(firedPeas(current)).toEqual([])
        expect(current.bullets).toEqual([])
      }),
    )

    story(
      update,
      given(
        fightingWith(
          [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
          [tough(74, { x: turretCenter.x + TURRET_RANGE_PX + 6, y: 95 })],
          { x: 40, y: 160 },
        ),
      ),
      ...ticks(10, FRAME_MS),
      model(current => {
        expect(current.bullets).toEqual([])
      }),
    )
  })

  test('its peas kill zombies and pay their bounty', () => {
    story(
      update,
      given(
        fightingWith(
          [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
          [zombieOf('Runner', 75, 200, 95)],
          { x: 40, y: 160 },
        ),
      ),
      ...ticks(Math.ceil((2 * PEA_INTERVAL_MS + 500) / FRAME_MS), FRAME_MS),
      model(({ wallet, zombies }) => {
        expect(wallet.balance).toBe(ZOMBIE_KINDS.Runner.bounty)
        expect(
          Array.every(
            Array.filter(zombies, ({ id }) => id === 75),
            ({ hp }) => hp <= 0,
          ),
        ).toBe(true)
      }),
    )
  })

  test('zombies next to a turret chew it and it breaks with a pop', () => {
    const frames: Array<Model> = []
    story(
      update,
      given(
        fightingWith(
          [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
          [zombieOf('Tank', 76, 165, 107, { speed: 20 })],
          { x: 165, y: 70 },
        ),
      ),
      ...recordTicks(60, LONG_FRAME_MS, frames),
    )

    expect(eventsOf(frames, GameEvent.guards.TrapBroken)).toEqual([
      GameEvent.TrapBroken({ x: 165, y: 95, kind: 'Turret' }),
    ])
    expect(Option.getOrThrow(Array.last(frames)).traps).toEqual([])
  })
})

describe('between waves', () => {
  const damagedTraps = [
    barricade(1, 'North', TRAPS.Barricade.hp / 2),
    turret(2, 10, 10, TRAPS.Turret.hp / 2),
  ]

  test('traps stay where they were and keep their damage into the next wave', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          traps: () => damagedTraps,
        }),
      ),
      tick(FRAME_MS),
      model(({ phase, traps }) => {
        expect(Phase.guards.Preparation(phase) && phase.wave).toBe(3)
        expect(Array.map(traps, ({ id, hp, _tag }) => [id, _tag, hp])).toEqual([
          [1, 'Barricade', TRAPS.Barricade.hp / 2],
          [2, 'Turret', TRAPS.Turret.hp / 2],
        ])
      }),
    )
  })

  test('each placed trap repairs on its own, priced by its own missing health', () => {
    const plankPrice = Math.ceil(0.5 * TRAPS.Barricade.price * 0.5)
    const gnomePrice = Math.ceil(0.5 * TRAPS.Turret.price * 0.5)
    const shopping = modifyFields(readyModel, {
      phase: () => preparing(),
      shop: () => ShopState.Browsing({ focusedItem: repairItemId(1) }),
      wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
      traps: () => damagedTraps,
    })
    expect(plankPrice).toBe(24)
    expect(priceFor(shopping, repairItemId(1))).toBe(plankPrice)
    expect(priceFor(shopping, repairItemId(2))).toBe(gnomePrice)
    expect(repairPrice([damagedTraps[0]!])).toBe(plankPrice)
    expect(itemsIn(shopping, 'Traps')).toEqual([
      'Barricade',
      repairItemId(1),
      'Turret',
      repairItemId(2),
    ])

    story(
      update,
      given(shopping),
      message(Message.ClickedBuyButton({ item: repairItemId(1) })),
      model(current => {
        expect(current.wallet.balance).toBe(100 - plankPrice)
        expect(Array.map(current.traps, ({ hp }) => hp)).toEqual([
          TRAPS.Barricade.hp,
          TRAPS.Turret.hp / 2,
        ])
        expect(stockTag(current, repairItemId(1))).toEqual(
          StockTag.Done({ label: 'FULL' }),
        )
        expect(stockTag(current, repairItemId(2))).toEqual(
          StockTag.Price({ price: gnomePrice }),
        )
      }),
      message(Message.ClickedBuyButton({ item: repairItemId(1) })),
      model(({ wallet }) => {
        expect(wallet.balance).toBe(100 - plankPrice)
      }),
      message(Message.ClickedBuyButton({ item: repairItemId(2) })),
      model(({ wallet, traps }) => {
        expect(wallet.balance).toBe(100 - plankPrice - gnomePrice)
        expect(Array.map(traps, ({ hp }) => hp)).toEqual([
          TRAPS.Barricade.hp,
          TRAPS.Turret.hp,
        ])
      }),
    )
  })

  test('a new run clears every trap and the trap pack', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 4 }),
          screenMs: () => RESTART_GRACE_MS,
          traps: () => damagedTraps,
          trapStock: () => ({ Barricade: 2, Turret: 1 }),
          selectedTrap: () => 'Turret',
        }),
      ),
      press('Enter'),
      model(({ phase, traps, trapStock, selectedTrap }) => {
        expect(Phase.guards.Preparation(phase) && phase.wave).toBe(1)
        expect(traps).toEqual([])
        expect(trapStock).toEqual({ Barricade: 0, Turret: 0 })
        expect(selectedTrap).toBe('Barricade')
      }),
    )
  })
})

describe('trap determinism', () => {
  const playWithTraps = (seed: number): Model => {
    const sessions: Array<Model> = []
    story(
      update,
      given(
        modifyFields(stocked(1, 1), {
          rngState: () => seed,
          phase: () => preparing(PLANNED_SPAWNS),
          introducedKinds: () => ZOMBIE_KIND_ORDER,
        }),
      ),
      press('KeyT'),
      model(({ phase }) => {
        expect(phase).toEqual(preparing(PLANNED_SPAWNS))
      }),
      press('KeyS'),
      ...ticks(30, FRAME_MS),
      release('KeyS'),
      press('KeyT'),
      press('Enter'),
      holdFire,
      ...ticks(400, FRAME_MS),
      model(finalModel => {
        sessions.push(finalModel)
      }),
    )
    return Option.getOrThrow(Array.head(sessions))
  }

  test('a wave with traps replays identically from the same seed', () => {
    const first = playWithTraps(4321)
    expect(first.traps).toHaveLength(2)
    expect(scoreOf(first.stats)).toBeGreaterThan(0)
    expect(playWithTraps(4321)).toEqual(first)
    expect(playWithTraps(8765)).not.toEqual(first)
  })
})
