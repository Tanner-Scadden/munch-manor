import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { isInKitchenAt } from '../kitchen/kitchenPay'
import { type Level, levelOf } from '../level/arena'
import {
  forEachSeat,
  isCoop,
  maybePlayerAt,
  modifySeat,
  seatStateAt,
} from '../party/party'
import type { World } from '../schema/world'
import {
  type Armament,
  Feat,
  type FeatTally,
  GameEvent,
  GasValve,
  type KillSource,
  Phase,
  type PlayerSlot,
  Purchasable,
  Purchase,
  SOLO_SLOT,
  type SeatState,
  type Vector,
} from '../schema/worldSchema'

// Feats (owner, 2026-11-10, "No shop" in GAME_DESIGN.md): what a player does
// this run that opens a display case (src/world/feats/cases.ts), the stove,
// or the gas valve. Each player keeps their own tally on their seat, so in
// co-op a case opens for whoever gets there first and the room and its
// players agree on it. The tally is fed once a tick from what the tick did:
// its kills (each ZombieKilled event names its killer and what it was made
// with), the hearts each seat lost, the wave's end, a room bought open, and
// the valve turned.

// THE GOALS

// NOTE: how far a feat asks a player to go.
export const goalOf = (feat: Feat): number =>
  Feat.match(feat, {
    Kills: ({ count }) => count,
    KillsWith: ({ count }) => count,
    KillsOf: ({ count }) => count,
    NoHitWave: ({ count }) => count,
    Streak: ({ count }) => count,
    OwnBlast: ({ count }) => count,
    OpenedRoom: ({ count }) => count,
    LitFire: () => 1,
    KeyFromMarked: ({ count }) => count,
    Delivered: ({ count }) => count,
    KitchenKills: ({ count }) => count,
    KitchenStandKills: ({ count }) => count,
  })

// NOTE: how far a tally has gone toward a feat, never past its goal.
export const progressOf: {
  (feat: Feat): (tally: FeatTally) => number
  (tally: FeatTally, feat: Feat): number
} = Function.dual(2, (tally: FeatTally, feat: Feat): number =>
  Math.min(
    goalOf(feat),
    Feat.match(feat, {
      Kills: () => tally.kills,
      KillsWith: ({ armament }) => tally.killsWith[armament],
      KillsOf: ({ kind }) => tally.killsOf[kind],
      NoHitWave: () => tally.cleanWaves,
      Streak: () => tally.bestStreak,
      OwnBlast: () => tally.blastKills,
      OpenedRoom: () => tally.roomsOpened,
      LitFire: () => tally.firesLit,
      KeyFromMarked: () => tally.markedKeys,
      Delivered: () => tally.delivered,
      KitchenKills: () => tally.kitchenKills,
      KitchenStandKills: () => tally.kitchenStandKills,
    }),
  ),
)

const isFeatDone: {
  (feat: Feat): (tally: FeatTally) => boolean
  (tally: FeatTally, feat: Feat): boolean
} = Function.dual(
  2,
  (tally: FeatTally, feat: Feat): boolean =>
    progressOf(tally, feat) >= goalOf(feat),
)

// NOTE: whether the seat at `slot` has done `feat` this run.
export const hasDone: {
  (slot: PlayerSlot, feat: Feat): (world: World) => boolean
  (world: World, slot: PlayerSlot, feat: Feat): boolean
} = Function.dual(3, (world: World, slot: PlayerSlot, feat: Feat): boolean =>
  isFeatDone(seatStateAt(world, slot).feats, feat),
)

// NOTE: something a feat opens for a player who has not done it yet, and
// where its lock hangs.
export type FeatLock = Readonly<{ feat: Feat; spot: Vector }>

// THE TALLY

const ARMAMENT_OF: Readonly<Record<KillSource, Option.Option<Armament>>> = {
  Pistol: Option.some('Pistol'),
  Shotgun: Option.some('Shotgun'),
  Smg: Option.some('Smg'),
  Peashooter: Option.some('Peashooter'),
  Cooker: Option.some('Cooker'),
  Pan: Option.some('Pan'),
  Freeze: Option.some('Freeze'),
  Knife: Option.some('Knife'),
  Fire: Option.some('Fire'),
  Rifle: Option.some('Rifle'),
  Blunderbuss: Option.some('Blunderbuss'),
  Blast: Option.none(),
  Other: Option.none(),
}

type Kill = typeof GameEvent.ZombieKilled.Type

// NOTE: who a kill is credited to. A kill no player made (a trap, a
// shatter) is single player's own, as its pay is; in co-op it is nobody's.
const killerOf = (world: World, kill: Kill): Option.Option<PlayerSlot> =>
  isCoop(world) ? kill.maybeKiller : Option.some(SOLO_SLOT)

const countKill =
  (level: Level, isStandingInKitchen: boolean) =>
  (tally: FeatTally, kill: Kill): FeatTally =>
    modifyFields(tally, {
      kills: kills => kills + 1,
      killsWith: counts =>
        Option.match(ARMAMENT_OF[kill.source], {
          onNone: () => counts,
          onSome: armament => ({
            ...counts,
            [armament]: counts[armament] + 1,
          }),
        }),
      killsOf: counts => ({ ...counts, [kill.kind]: counts[kill.kind] + 1 }),
      streak: streak => streak + 1,
      bestStreak: best => Math.max(best, tally.streak + 1),
      blastKills: count => (kill.source === 'Blast' ? count + 1 : count),
      kitchenKills: count => (isInKitchenAt(level, kill) ? count + 1 : count),
      kitchenStandKills: count => (isStandingInKitchen ? count + 1 : count),
    })

const isHolding = Purchase.isAnyOf(['Holding'])

// NOTE: a seat bought a room open this tick: its hold at boards finished.
const hasOpenedRoom = (before: SeatState, after: SeatState): boolean =>
  isHolding(before.purchase) &&
  Purchasable.isAnyOf(['Exit'])(before.purchase.target) &&
  Purchase.isAnyOf(['Done'])(after.purchase)

const firedLitBy = (before: World, after: World): Option.Option<PlayerSlot> =>
  GasValve.isAnyOf(['Shut'])(before.gasValve) &&
  GasValve.isAnyOf(['Lit'])(after.gasValve)
    ? Option.some(after.gasValve.owner)
    : Option.none()

const isPhase =
  (tag: 'Preparation' | 'Wave') =>
  (world: World): boolean =>
    Phase.isAnyOf([tag])(world.phase)

const isBreak = isPhase('Preparation')
const isWave = isPhase('Wave')

type Moments = Readonly<{
  waveBegan: boolean
  waveEnded: boolean
  maybeFireLighter: Option.Option<PlayerSlot>
}>

const tallySeat =
  (before: World, kills: ReadonlyArray<Kill>, moments: Moments) =>
  (world: World, slot: PlayerSlot): World => {
    const after = seatStateAt(world, slot)
    const maybeBefore = maybePlayerAt(before, slot)
    const own = Array.filter(kills, kill =>
      Option.exists(killerOf(world, kill), killer => killer === slot),
    )
    const wasHurt = Option.exists(
      maybeBefore,
      was => after.player.hp < was.player.hp,
    )
    const openedRoom = Option.exists(maybeBefore, was =>
      hasOpenedRoom(was, after),
    )
    const litFire = Option.exists(
      moments.maybeFireLighter,
      lighter => lighter === slot,
    )
    const isQuiet =
      Array.isReadonlyArrayEmpty(own) &&
      !wasHurt &&
      !openedRoom &&
      !litFire &&
      !moments.waveBegan &&
      !moments.waveEnded
    if (isQuiet) {
      return world
    }
    const level = levelOf(world)
    const killed = Array.reduce(
      own,
      after.feats,
      countKill(level, isInKitchenAt(level, after.player)),
    )
    const hurt = wasHurt
      ? modifyFields(killed, {
          streak: () => 0,
          hurtThisWave: () => true,
        })
      : killed
    const cleared =
      moments.waveEnded && !hurt.hurtThisWave
        ? modifyFields(hurt, { cleanWaves: count => count + 1 })
        : hurt
    const begun = moments.waveBegan
      ? modifyFields(cleared, {
          hurtThisWave: () => false,
          kitchenKills: () => 0,
        })
      : cleared
    const tallied = modifyFields(begun, {
      roomsOpened: count => (openedRoom ? count + 1 : count),
      firesLit: count => (litFire ? count + 1 : count),
    })
    return modifySeat(world, slot, { feats: () => tallied })
  }

// NOTE: one tick of every seat's feats, from the World before the tick and
// after it.
export const tallyFeats: {
  (after: World): (before: World) => World
  (before: World, after: World): World
} = Function.dual(2, (before: World, after: World): World => {
  const kills = Array.filter(after.frameEvents, (event): event is Kill =>
    GameEvent.isAnyOf(['ZombieKilled'])(event),
  )
  const moments: Moments = {
    waveBegan: isBreak(before) && isWave(after),
    waveEnded: isWave(before) && isBreak(after),
    maybeFireLighter: firedLitBy(before, after),
  }
  return forEachSeat(after, tallySeat(before, kills, moments))
})
