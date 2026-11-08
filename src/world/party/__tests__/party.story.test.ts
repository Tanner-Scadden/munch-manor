import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  Arsenal,
  type Bullet,
  type Difficulty,
  GameEvent,
  HitStop,
  Invulnerability,
  Life,
  type Model,
  Phase,
  Pierce,
  type PlannedSpawn,
  Reload,
  ShopState,
  Trap,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  FIXED_STEP_MS,
  IDLE_RELOAD_MS,
  PISTOL_MAGAZINE,
  PLAYER_MAX_HP,
} from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  atSeat,
  crewInWave,
  home,
  pipeline,
  placeSeat,
  withSeatLife,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  countdownTicks,
  ticks,
  withPistol,
  zombieOf,
} from '../../../test/testing'
import { TRAPS } from '../../gear/traps'
import { WEAPONS, freshGun, heldGun } from '../../gear/weapons'
import { MANOR, levelOf } from '../../level/arena'
import { EXIT_RULES, KITCHEN_EXIT } from '../../level/exits'
import { flowFieldsToward } from '../../level/pathing'
import { type World, withWorld } from '../../schema/world'
import {
  type Intent,
  Purchasable,
  Purchase,
  type Seat,
  type SeatState,
  idleIntent,
} from '../../schema/worldSchema'
import { PURCHASE_RULES } from '../../shop/purchase'
import { SHOP_ITEMS, STALL_BOX } from '../../shop/shop'
import { blastTeammates } from '../../step/combat'
import {
  SeatAction,
  applySeatAction,
  soloInputs,
  stepWorld,
} from '../../step/stepWorld'
import { rollSpawns } from '../../waves/endlessWaves'
import { beginPreparation, waveBonus } from '../../waves/waves'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import {
  COOP_RULES,
  focusOf,
  focusSeat,
  maybePlayerAt,
  modifyFocus,
  playersOf,
  setPresence,
  targetsOf,
} from '../party'

// Co-op's World rules (MULTIPLAYER.md, Phase 1), played through the root's Story
// with two and four players in one World.

const TICK_MS = FIXED_STEP_MS
const LEFT_X = 60
const RIGHT_X = 240
const ROW_Y = 104

const withMoney =
  (slot: number, balance: number) =>
  (current: Model): Model =>
    atSeat(current, slot, world =>
      modifyFocus(world, {
        wallet: wallet => modifyFields(wallet, { balance: () => balance }),
      }),
    )

const act = (current: Model, slot: number, action: SeatAction): Model =>
  withWorld(current, world => applySeatAction(world, slot, action))

const seatedAt = (current: World, slot: number): SeatState =>
  Option.getOrThrow(maybePlayerAt(current, slot))

const seatOf = (current: World, slot: number): Seat =>
  seatedAt(current, slot).seat

const seatWorldOf = (current: World, slot: number): World =>
  focusSeat(current, slot)

const bulletAt = (
  id: number,
  x: number,
  y: number,
  velocityX: number,
  shooter: number,
): Bullet => ({
  id,
  x,
  y,
  velocityX,
  velocityY: 0,
  remainingMs: 1000,
  weapon: 'Pistol',
  damage: WEAPONS.Pistol.damage,
  knockback: 0,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
  shooter,
})

describe('who the zombies hunt', () => {
  it.effect('each zombie walks to the standing player nearest it', () =>
    Story.story(
      APPLICATION,
      Story.given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y),
          placeSeat(1, RIGHT_X, ROW_Y),
          current =>
            modifyFields(current, {
              zombies: () => [
                zombieOf('Shambler', 900, LEFT_X + 40, ROW_Y, { speed: 30 }),
                zombieOf('Shambler', 901, RIGHT_X - 40, ROW_Y, { speed: 30 }),
              ],
            }),
        )(crewInWave(2)),
      ),
      ...ticks(30, TICK_MS),
      Story.model(current => {
        const [nearLeft, nearRight] = current.zombies
        expect(nearLeft?.x).toBeLessThan(LEFT_X + 40)
        expect(nearRight?.x).toBeGreaterThan(RIGHT_X - 40)
        expect(
          flowFieldsToward(MANOR, targetsOf(current), []).Narrow.moreOrigins,
        ).toHaveLength(1)
      }),
    ),
  )

  it.effect('a downed player is not hunted', () =>
    Story.story(
      APPLICATION,
      Story.given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y),
          placeSeat(1, RIGHT_X, ROW_Y, 0),
          withSeatLife(
            1,
            Life.Downed({ bleedMs: 1e9, reviveMs: 0, callMs: 0 }),
          ),
          current =>
            modifyFields(current, {
              zombies: () => [
                zombieOf('Shambler', 900, RIGHT_X - 30, ROW_Y, { speed: 30 }),
              ],
            }),
        )(crewInWave(2)),
      ),
      ...ticks(30, TICK_MS),
      Story.model(current => {
        expect(current.zombies[0]?.x).toBeLessThan(RIGHT_X - 30)
      }),
    ),
  )
})

describe('downed, revived, and bled out', () => {
  const bitten = pipeline(
    placeSeat(0, LEFT_X, ROW_Y),
    placeSeat(1, RIGHT_X, ROW_Y, 1),
    current =>
      modifyFields(current, {
        zombies: () => [zombieOf('Shambler', 900, RIGHT_X + 5, ROW_Y)],
      }),
  )(crewInWave(2))

  it.effect('a player at zero hearts goes down and the run goes on', () =>
    Story.story(
      APPLICATION,
      Story.given(bitten),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(seatOf(current, 1).life._tag).toBe('Downed')
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['PlayerDowned'])),
        ).toBe(true)
        expect(current.phase._tag).toBe('Wave')
      }),
    ),
  )

  const downedBeside = pipeline(
    placeSeat(0, RIGHT_X - 8, ROW_Y),
    placeSeat(1, RIGHT_X, ROW_Y, 0),
    withSeatLife(
      1,
      Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0, callMs: 0 }),
    ),
  )(crewInWave(2))

  const reviveTicks = Math.ceil(COOP_RULES.reviveMs / TICK_MS)

  it.effect(
    'a teammate standing still beside them for 2 s revives them with 2 hearts',
    () =>
      Story.story(
        APPLICATION,
        Story.given(downedBeside),
        ...ticks(reviveTicks - 2, TICK_MS),
        Story.model(current => {
          expect(seatOf(current, 1).life._tag).toBe('Downed')
        }),
        ...ticks(2, TICK_MS),
        Story.model(current => {
          expect(seatOf(current, 1).life._tag).toBe('Standing')
          expect(seatedAt(current, 1).player.hp).toBe(COOP_RULES.reviveHearts)
        }),
      ),
  )

  it.effect('the run ends when everyone is down', () =>
    Story.story(
      APPLICATION,
      Story.given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y, 0),
          withSeatLife(
            1,
            Life.Downed({ bleedMs: 1e9, reviveMs: 0, callMs: 0 }),
          ),
        )(crewInWave(2)),
      ),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(current.phase._tag).toBe('GameOver')
      }),
    ),
  )

  it.effect(
    'bled-out and downed players come back free at the next break',
    () => {
      const clearing = Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] })
      return Story.story(
        APPLICATION,
        Story.given(
          pipeline(
            withSeatLife(1, Life.BledOut()),
            placeSeat(1, RIGHT_X, ROW_Y, 0),
            withSeatLife(
              2,
              Life.Downed({ bleedMs: 1e9, reviveMs: 0, callMs: 0 }),
            ),
            placeSeat(2, LEFT_X, ROW_Y, 0),
          )(crewInWave(4, clearing)),
        ),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          expect(current.phase._tag).toBe('Preparation')
          Array.forEach(playersOf(current), ({ seat }) => {
            expect(seat.life._tag).toBe('Standing')
          })
          expect(seatedAt(current, 1).player.hp).toBe(COOP_RULES.reviveHearts)
          expect(seatedAt(current, 2).player.hp).toBe(COOP_RULES.reviveHearts)
        }),
      )
    },
  )
})

describe('money', () => {
  it.effect(
    'the wave clear bonus is split evenly, the odd dollars to the first seats',
    () => {
      const clearing = Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] })
      const bonus = waveBonus(3)
      return Story.story(
        APPLICATION,
        Story.given(crewInWave(4, clearing)),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          const paid = Array.map(
            playersOf(current),
            ({ wallet }) => wallet.balance,
          )
          expect(Array.reduce(paid, 0, (sum, each) => sum + each)).toBe(bonus)
          expect(Math.max(...paid) - Math.min(...paid)).toBeLessThanOrEqual(1)
          expect(paid[0]).toBe(Math.ceil(bonus / 4))
        }),
      )
    },
  )

  it.effect('a kill pays the player whose shot landed', () => {
    const bounty = ZOMBIE_KINDS.Shambler.bounty
    return Story.story(
      APPLICATION,
      Story.given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y),
          placeSeat(1, RIGHT_X, ROW_Y + 40),
          current =>
            modifyFields(current, {
              zombies: () => [zombieOf('Shambler', 900, 150, ROW_Y, { hp: 1 })],
              bullets: () => [bulletAt(800, 140, ROW_Y, 300, 1)],
            }),
        )(crewInWave(2)),
      ),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(seatedAt(current, 1).wallet.balance).toBe(bounty)
        expect(seatOf(current, 1).kills).toBe(1)
        expect(seatedAt(current, 0).wallet.balance).toBe(0)
      }),
    )
  })

  const DOOR_X = 70
  const DOOR_Y = 26
  const HOLD_TICKS = Math.ceil(PURCHASE_RULES.holdMs / TICK_MS) + 2

  // NOTE: the seats in `firing` shoot the whole time, so standing at the
  // door does not buy for them (src/world/shop/purchase.ts).
  const holding = (
    slots: ReadonlyArray<number>,
    firing: ReadonlyArray<number> = [],
  ) =>
    new Map<number, Intent>([
      ...Array.map(
        firing,
        slot => [slot, { ...idleIntent, trigger: 'Held' as const }] as const,
      ),
      ...Array.map(
        slots,
        slot => [slot, { ...idleIntent, interact: 'Held' as const }] as const,
      ),
    ])

  const holdFor = (
    current: Model,
    slots: ReadonlyArray<number>,
    count: number,
    firing: ReadonlyArray<number> = [],
  ): Model =>
    withWorld(current, world =>
      Array.reduce(
        Array.makeBy(count, () => slots),
        world,
        (stepped, holders) =>
          stepWorld(stepped, holding(holders, firing)).world,
      ),
    )

  test('a manor door is bought in full by the one player holding at it', () => {
    const preparation = Phase.Preparation({
      wave: 3,
      remainingMs: 30_000,
      durationMs: 30_000,
      spawns: [],
    })
    const atDoor = pipeline(
      withMoney(0, 100),
      withMoney(1, 100),
      placeSeat(0, DOOR_X - 8, DOOR_Y),
      placeSeat(1, DOOR_X + 8, DOOR_Y),
    )(crewInWave(2, preparation))
    const halfway = holdFor(atDoor, [1], Math.floor(HOLD_TICKS / 2), [0])
    expect(levelOf(halfway).key).toBe(levelOf(atDoor).key)
    expect(
      Purchase.isAnyOf(['Holding'])(focusOf(seatWorldOf(halfway, 1)).purchase),
    ).toBe(true)
    expect(
      Purchase.isAnyOf(['Idle'])(focusOf(seatWorldOf(halfway, 0)).purchase),
    ).toBe(true)
    const bought = holdFor(atDoor, [1], HOLD_TICKS, [0])
    expect(seatedAt(bought, 1).wallet.balance).toBe(100 - EXIT_RULES.price)
    expect(seatedAt(bought, 0).wallet.balance).toBe(100)
    expect(levelOf(bought).key).not.toBe(levelOf(atDoor).key)
  })

  test('at the ammo window mid-wave each player buys ammo for themselves', () => {
    const smgOf = (rounds: number) =>
      Arsenal.HoldingSecond({
        first: freshGun('Pistol'),
        second: modifyFields(freshGun('Smg'), { rounds: () => rounds }),
      })
    const armed =
      (slot: number, rounds: number) =>
      (current: Model): Model =>
        atSeat(current, slot, world =>
          modifyFocus(world, {
            player: player =>
              modifyFields(player, { arsenal: () => smgOf(rounds) }),
          }),
        )
    const stallX = (STALL_BOX.left + STALL_BOX.right) / 2
    const lateWave = Phase.Wave({
      wave: 5,
      elapsedMs: 20_000,
      spawns: [DISTANT_SPAWN],
    })
    const atStall = pipeline(
      withMoney(0, 100),
      withMoney(1, 100),
      armed(0, 10),
      armed(1, 10),
      placeSeat(0, stallX - 30, STALL_BOX.bottom + 30),
      placeSeat(1, stallX, STALL_BOX.bottom + 6),
    )(crewInWave(2, lateWave))
    const bought = holdFor(atStall, [1], HOLD_TICKS)
    expect(seatedAt(bought, 1).wallet.balance).toBe(
      100 - SHOP_ITEMS.SmgRounds.price,
    )
    expect(heldGun(seatedAt(bought, 1).player.arsenal).rounds).toBeGreaterThan(
      10,
    )
    expect(seatedAt(bought, 0).wallet.balance).toBe(100)
    expect(heldGun(seatedAt(bought, 0).player.arsenal).rounds).toBe(10)
  })

  test('a seat standing still at a door buys it alone, while a teammate shooting beside it never does', () => {
    const preparation = Phase.Preparation({
      wave: 3,
      remainingMs: 30_000,
      durationMs: 30_000,
      spawns: [],
    })
    const atDoor = pipeline(
      withMoney(0, 100),
      withMoney(1, 100),
      placeSeat(0, DOOR_X - 8, DOOR_Y),
      placeSeat(1, DOOR_X + 8, DOOR_Y),
    )(crewInWave(2, preparation))
    const standTicks = Math.ceil(PURCHASE_RULES.standMs / TICK_MS) + 2
    const halfway = holdFor(atDoor, [], Math.floor(standTicks / 2), [0])
    expect(
      Purchase.isAnyOf(['Holding'])(focusOf(seatWorldOf(halfway, 1)).purchase),
    ).toBe(true)
    expect(
      Purchase.isAnyOf(['Idle'])(focusOf(seatWorldOf(halfway, 0)).purchase),
    ).toBe(true)
    const bought = holdFor(atDoor, [], standTicks, [0])
    expect(seatedAt(bought, 1).wallet.balance).toBe(100 - EXIT_RULES.price)
    expect(seatedAt(bought, 0).wallet.balance).toBe(100)
    expect(levelOf(bought).key).not.toBe(levelOf(atDoor).key)
  })

  test('a teammate short of the price is refused while the one who can pay buys', () => {
    const preparation = Phase.Preparation({
      wave: 3,
      remainingMs: 30_000,
      durationMs: 30_000,
      spawns: [],
    })
    const atDoor = pipeline(
      withMoney(0, 10),
      withMoney(1, 100),
      placeSeat(0, DOOR_X - 8, DOOR_Y),
      placeSeat(1, DOOR_X + 8, DOOR_Y),
    )(crewInWave(2, preparation))
    const pressed = holdFor(atDoor, [0, 1], 1)
    expect(focusOf(seatWorldOf(pressed, 0)).purchase).toEqual(
      Purchase.Refused({
        target: Purchasable.Exit({ exit: KITCHEN_EXIT }),
        shortBy: EXIT_RULES.price - 10,
        sinceMs: 0,
      }),
    )
    const bought = holdFor(atDoor, [0, 1], HOLD_TICKS)
    expect(seatedAt(bought, 0).wallet.balance).toBe(10)
    expect(seatedAt(bought, 1).wallet.balance).toBe(100 - EXIT_RULES.price)
  })

  test('mid-wave, one player holds the manor door open and its doors join the wave', () => {
    const [, spawns] = rollSpawns(41, 4)
    const fighting = Phase.Wave({ wave: 4, elapsedMs: 0, spawns })
    const atDoor = pipeline(
      withMoney(0, 100),
      withMoney(1, 100),
      placeSeat(1, DOOR_X, DOOR_Y),
    )(crewInWave(2, fighting))
    const bought = holdFor(atDoor, [1], HOLD_TICKS, [0])
    expect(seatedAt(bought, 1).wallet.balance).toBe(100 - EXIT_RULES.price)
    expect(seatedAt(bought, 0).wallet.balance).toBe(100)
    expect(levelOf(bought).key).not.toBe(levelOf(atDoor).key)
    const doors = Phase.isAnyOf(['Wave'])(bought.phase)
      ? Array.map(bought.phase.spawns, ({ door }) => door)
      : []
    expect(doors).toHaveLength(spawns.length)
    expect(
      Array.some(doors, door => door === 'Back' || door === 'Window'),
    ).toBe(true)
  })
})

describe('traps per player', () => {
  const preparation = Phase.Preparation({
    wave: 3,
    remainingMs: 30_000,
    durationMs: 30_000,
    spawns: [],
  })
  const shopping = pipeline(withMoney(0, 500), withMoney(1, 500), current =>
    atSeat(current, 1, world =>
      modifyFocus(world, {
        shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
      }),
    ),
  )(crewInWave(2, preparation))

  test('each player can hold one Plank Pile, and a teammate still can', () => {
    const once = act(shopping, 1, SeatAction.Buy({ item: 'Barricade' }))
    const twice = act(once, 1, SeatAction.Buy({ item: 'Barricade' }))
    expect(seatedAt(once, 1).wallet.balance).toBeLessThan(500)
    expect(seatedAt(twice, 1).wallet.balance).toBe(
      seatedAt(once, 1).wallet.balance,
    )
    const lead = atSeat(twice, 0, world =>
      modifyFocus(world, {
        shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
      }),
    )
    const leadBought = act(lead, 0, SeatAction.Buy({ item: 'Barricade' }))
    expect(seatedAt(leadBought, 0).wallet.balance).toBeLessThan(500)
  })

  test('planks board at most half the open doors, however many players', () => {
    const { thresholds } = levelOf(shopping)
    const east = thresholds.East.box
    const twoBoarded = pipeline(
      current =>
        modifyFields(current, {
          traps: () => [
            Trap.Barricade({
              id: 1,
              door: 'North',
              hp: TRAPS.Barricade.hp,
              hitRemainingMs: 0,
            }),
            Trap.Barricade({
              id: 2,
              door: 'West',
              hp: TRAPS.Barricade.hp,
              hitRemainingMs: 0,
            }),
          ],
        }),
      placeSeat(1, (east.left + east.right) / 2, (east.top + east.bottom) / 2),
    )(act(shopping, 1, SeatAction.Buy({ item: 'Barricade' })))
    const tried = act(
      act(twoBoarded, 1, SeatAction.LeaveCounter()),
      1,
      SeatAction.PlaceTrap(),
    )
    expect(levelOf(tried).doorIds).toHaveLength(4)
    expect(tried.traps).toHaveLength(2)
    expect(seatOf(tried, 1).trapIds).toEqual([])
  })

  test('the trap a player places is theirs', () => {
    const stocked = act(shopping, 1, SeatAction.Buy({ item: 'Turret' }))
    const placedTrap = act(
      act(placeSeat(1, 160, 120)(stocked), 1, SeatAction.LeaveCounter()),
      1,
      SeatAction.PlaceTrap(),
    )
    expect(placedTrap.traps).toHaveLength(1)
    expect(seatOf(placedTrap, 1).trapIds).toEqual([placedTrap.traps[0]?.id])
    expect(seatOf(placedTrap, 0).trapIds).toEqual([])
  })
})

describe('friendly fire', () => {
  const inTheLine = (current: Model): Model =>
    pipeline(placeSeat(0, LEFT_X, ROW_Y), placeSeat(1, 150, ROW_Y), world =>
      modifyFields(world, {
        bullets: () => [bulletAt(800, 140, ROW_Y, 300, 0)],
      }),
    )(current)

  it.effect('a teammate’s shot passes through on Normal', () =>
    Story.story(
      APPLICATION,
      Story.given(inTheLine(crewInWave(2))),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(seatedAt(current, 1).player.hp).toBe(PLAYER_MAX_HP)
      }),
    ),
  )

  it.effect('a teammate’s shot passes through on Nightmare too', () => {
    const nightmare = modifyFields(crewInWave(2), {
      difficulty: difficulty =>
        modifyFields(difficulty, { chosen: () => 'Nightmare' }),
    })
    return Story.story(
      APPLICATION,
      Story.given(inTheLine(nightmare)),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(seatedAt(current, 1).player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('a player’s own blast hurts a teammate it reaches but never its thrower', () => {
    const huddled = pipeline(
      placeSeat(0, LEFT_X, ROW_Y),
      placeSeat(1, LEFT_X + 4, ROW_Y),
    )(crewInWave(2))
    const blasted = blastTeammates(huddled, 0, {
      x: LEFT_X + 2,
      y: ROW_Y,
      radius: 30,
      playerDamage: 1,
      zombieDamage: 0,
      trapDamage: 0,
      knockback: 0,
    })
    expect(seatedAt(blasted, 0).player.hp).toBe(PLAYER_MAX_HP)
    expect(seatedAt(blasted, 1).player.hp).toBe(PLAYER_MAX_HP - 1)
  })

  it.effect('single player never shoots itself', () => {
    const solo = pipeline(placeSeat(0, 150, ROW_Y), world =>
      modifyFields(world, {
        difficulty: difficulty =>
          modifyFields(difficulty, { chosen: () => 'Nightmare' }),
        bullets: () => [bulletAt(800, 140, ROW_Y, 300, 0)],
      }),
    )(crewInWave(1))
    return Story.story(
      APPLICATION,
      Story.given(solo),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })
})

describe('the idle reload per seat', () => {
  const partEmpty =
    (slot: number, loaded: number) =>
    (current: Model): Model =>
      atSeat(current, slot, world =>
        modifyFocus(world, {
          player: player =>
            withPistol(player, pistol => ({ ...pistol, loaded })),
        }),
      )

  const restingTwo = (chosen: Difficulty): Model =>
    pipeline(
      placeSeat(0, LEFT_X, ROW_Y),
      placeSeat(1, RIGHT_X, ROW_Y),
      partEmpty(0, PISTOL_MAGAZINE - 1),
      partEmpty(1, 3),
      world =>
        modifyFields(world, {
          difficulty: difficulty =>
            modifyFields(difficulty, { chosen: () => chosen }),
        }),
    )(crewInWave(2))

  const firingSeatZero = new Map<number, Intent>([
    [0, { ...idleIntent, trigger: 'Held' }],
  ])

  const stepped = (current: Model): Model =>
    withWorld(current, world =>
      Array.reduce(
        Array.makeBy(countdownTicks(IDLE_RELOAD_MS), () => firingSeatZero),
        world,
        (stepping, inputs) => stepWorld(stepping, inputs).world,
      ),
    )

  const isSeatReloading = (current: World, slot: number): boolean =>
    Reload.isAnyOf(['Reloading'])(seatedAt(current, slot).player.reload)

  test('on Normal the resting seat reloads while the one firing does not', () => {
    const after = stepped(restingTwo('Normal'))
    expect(seatedAt(after, 0).player.arsenal).not.toEqual(
      seatedAt(restingTwo('Normal'), 0).player.arsenal,
    )
    expect(isSeatReloading(after, 0)).toBe(false)
    expect(isSeatReloading(after, 1)).toBe(true)
  })

  test('on Hard neither seat reloads early', () => {
    const after = stepped(restingTwo('Hard'))
    expect(isSeatReloading(after, 0)).toBe(false)
    expect(isSeatReloading(after, 1)).toBe(false)
  })
})

describe('difficulty scales with the player count', () => {
  const rolled = (count: number) =>
    beginPreparation(crewInWave(count, Phase.Ready()), 4, 30_000)

  const spawnsOf = (world: World): ReadonlyArray<PlannedSpawn> =>
    world.phase._tag === 'Preparation' ? world.phase.spawns : []

  test('wave counts scale by 1, 1.6, 2.2, and 2.8 and health by 1 to 1.3', () => {
    const solo = spawnsOf(rolled(1))
    Array.forEach([2, 3, 4], count => {
      const crowd = spawnsOf(rolled(count))
      const countScale = COOP_RULES.waveCountScale[count - 1] ?? 1
      const healthScale = COOP_RULES.healthScale[count - 1] ?? 1
      expect(crowd).toHaveLength(Math.floor(solo.length * countScale))
      expect(crowd[0]?.hpScale).toBeCloseTo(
        (solo[0]?.hpScale ?? 1) * healthScale,
      )
    })
  })

  test('one player rolls the wave exactly as single player always did', () => {
    const solo = beginPreparation(
      modifyFields(home, { phase: () => Phase.Ready() }),
      4,
      30_000,
    )
    expect(spawnsOf(rolled(1))).toEqual(spawnsOf(solo))
  })
})

describe('the world never pauses in co-op', () => {
  const breakOf = (wave: number) =>
    Phase.Preparation({
      wave,
      remainingMs: 30_000,
      durationMs: 30_000,
      spawns: [],
    })

  const remainingOf = (world: World): number =>
    world.phase._tag === 'Preparation' ? world.phase.remainingMs : -1

  test('a player at the stall does not hold the break clock', () => {
    const browsing = atSeat(crewInWave(2, breakOf(3)), 0, world =>
      modifyFocus(world, {
        shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
      }),
    )
    const stepped = stepWorld(browsing, soloInputs(idleIntent)).world
    expect(remainingOf(stepped)).toBeLessThan(30_000)
  })

  test('the break ends once everyone has pressed READY', () => {
    const waiting = crewInWave(2, breakOf(3))
    const oneReady = stepWorld(
      act(waiting, 0, SeatAction.Ready()),
      soloInputs(idleIntent),
    ).world
    expect(oneReady.phase._tag).toBe('Preparation')
    const bothReady = stepWorld(
      applySeatAction(oneReady, 1, SeatAction.Ready()),
      soloInputs(idleIntent),
    ).world
    expect(bothReady.phase._tag).toBe('Wave')
  })

  test('an away player never holds up READY', () => {
    const away = setPresence(crewInWave(2, breakOf(3)), 1, 'Away')
    const stepped = stepWorld(
      applySeatAction(away, 0, SeatAction.Ready()),
      soloInputs(idleIntent),
    ).world
    expect(stepped.phase._tag).toBe('Wave')
  })

  it.effect('a kill never freezes the World', () =>
    Story.story(
      APPLICATION,
      Story.given(
        pipeline(placeSeat(0, LEFT_X, ROW_Y), current =>
          modifyFields(current, {
            zombies: () => [zombieOf('Shambler', 900, 150, ROW_Y, { hp: 1 })],
            bullets: () => [bulletAt(800, 140, ROW_Y, 300, 0)],
          }),
        )(crewInWave(2)),
      ),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(current.zombies[0]?.hp).toBe(0)
        expect(HitStop.isAnyOf(['Running'])(current.hitStop)).toBe(true)
      }),
    ),
  )
})

describe('away and pickups', () => {
  test('an away player stands frozen and can still be hurt', () => {
    const away = setPresence(
      pipeline(
        placeSeat(0, LEFT_X, ROW_Y),
        placeSeat(1, RIGHT_X, ROW_Y),
        current =>
          modifyFields(current, {
            zombies: () => [zombieOf('Shambler', 900, RIGHT_X + 5, ROW_Y)],
          }),
      )(crewInWave(2)),
      1,
      'Away',
    )
    const walking = new Map([
      [1, modifyFields(idleIntent, { move: () => ({ x: 0, y: 1 }) })],
    ])
    const stepped = stepWorld(away, walking).world
    expect(seatedAt(stepped, 1).player.hp).toBeLessThan(PLAYER_MAX_HP)
    expect(seatedAt(stepped, 1).player.y).toBeCloseTo(ROW_Y, 0)
  })

  test('a pickup goes to whoever touches it', () => {
    const hurtMate = pipeline(
      placeSeat(0, LEFT_X, ROW_Y, 3),
      placeSeat(1, RIGHT_X, ROW_Y, 3),
      current =>
        modifyFields(current, {
          pickups: () => [
            { id: 950, kind: 'Heart', x: RIGHT_X, y: ROW_Y, ageMs: 0 },
          ],
        }),
    )(crewInWave(2))
    const stepped = stepWorld(hurtMate, soloInputs(idleIntent)).world
    expect(seatedAt(stepped, 1).player.hp).toBeGreaterThan(3)
    expect(seatedAt(stepped, 0).player.hp).toBe(3)
    expect(stepped.pickups).toHaveLength(0)
  })
})

describe('single player', () => {
  test('a single player World has no crew', () => {
    expect(crewInWave(1).party._tag).toBe('Solo')
    expect(initialModel.party._tag).toBe('Solo')
    expect(playersOf(crewInWave(1))).toHaveLength(1)
    expect(
      Invulnerability.isAnyOf(['Vulnerable'])(
        focusOf(crewInWave(1)).player.invulnerability,
      ),
    ).toBe(true)
    expect(
      Arsenal.isAnyOf(['OneGun'])(focusOf(crewInWave(1)).player.arsenal),
    ).toBe(true)
  })
})
