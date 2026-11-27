import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { isInKitchenAt } from '#world/kitchen/kitchenKeys.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import {
  forEachSeat,
  isCoop,
  maybePlayerAt,
  modifySeat,
  seatStateAt,
} from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
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
  isHolding,
} from '#world/schema/worldSchema.ts'

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
    KitchenKills: ({ count }) => count,
    KitchenStandKills: ({ count }) => count,
  })

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

export const hasDone: {
  (slot: PlayerSlot, feat: Feat): (world: World) => boolean
  (world: World, slot: PlayerSlot, feat: Feat): boolean
} = Function.dual(3, (world: World, slot: PlayerSlot, feat: Feat): boolean =>
  isFeatDone(seatStateAt(world, slot).feats, feat),
)

export type FeatLock = Readonly<{ feat: Feat; spot: Vector }>

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

type Kill = typeof GameEvent.cases.ZombieKilled.Type

export const killerOf: {
  (kill: Kill): (world: World) => Option.Option<PlayerSlot>
  (world: World, kill: Kill): Option.Option<PlayerSlot>
} = Function.dual(2, (world: World, kill: Kill): Option.Option<PlayerSlot> =>
  isCoop(world) ? kill.maybeKiller : Option.some(SOLO_SLOT),
)

const countKill =
  (level: Level, isStandingInKitchen: boolean) =>
  (tally: FeatTally, kill: Kill): FeatTally =>
    UiStruct.evolve(tally, {
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
      ? UiStruct.evolve(killed, {
          streak: () => 0,
          hurtThisWave: () => true,
        })
      : killed
    const cleared =
      moments.waveEnded && !hurt.hurtThisWave
        ? UiStruct.evolve(hurt, { cleanWaves: count => count + 1 })
        : hurt
    const begun = moments.waveBegan
      ? UiStruct.evolve(cleared, {
          hurtThisWave: () => false,
          kitchenKills: () => 0,
        })
      : cleared
    const tallied = UiStruct.evolve(begun, {
      roomsOpened: count => (openedRoom ? count + 1 : count),
      firesLit: count => (litFire ? count + 1 : count),
    })
    return modifySeat(world, slot, { feats: () => tallied })
  }

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
