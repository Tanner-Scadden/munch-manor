import { Array, Effect, Option, Result } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
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
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  PLAYER_RADIUS,
  PREPARATION_MS,
  RESTART_GRACE_MS,
  TURRET_RANGE_PX,
} from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  WAVE_2_FIGHT,
  pastFirstBreak,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_NORTH_DOOR,
  buyAtCounter,
  countdownTicks,
  holdFire,
  holdFireToward,
  press,
  recordTicks,
  release,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import {
  MANOR,
  PARLOUR,
  doorSpawnPoint,
  isInsideRoomAt,
} from '../../level/arena'
import { distanceAt, flowFieldToward } from '../../level/pathing'
import { focusOf, focusSlotOf, modifyFocus } from '../../party/party'
import { scoreOf } from '../../run/stats'
import {
  StockTag,
  Verdict,
  itemsIn,
  priceFor,
  repairItemId,
  stockTag,
  verdictFor,
} from '../../shop/shop'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from '../../zombies/zombies'
import { TRAPS, repairPrice, stageOf, tollsOf } from '../traps'
import { WEAPONS } from '../weapons'

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
  modifyFocus(base, {
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
  modifyFocus(
    modifyFields(withPlayer(readyModel, at, facing), {
      phase: () => preparing(),
      trapHint: () => TrapHint.Showing(),
    }),
    {
      trapStock: () => ({ Barricade: barricades, Turret: turrets }),
      selectedTrap: () => (barricades > 0 ? 'Barricade' : 'Turret'),
    },
  )

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
  it.effect(
    'a Plank Pile goes into the trap pack and turns on the first-time hint',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(modifyFields(readyModel, { phase: () => preparing() }), {
            shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
            wallet: () => ({ balance: 300, earned: 150, shown: 150 }),
          }),
        ),
        buyAtCounter('Barricade'),
        Story.model(
          ({ seats: [{ wallet, trapStock, selectedTrap }], trapHint }) => {
            expect(wallet.balance).toBe(300 - TRAPS.Barricade.price)
            expect(trapStock).toEqual({ Barricade: 1, Turret: 0 })
            expect(selectedTrap).toBe('Barricade')
            expect(trapHint).toEqual(TrapHint.Showing())
          },
        ),
        buyAtCounter('Turret'),
        Story.model(({ seats: [{ wallet, trapStock }] }) => {
          expect(wallet.balance).toBe(
            300 - TRAPS.Barricade.price - TRAPS.Turret.price,
          )
          expect(trapStock).toEqual({ Barricade: 1, Turret: 1 })
        }),
      ),
  )

  it.effect('the shop refuses a trap past its limit', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(readyModel, {
            phase: () => preparing(),
            traps: () => [turret(1, 5, 5)],
          }),
          {
            shop: () => ShopState.Browsing({ focusedItem: 'Turret' }),
            wallet: () => ({ balance: 500, earned: 500, shown: 500 }),
            trapStock: () => ({ Barricade: 0, Turret: 1 }),
          },
        ),
      ),
      buyAtCounter('Turret'),
      Story.model(({ seats: [{ wallet, trapStock }] }) => {
        expect(wallet.balance).toBe(500)
        expect(trapStock.Turret).toBe(1)
      }),
    ),
  )

  it.effect('the shop stops at two Plank Piles, placed or in the pack', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(readyModel, {
            phase: () => preparing(),
            traps: () => [barricade(1, 'West')],
          }),
          {
            shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
            wallet: () => ({ balance: 500, earned: 500, shown: 500 }),
            trapStock: () => ({ Barricade: 1, Turret: 0 }),
          },
        ),
      ),
      Story.model(current => {
        expect(verdictFor(current, focusSlotOf(current), 'Barricade')).toEqual(
          Verdict.Refused({ reason: 'Two Plank Piles max' }),
        )
      }),
      buyAtCounter('Barricade'),
      Story.model(({ seats: [{ wallet, trapStock }] }) => {
        expect(wallet.balance).toBe(500)
        expect(trapStock.Barricade).toBe(1)
      }),
    ),
  )
})

describe('placing a barricade', () => {
  it.effect(
    'T boards up the doorway the player stands next to, with a dust puff',
    () => {
      const start = stocked(1, 0)
      return Story.story(
        APPLICATION,
        Story.given(start),
        press('KeyT'),
        Story.model(
          ({
            traps,
            seats: [{ trapStock }],
            trapHint,
            nextEntityId,
            particles,
          }) => {
            expect(traps).toEqual([barricade(start.nextEntityId, 'North')])
            expect(trapStock.Barricade).toBe(0)
            expect(trapHint).toEqual(TrapHint.Seen())
            expect(nextEntityId).toBe(start.nextEntityId + 1)
            expect(
              Array.filter(particles, ({ kind }) => kind === 'Dust').length,
            ).toBeGreaterThan(0)
          },
        ),
      )
    },
  )

  it.effect('the PLACE button boards it up too', () =>
    Story.story(
      APPLICATION,
      Story.given(stocked(1, 0)),
      Story.message(Message.ClickedPlaceTrapButton()),
      Story.model(({ traps }) => {
        expect(Array.map(traps, trap => trap._tag)).toEqual(['Barricade'])
      }),
    ),
  )

  it.effect('a player standing in the doorway is nudged into the room', () =>
    Story.story(
      APPLICATION,
      Story.given(stocked(1, 0, { x: 5, y: 90 })),
      press('KeyT'),
      Story.model(({ traps, seats: [{ player }] }) => {
        expect(traps).toHaveLength(1)
        expect(player.x).toBeGreaterThanOrEqual(
          PARLOUR.thresholds.West.box.right + PLAYER_RADIUS,
        )
      }),
      ...ticks(5, FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.x).toBeGreaterThanOrEqual(
          PARLOUR.thresholds.West.box.right + PLAYER_RADIUS,
        )
      }),
    ),
  )

  it.effect(
    'placement is refused away from a doorway, outside Preparation, and over the limit',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(stocked(1, 0, ROOM_MIDDLE)),
          press('KeyT'),
          Story.model(current => {
            expect(current.traps).toEqual([])
            expect(focusOf(current).trapStock.Barricade).toBe(1)
            expect(refusal(current)).toEqual(
              Option.some('Stand in a doorway to board it up'),
            )
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(stocked(1, 0), { phase: () => WAVE_2_FIGHT }),
          ),
          press('KeyT'),
          Story.model(current => {
            expect(current.traps).toEqual([])
            expect(refusal(current)).toEqual(
              Option.some('Traps go down between waves'),
            )
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(stocked(1, 0), {
              traps: () => [barricade(1, 'West'), barricade(2, 'East')],
            }),
          ),
          press('KeyT'),
          Story.model(current => {
            expect(current.traps).toHaveLength(2)
            expect(focusOf(current).trapStock.Barricade).toBe(1)
            expect(refusal(current)).toEqual(Option.some('Two Plank Piles max'))
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(stocked(1, 0), {
              traps: () => [barricade(1, 'North')],
            }),
          ),
          press('KeyT'),
          Story.model(current => {
            expect(current.traps).toHaveLength(1)
            expect(refusal(current)).toEqual(
              Option.some('This doorway is already boarded up'),
            )
          }),
        )
      }),
  )

  it.effect('the refusal notice fades after a moment', () =>
    Story.story(
      APPLICATION,
      Story.given(stocked(1, 0, ROOM_MIDDLE)),
      press('KeyT'),
      ...ticks(40, LONG_FRAME_MS),
      Story.model(current => {
        expect(current.trapNotice).toEqual(TrapNotice.Quiet())
      }),
    ),
  )
})

describe('placing a turret', () => {
  it.effect(
    'T sets a Grumpy Gnome on the free tile in front of the player',
    () =>
      Story.story(
        APPLICATION,
        Story.given(stocked(0, 1, ROOM_MIDDLE)),
        press('KeyT'),
        Story.model(({ traps, seats: [{ trapStock }] }) => {
          expect(traps).toHaveLength(1)
          const placed = Option.getOrThrow(Array.head(traps))
          expect(placed._tag).toBe('Turret')
          expect(
            Trap.guards.Turret(placed) && [placed.column, placed.row],
          ).toEqual([17, 9])
          expect(trapStock.Turret).toBe(0)
        }),
      ),
  )

  it.effect(
    'placement is refused on walls, doorways, and over the limit, even with free floor nearby',
    () =>
      Effect.gen(function* () {
        const refusedWith = (start: Model, reason: string) =>
          Story.story(
            APPLICATION,
            Story.given(start),
            press('KeyT'),
            Story.model(current => {
              expect(current.traps).toEqual(start.traps)
              expect(refusal(current)).toEqual(Option.some(reason))
            }),
          )

        yield* refusedWith(
          stocked(0, 1, { x: 165, y: 25 }, { x: 0, y: -1 }),
          'Something is in the way',
        )
        yield* refusedWith(
          stocked(0, 1, { x: 15, y: 90 }, { x: -1, y: 0 }),
          'Doorways are for Plank Piles',
        )
        yield* refusedWith(
          modifyFields(stocked(0, 1, ROOM_MIDDLE), {
            traps: () => [turret(1, 3, 9), turret(2, 25, 9)],
          }),
          'All 2 Grumpy Gnomes are out',
        )
      }),
  )

  it.effect(
    'a blocked front tile falls back to the nearest free tile ahead',
    () =>
      Effect.gen(function* () {
        // NOTE: where the new Gnome went: every Turret but the one placed
        // before.
        const placedTile = (start: Model) =>
          Story.story(APPLICATION, Story.given(start), press('KeyT')).pipe(
            Effect.map(({ traps }) =>
              Array.filterMap(traps, trap =>
                Trap.guards.Turret(trap) && trap.id !== 1
                  ? Result.succeed([trap.column, trap.row] as const)
                  : Result.failVoid,
              ),
            ),
          )

        const ahead = yield* placedTile(
          stocked(0, 1, { x: 168, y: 95 }, { x: 1, y: 0 }),
        )
        const nearest = yield* placedTile(
          modifyFields(stocked(0, 1, ROOM_MIDDLE), {
            traps: () => [turret(1, 17, 9)],
          }),
        )
        const besideStall = yield* placedTile(
          stocked(0, 1, { x: 275, y: 135 }, { x: 0, y: 1 }),
        )
        expect(ahead).toEqual([[18, 9]])
        expect(nearest).toEqual([[16, 8]])
        expect(besideStall).toHaveLength(1)
        expect(besideStall).not.toContainEqual([27, 14])
        expect(besideStall).not.toContainEqual([26, 14])
      }),
  )

  it.effect(
    'G and the NEXT button switch between the kinds the player owns',
    () =>
      Story.story(
        APPLICATION,
        Story.given(stocked(1, 1)),
        press('KeyG'),
        Story.model(({ seats: [{ selectedTrap }] }) => {
          expect(selectedTrap).toBe('Turret')
        }),
        Story.message(Message.ClickedNextTrapButton()),
        Story.model(({ seats: [{ selectedTrap }] }) => {
          expect(selectedTrap).toBe('Barricade')
        }),
        press('KeyT'),
        Story.model(({ traps, seats: [{ selectedTrap, trapStock }] }) => {
          expect(Array.map(traps, trap => trap._tag)).toEqual(['Barricade'])
          expect(trapStock).toEqual({ Barricade: 0, Turret: 1 })
          expect(selectedTrap).toBe('Barricade')
        }),
        press('KeyG'),
        Story.model(({ seats: [{ selectedTrap }] }) => {
          expect(selectedTrap).toBe('Barricade')
        }),
        release('KeyG'),
        press('KeyS'),
        ...ticks(4, LONG_FRAME_MS),
        release('KeyS'),
        press('KeyT'),
        Story.model(({ traps }) => {
          expect(Array.map(traps, trap => trap._tag)).toEqual([
            'Barricade',
            'Turret',
          ])
        }),
      ),
  )

  it.effect('the trap selection stays put outside a round', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(stocked(1, 1), {
          phase: () => Phase.Victory(),
        }),
      ),
      press('KeyG'),
      Story.model(({ seats: [{ selectedTrap }] }) => {
        expect(selectedTrap).toBe('Barricade')
      }),
      Story.message(Message.ClickedNextTrapButton()),
      Story.model(({ seats: [{ selectedTrap }] }) => {
        expect(selectedTrap).toBe('Barricade')
      }),
    ),
  )
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
      const bare = flowFieldToward(MANOR, focusOf(start).player, clearance, [])
      const tolled = flowFieldToward(
        MANOR,
        focusOf(start).player,
        clearance,
        tolls,
      )
      expect(distanceAt(tolled.distances, innerTile)).toBeGreaterThan(
        TRAPS.Barricade.pathCost,
      )
      expect(distanceAt(tolled.distances, innerTile)).toBeGreaterThan(
        distanceAt(bare.distances, innerTile),
      )
    })
  })

  it.effect(
    'a zombie at a boarded door walks around to another door when that is shorter',
    () =>
      Effect.gen(function* () {
        const frames: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            fightingWith(
              [barricade(1, 'North')],
              [
                zombieOf('Shambler', 50, northSpawn.x, northSpawn.y, {
                  speed: 40,
                }),
              ],
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
      }),
  )

  it.effect(
    'a zombie chews through a barricade when it is the only way in',
    () =>
      Effect.gen(function* () {
        const frames: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            fightingWith(
              [
                barricade(1, 'North'),
                barricade(2, 'West'),
                barricade(3, 'East'),
                barricade(4, 'South'),
              ],
              [
                zombieOf('Shambler', 50, northSpawn.x, northSpawn.y, {
                  speed: 40,
                }),
              ],
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
      }),
  )

  it.effect(
    'a zombie chews through a barricade when going around is much longer',
    () =>
      Effect.gen(function* () {
        const frames: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            fightingWith(
              [barricade(1, 'North')],
              [
                zombieOf('Shambler', 50, northSpawn.x, northSpawn.y, {
                  speed: 40,
                }),
              ],
              { x: 220, y: 32 },
            ),
          ),
          ...recordTicks(60, LONG_FRAME_MS, frames),
        )

        const last = Option.getOrThrow(Array.last(frames))
        expect(
          Array.some(last.traps, trap => trap.hp < TRAPS.Barricade.hp),
        ).toBe(true)
        expect(Array.every(last.zombies, isNearNorthDoor)).toBe(true)
      }),
  )
})

describe('barricade damage', () => {
  const pressedAgainstNorth: Vector = { x: 220, y: 5 }

  it.effect(
    'a Groaner chews it through three stages, with splinters, and it breaks with a crash',
    () =>
      Effect.gen(function* () {
        const frames: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
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
      }),
  )

  it.effect('a Big Lug hits it much harder than a Groaner', () =>
    Effect.gen(function* () {
      const chewedAfterOneSecond = (kind: ZombieKind) =>
        Story.story(
          APPLICATION,
          Story.given(
            fightingWith(
              [barricade(1, 'North')],
              [zombieOf(kind, 50, 220, 2, { speed: 20 })],
              { x: 220, y: 40 },
            ),
          ),
          ...ticks(20, LONG_FRAME_MS),
        ).pipe(
          Effect.map(({ traps }) =>
            Option.match(Array.head(traps), {
              onNone: () => TRAPS.Barricade.hp,
              onSome: trap => TRAPS.Barricade.hp - trap.hp,
            }),
          ),
        )

      const tank = yield* chewedAfterOneSecond('Tank')
      const groaner = yield* chewedAfterOneSecond('Shambler')
      expect(tank).toBeCloseTo(ZOMBIE_KINDS.Tank.trapBitePerSecond, 0)
      expect(tank).toBeGreaterThan(groaner * 3)
    }),
  )

  it.effect(
    'the player cannot walk through a barricade but bullets fly through it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(
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
        Story.model(({ seats: [{ player }], frameEvents, bullets }) => {
          expect(player.x).toBeCloseTo(
            PARLOUR.thresholds.West.box.right + PLAYER_RADIUS,
            1,
          )
          expect(frameEvents).not.toContainEqual(
            expect.objectContaining({ _tag: 'BulletStruck' }),
          )
          expect(
            Array.some(
              bullets,
              ({ x }) => x < PARLOUR.thresholds.West.box.right,
            ),
          ).toBe(true)
        }),
      ),
  )
})

describe('bursts and traps', () => {
  it.effect(
    'a Kaboomer burst damages a barricade and a gnome in reach, but not one out of it',
    () => {
      const blast = {
        ...zombieOf('Exploder', 60, 222, 25),
        hp: 0,
        state: ZombieState.Fusing({ remainingMs: 0 }),
      }
      const burstDamage = 15
      return Story.story(
        APPLICATION,
        Story.given(
          fightingWith(
            [barricade(1, 'North'), turret(2, 22, 3), turret(3, 5, 14)],
            [blast],
            ROOM_MIDDLE,
          ),
        ),
        tick(FRAME_MS),
        Story.model(({ traps, frameEvents }) => {
          expect(Array.map(traps, ({ id, hp }) => [id, hp])).toEqual([
            [1, TRAPS.Barricade.hp - burstDamage],
            [2, TRAPS.Turret.hp - burstDamage],
            [3, TRAPS.Turret.hp],
          ])
          expect(
            Array.filter(frameEvents, GameEvent.guards.TrapBroken),
          ).toEqual([])
        }),
      )
    },
  )

  it.effect(
    'a Kaboomer that walks into a barricade fuses and blows it apart',
    () =>
      Effect.gen(function* () {
        const frames: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
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
      }),
  )
})

describe('turrets', () => {
  const TURRET_TILE = { column: 16, row: 9 }
  const turretCenter = { x: 165, y: 95 }
  const tough = (id: number, at: Vector) =>
    zombieOf('Shambler', id, at.x, at.y, { speed: 0, hp: 999 })

  it.effect(
    'fires at the nearest zombie in range, then waits out its cooldown',
    () =>
      Effect.gen(function* () {
        const far = tough(70, { x: 205, y: 95 })
        const near = tough(71, { x: 140, y: 95 })
        const cooldownTicks = countdownTicks(PEA_INTERVAL_MS)
        const frames: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            fightingWith(
              [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
              [far, near],
              { x: 40, y: 160 },
            ),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            const shots = firedPeas(current)
            expect(shots).toHaveLength(1)
            const shot = Option.getOrThrow(Array.head(shots))
            expect(
              GameEvent.guards.Fired(shot) && shot.direction.x,
            ).toBeCloseTo(-1)
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
      }),
  )

  it.effect('does not shoot through cover or past its range', () =>
    Effect.gen(function* () {
      const hidden = tough(72, { x: 165, y: 100 })
      const visible = tough(73, { x: 230, y: 145 })
      const behindCouch = [turret(1, 16, 14)]

      yield* Story.story(
        APPLICATION,
        Story.given(
          fightingWith(behindCouch, [hidden, visible], { x: 40, y: 160 }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          const shot = Option.getOrThrow(Array.head(firedPeas(current)))
          expect(
            GameEvent.guards.Fired(shot) && shot.direction.x,
          ).toBeGreaterThan(0.9)
        }),
      )

      yield* Story.story(
        APPLICATION,
        Story.given(fightingWith(behindCouch, [hidden], { x: 40, y: 160 })),
        ...ticks(10, FRAME_MS),
        Story.model(current => {
          expect(firedPeas(current)).toEqual([])
          expect(current.bullets).toEqual([])
        }),
      )

      yield* Story.story(
        APPLICATION,
        Story.given(
          fightingWith(
            [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
            [tough(74, { x: turretCenter.x + TURRET_RANGE_PX + 6, y: 95 })],
            { x: 40, y: 160 },
          ),
        ),
        ...ticks(10, FRAME_MS),
        Story.model(current => {
          expect(current.bullets).toEqual([])
        }),
      )
    }),
  )

  it.effect('its peas kill zombies and pay their bounty', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fightingWith(
          [turret(1, TURRET_TILE.column, TURRET_TILE.row)],
          [zombieOf('Runner', 75, 200, 95)],
          { x: 40, y: 160 },
        ),
      ),
      ...ticks(Math.ceil((2 * PEA_INTERVAL_MS + 500) / FRAME_MS), FRAME_MS),
      Story.model(({ seats: [{ wallet }], zombies }) => {
        expect(wallet.balance).toBe(ZOMBIE_KINDS.Runner.bounty)
        expect(
          Array.every(
            Array.filter(zombies, ({ id }) => id === 75),
            ({ hp }) => hp <= 0,
          ),
        ).toBe(true)
      }),
    ),
  )

  it.effect('zombies next to a turret chew it and it breaks with a pop', () =>
    Effect.gen(function* () {
      const frames: Array<Model> = []
      yield* Story.story(
        APPLICATION,
        Story.given(
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
    }),
  )
})

describe('between waves', () => {
  const damagedTraps = [
    barricade(1, 'North', TRAPS.Barricade.hp / 2),
    turret(2, 10, 10, TRAPS.Turret.hp / 2),
  ]

  it.effect(
    'traps stay where they were and keep their damage into the next wave',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(readyModel, {
            phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
            traps: () => damagedTraps,
          }),
        ),
        tick(FRAME_MS),
        Story.model(({ phase, traps }) => {
          expect(Phase.guards.Preparation(phase) && phase.wave).toBe(3)
          expect(
            Array.map(traps, ({ id, hp, _tag }) => [id, _tag, hp]),
          ).toEqual([
            [1, 'Barricade', TRAPS.Barricade.hp / 2],
            [2, 'Turret', TRAPS.Turret.hp / 2],
          ])
        }),
      ),
  )

  it.effect(
    'each placed trap repairs on its own, priced by its own missing health',
    () => {
      const plankPrice = Math.ceil(0.5 * TRAPS.Barricade.price * 0.5)
      const gnomePrice = Math.ceil(0.5 * TRAPS.Turret.price * 0.5)
      const shopping = modifyFocus(
        modifyFields(readyModel, {
          phase: () => preparing(),
          traps: () => damagedTraps,
        }),
        {
          shop: () => ShopState.Browsing({ focusedItem: repairItemId(1) }),
          wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
        },
      )
      expect(plankPrice).toBe(24)
      expect(priceFor(shopping, focusSlotOf(shopping), repairItemId(1))).toBe(
        plankPrice,
      )
      expect(priceFor(shopping, focusSlotOf(shopping), repairItemId(2))).toBe(
        gnomePrice,
      )
      expect(repairPrice([damagedTraps[0]!])).toBe(plankPrice)
      expect(itemsIn(shopping, focusSlotOf(shopping), 'Traps')).toEqual([
        'Barricade',
        repairItemId(1),
        'Turret',
        repairItemId(2),
      ])

      return Story.story(
        APPLICATION,
        Story.given(shopping),
        buyAtCounter(repairItemId(1)),
        Story.model(current => {
          expect(focusOf(current).wallet.balance).toBe(100 - plankPrice)
          expect(Array.map(current.traps, ({ hp }) => hp)).toEqual([
            TRAPS.Barricade.hp,
            TRAPS.Turret.hp / 2,
          ])
          expect(
            stockTag(current, focusSlotOf(current), repairItemId(1)),
          ).toEqual(StockTag.Done({ label: 'FULL' }))
          expect(
            stockTag(current, focusSlotOf(current), repairItemId(2)),
          ).toEqual(StockTag.Price({ price: gnomePrice }))
        }),
        buyAtCounter(repairItemId(1)),
        Story.model(({ seats: [{ wallet }] }) => {
          expect(wallet.balance).toBe(100 - plankPrice)
        }),
        buyAtCounter(repairItemId(2)),
        Story.model(({ seats: [{ wallet }], traps }) => {
          expect(wallet.balance).toBe(100 - plankPrice - gnomePrice)
          expect(Array.map(traps, ({ hp }) => hp)).toEqual([
            TRAPS.Barricade.hp,
            TRAPS.Turret.hp,
          ])
        }),
      )
    },
  )

  it.effect('a new run clears every trap and the trap pack', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(readyModel, {
            phase: () => Phase.GameOver({ wave: 4 }),
            screenMs: () => RESTART_GRACE_MS,
            traps: () => damagedTraps,
          }),
          {
            trapStock: () => ({ Barricade: 2, Turret: 1 }),
            selectedTrap: () => 'Turret',
          },
        ),
      ),
      press('Enter'),
      Story.model(({ phase, traps, seats: [{ trapStock, selectedTrap }] }) => {
        expect(Phase.guards.Preparation(phase) && phase.wave).toBe(1)
        expect(traps).toEqual([])
        expect(trapStock).toEqual({ Barricade: 0, Turret: 0 })
        expect(selectedTrap).toBe('Barricade')
      }),
    ),
  )
})

describe('trap determinism', () => {
  const playWithTraps = (seed: number) =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(stocked(1, 1), {
          rngState: () => seed,
          phase: () => preparing(PLANNED_SPAWNS),
          introducedKinds: () => ZOMBIE_KIND_ORDER,
        }),
      ),
      press('KeyT'),
      Story.model(({ phase }) => {
        expect(phase).toEqual(preparing(PLANNED_SPAWNS))
      }),
      press('KeyS'),
      ...ticks(30, FRAME_MS),
      release('KeyS'),
      press('KeyT'),
      press('Enter'),
      holdFire,
      ...ticks(400, FRAME_MS),
    )

  it.effect('a wave with traps replays identically from the same seed', () =>
    Effect.gen(function* () {
      const first = yield* playWithTraps(4321)
      const again = yield* playWithTraps(4321)
      const other = yield* playWithTraps(8765)
      expect(first.traps).toHaveLength(2)
      expect(scoreOf(first.stats)).toBeGreaterThan(0)
      expect(again).toEqual(first)
      expect(other).not.toEqual(first)
    }),
  )
})
