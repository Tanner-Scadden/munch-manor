import { Array, Function, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import { playedModifiersOf } from '../domain/onlineRun'
import {
  BLAST_FLASH_MS,
  BLAST_MAX,
  DAMAGE_POPUP_LIFETIME_MS,
  DAMAGE_POPUP_LIFT_PX,
  EMPTY_POPUP_LIFETIME_MS,
  EMPTY_POPUP_LIFT_PX,
  KILL_POPUP_LIFETIME_MS,
  KILL_POPUP_LIFT_PX,
  MS_PER_SECOND,
  PAYDAY_POPUP_LIFETIME_MS,
  PAYDAY_POPUP_LIFT_PX,
  POPUP_DRIFT_SPEED_MAX,
  POPUP_MAX,
  SHAKE_DECAY_PER_SECOND,
  SHAKE_FIRING_TRAUMA_MAX,
  SHAKE_MAX_PX,
  SHAKE_TRAUMA_BLAST,
  SHAKE_TRAUMA_BURP,
  SHAKE_TRAUMA_GRAB,
  SHAKE_TRAUMA_HURT,
  SHAKE_TRAUMA_MAX,
  STREAK_WINDOW_MS,
  TRAP_CRACK_TRAUMA,
} from '../shared/constants'
import type { Calling } from '../shared/playerData'
import { type Seeded, between, generateMany, nextRandom } from '../shared/prng'
import { TRAPS } from '../world/gear/traps'
import { WEAPONS } from '../world/gear/weapons'
import { killPayFor } from '../world/heroes/calling'
import { kitchenBounty } from '../world/kitchen/kitchenPay'
import { DOOR_OUTWARD, type Level, levelOf } from '../world/level/arena'
import { focusOf, modifyFocus } from '../world/party/party'
import type { Modifiers } from '../world/run/modifiers'
import {
  type Blast,
  GameEvent,
  type Popup,
  type PopupKind,
  type Shake,
  Streak,
  stillShake,
} from '../world/schema/worldSchema'
import { tickShownMoney } from '../world/shop/shop'
import { countWhere } from '../world/step/hitStop'
import { ZOMBIE_KINDS } from '../world/zombies/zombies'

// SHAKE

const BOSS_PART_TRAUMA = 0.35
const EXIT_SMASH_TRAUMA = 0.7
const BOSS_ROAR_TRAUMA = 0.6
const BOSS_BELCH_TRAUMA = 0.3
const BOSS_RUSH_TRAUMA = 0.2
const BOSS_RAM_TRAUMA = 0.8
const BOSS_SPIT_TRAUMA = 0.08
const GLOB_LANDED_TRAUMA = 0.15
const THROW_TRAUMA = 0.05
const LANDING_TRAUMA = 0.3
const STIR_TRAUMA = 0.05
const SURFACE_TRAUMA = 0.2
const ANKLE_TRAUMA = 0.15
const FRENZY_TRAUMA = 0.1
const FRIDGE_OPEN_TRAUMA = 0.08
const FRIDGE_SLAM_TRAUMA = 0.35
const LID_LAUNCH_TRAUMA = 0.06
const LID_BLAST_TRAUMA = 0.4
const COOKER_POP_TRAUMA = 0.3
const PAN_CLANG_TRAUMA = 0.07
const KNIFE_HIT_TRAUMA = 0.06
const PAN_SMASH_TRAUMA = 0.5
const HOME_RUN_TRAUMA = 0.25
const SHATTER_TRAUMA = 0.1
const CLUTCH_TRAUMA = 0.2

const firingTrauma = (event: GameEvent): number =>
  GameEvent.isAnyOf(['Fired'])(event) ? WEAPONS[event.weapon].shakeTrauma : 0

const eventTrauma = (event: GameEvent): number =>
  GameEvent.match(event, {
    Fired: () => 0,
    ZombieHit: () => 0,
    ZombieKilled: ({ kind }) => ZOMBIE_KINDS[kind].killTrauma,
    Exploded: () => SHAKE_TRAUMA_BLAST,
    Footfall: ({ kind, nearness }) =>
      Option.match(ZOMBIE_KINDS[kind].maybeFootfall, {
        onNone: () => 0,
        onSome: ({ trauma }) => trauma * nearness,
      }),
    PlayerHurt: () => SHAKE_TRAUMA_HURT,
    BulletStruck: () => 0,
    RanDry: () => 0,
    DryFired: () => 0,
    ReloadStarted: () => 0,
    Reloaded: () => 0,
    WaveCleared: () => 0,
    PackWarned: () => 0,
    TrapHit: () => 0,
    TrapCracked: () => TRAP_CRACK_TRAUMA,
    TrapBroken: ({ kind }) => TRAPS[kind].breakTrauma,
    PickupDropped: () => 0,
    PickupGrabbed: () => SHAKE_TRAUMA_GRAB,
    PickupFizzled: () => 0,
    BoostFaded: () => 0,
    Burped: () => SHAKE_TRAUMA_BURP,
    PartShed: ({ kind }) => (kind === 'Boss' ? BOSS_PART_TRAUMA : 0),
    BossRoared: () => BOSS_ROAR_TRAUMA,
    BossWoundUp: () => 0,
    BossStomped: () => SHAKE_TRAUMA_MAX,
    BossBelched: () => BOSS_BELCH_TRAUMA,
    BossRushed: () => BOSS_RUSH_TRAUMA,
    BossRammed: () => BOSS_RAM_TRAUMA,
    BossBonked: () => SHAKE_TRAUMA_MAX,
    BossSpat: () => BOSS_SPIT_TRAUMA,
    GlobLanded: () => GLOB_LANDED_TRAUMA,
    BossEnraged: () => BOSS_ROAR_TRAUMA,
    ZombieGrabbed: () => 0,
    ShieldRaised: () => 0,
    ZombieThrown: () => THROW_TRAUMA,
    ZombieLanded: () => LANDING_TRAUMA,
    CrawlerStirred: () => STIR_TRAUMA,
    CrawlerSurfaced: () => SURFACE_TRAUMA,
    AnklesGrabbed: () => ANKLE_TRAUMA,
    PackFrenzied: () => FRENZY_TRAUMA,
    PackWiped: () => 0,
    OvenBelched: () => SHAKE_TRAUMA_BURP,
    Purchased: () => 0,
    PurchaseRefused: () => 0,
    ExitOpened: () => EXIT_SMASH_TRAUMA,
    ChandelierFell: () => EXIT_SMASH_TRAUMA,
    FridgeOpened: () => FRIDGE_OPEN_TRAUMA,
    FridgeSlammed: () => FRIDGE_SLAM_TRAUMA,
    PrizeTaken: () => 0,
    PrizeLeft: () => 0,
    DudBurped: () => 0,
    PantryTaken: () => 0,
    LidLaunched: () => LID_LAUNCH_TRAUMA,
    LidBlasted: () => LID_BLAST_TRAUMA,
    CookerPopped: () => COOKER_POP_TRAUMA,
    PanSwung: () => 0,
    PanClanged: () => PAN_CLANG_TRAUMA,
    PanSmashed: () => PAN_SMASH_TRAUMA,
    PanFlattened: () => 0,
    KnifeStabbed: () => 0,
    KnifeHit: () => KNIFE_HIT_TRAUMA,
    HomeRun: () => HOME_RUN_TRAUMA,
    FreezeSprayed: () => 0,
    ZombieFrozen: () => 0,
    ZombieShattered: () => SHATTER_TRAUMA,
    ZombieSlipped: () => 0,
    PlayerDowned: () => SHAKE_TRAUMA_HURT,
    PlayerRevived: () => 0,
    FriendlyFire: () => SHAKE_TRAUMA_HURT,
    MedicCalled: () => 0,
    TeammateSaved: ({ clutch }) => (clutch ? CLUTCH_TRAUMA : 0),
  })

const shakeAxis = (roll: number, trauma: number): number => {
  const pixels = Math.round(SHAKE_MAX_PX * trauma * (roll * 2 - 1))
  return pixels === 0 ? 0 : pixels
}

const advanceShake = (
  shake: Shake,
  events: ReadonlyArray<GameEvent>,
  seconds: number,
  rngState: number,
): Seeded<Shake> => {
  const sumOf = (traumaOf: (event: GameEvent) => number): number =>
    Array.reduce(events, 0, (sum, event) => sum + traumaOf(event))
  const decayed = Math.max(0, shake.trauma - SHAKE_DECAY_PER_SECOND * seconds)
  const afterFiring = Math.max(
    decayed,
    Math.min(SHAKE_FIRING_TRAUMA_MAX, decayed + sumOf(firingTrauma)),
  )
  const trauma = Math.min(SHAKE_TRAUMA_MAX, afterFiring + sumOf(eventTrauma))
  if (trauma <= 0) {
    return [rngState, stillShake]
  }

  const xDraw = nextRandom(rngState)
  const yDraw = nextRandom(xDraw.nextState)
  return [
    yDraw.nextState,
    {
      trauma,
      offset: {
        x: shakeAxis(xDraw.value, trauma),
        y: shakeAxis(yDraw.value, trauma),
      },
    },
  ]
}

// POPUPS

const HORDE_POPUP_LIFETIME_MS = 1400
const HORDE_POPUP_INSET_PX = 22
const KABOOM_POPUP_LIFETIME_MS = 600
const SAVE_POPUP_LIFETIME_MS = 1300
const SAVE_POPUP_LIFT_PX = 18

export const POPUP_LIFETIME_MS: Readonly<Record<PopupKind, number>> = {
  Damage: DAMAGE_POPUP_LIFETIME_MS,
  Kill: KILL_POPUP_LIFETIME_MS,
  Payday: PAYDAY_POPUP_LIFETIME_MS,
  Empty: EMPTY_POPUP_LIFETIME_MS,
  Horde: HORDE_POPUP_LIFETIME_MS,
  Wipe: PAYDAY_POPUP_LIFETIME_MS,
  Kaboom: KABOOM_POPUP_LIFETIME_MS,
  Saved: SAVE_POPUP_LIFETIME_MS,
  Clutch: SAVE_POPUP_LIFETIME_MS,
}

const popup =
  (kind: PopupKind, value: number, x: number, y: number) =>
  (state: number): Seeded<Popup> => {
    const driftDraw = nextRandom(state)
    return [
      driftDraw.nextState,
      {
        kind,
        value,
        x,
        y,
        velocityX: between(
          driftDraw.value,
          -POPUP_DRIFT_SPEED_MAX,
          POPUP_DRIFT_SPEED_MAX,
        ),
        ageMs: 0,
      },
    ]
  }

const noPopups = (state: number): Seeded<ReadonlyArray<Popup>> => [state, []]

// NOTE: a kill's popup shows what the kill paid the player, so the Penny
// Pincher's reads 15% less (src/world/heroes/calling.ts) and a kitchen kill's a quarter
// more (src/world/kitchen/kitchenPay.ts).
const eventPopups =
  (calling: Calling, modifiers: Modifiers, level: Level) =>
  (state: number, event: GameEvent): Seeded<ReadonlyArray<Popup>> =>
    GameEvent.match(event, {
      Fired: () => noPopups(state),
      ZombieHit: ({ x, y, damage }) =>
        generateMany(
          state,
          1,
          popup('Damage', damage, x, y - DAMAGE_POPUP_LIFT_PX),
        ),
      ZombieKilled: ({ x, y, bounty }) =>
        generateMany(
          state,
          1,
          popup(
            'Kill',
            killPayFor(
              calling,
              kitchenBounty(level, { x, y }, bounty),
              modifiers,
            ),
            x,
            y - KILL_POPUP_LIFT_PX,
          ),
        ),
      Exploded: ({ x, y, radius }) =>
        generateMany(state, 1, popup('Kaboom', 0, x, y - radius * 0.6)),
      Footfall: () => noPopups(state),
      PlayerHurt: () => noPopups(state),
      BulletStruck: () => noPopups(state),
      RanDry: ({ x, y }) =>
        generateMany(state, 1, popup('Empty', 0, x, y - EMPTY_POPUP_LIFT_PX)),
      DryFired: () => noPopups(state),
      ReloadStarted: () => noPopups(state),
      Reloaded: () => noPopups(state),
      WaveCleared: ({ x, y, bonus }) =>
        generateMany(
          state,
          1,
          popup('Payday', bonus, x, y - PAYDAY_POPUP_LIFT_PX),
        ),
      PackWarned: () => noPopups(state),
      TrapHit: () => noPopups(state),
      TrapCracked: () => noPopups(state),
      TrapBroken: () => noPopups(state),
      PickupDropped: () => noPopups(state),
      PickupGrabbed: () => noPopups(state),
      PickupFizzled: () => noPopups(state),
      BoostFaded: () => noPopups(state),
      Burped: () => noPopups(state),
      PartShed: () => noPopups(state),
      BossRoared: () => noPopups(state),
      BossWoundUp: () => noPopups(state),
      BossStomped: () => noPopups(state),
      BossBelched: () => noPopups(state),
      BossRushed: () => noPopups(state),
      BossRammed: () => noPopups(state),
      BossBonked: () => noPopups(state),
      BossSpat: () => noPopups(state),
      GlobLanded: () => noPopups(state),
      BossEnraged: () => noPopups(state),
      ZombieGrabbed: () => noPopups(state),
      ShieldRaised: () => noPopups(state),
      ZombieThrown: () => noPopups(state),
      ZombieLanded: () => noPopups(state),
      CrawlerStirred: () => noPopups(state),
      CrawlerSurfaced: () => noPopups(state),
      AnklesGrabbed: () => noPopups(state),
      PackFrenzied: ({ x, y, door }) =>
        generateMany(
          state,
          1,
          popup(
            'Horde',
            0,
            x - DOOR_OUTWARD[door].x * HORDE_POPUP_INSET_PX,
            y - DOOR_OUTWARD[door].y * HORDE_POPUP_INSET_PX,
          ),
        ),
      PackWiped: ({ x, y, bonus }) =>
        generateMany(
          state,
          1,
          popup('Wipe', bonus, x, y - PAYDAY_POPUP_LIFT_PX),
        ),
      OvenBelched: () => noPopups(state),
      Purchased: () => noPopups(state),
      PurchaseRefused: () => noPopups(state),
      ExitOpened: () => noPopups(state),
      ChandelierFell: () => noPopups(state),
      FridgeOpened: () => noPopups(state),
      FridgeSlammed: () => noPopups(state),
      PrizeTaken: () => noPopups(state),
      PrizeLeft: () => noPopups(state),
      DudBurped: () => noPopups(state),
      PantryTaken: ({ x, y, cash }) =>
        cash > 0
          ? generateMany(
              state,
              1,
              popup('Payday', cash, x, y - KILL_POPUP_LIFT_PX),
            )
          : noPopups(state),
      LidLaunched: () => noPopups(state),
      LidBlasted: () => noPopups(state),
      CookerPopped: () => noPopups(state),
      PanSwung: () => noPopups(state),
      PanClanged: () => noPopups(state),
      PanSmashed: () => noPopups(state),
      PanFlattened: () => noPopups(state),
      KnifeStabbed: () => noPopups(state),
      KnifeHit: () => noPopups(state),
      HomeRun: () => noPopups(state),
      FreezeSprayed: () => noPopups(state),
      ZombieFrozen: () => noPopups(state),
      ZombieShattered: () => noPopups(state),
      ZombieSlipped: () => noPopups(state),
      PlayerDowned: () => noPopups(state),
      PlayerRevived: () => noPopups(state),
      FriendlyFire: () => noPopups(state),
      TeammateSaved: ({ x, y, clutch }) =>
        generateMany(
          state,
          1,
          popup(clutch ? 'Clutch' : 'Saved', 0, x, y - SAVE_POPUP_LIFT_PX),
        ),
      MedicCalled: () => noPopups(state),
    })

const agePopups = (
  popups: ReadonlyArray<Popup>,
  seconds: number,
  deltaMs: number,
): ReadonlyArray<Popup> =>
  Array.filterMap(popups, ({ kind, value, x, y, velocityX, ageMs }) => {
    const nextAgeMs = ageMs + deltaMs
    return nextAgeMs < POPUP_LIFETIME_MS[kind]
      ? Result.succeed({
          kind,
          value,
          x: x + velocityX * seconds,
          y,
          velocityX,
          ageMs: nextAgeMs,
        })
      : Result.failVoid
  })

// NOTE: packs that frenzy at once share one HORDE! callout, the newest, so
// a horde from every door does not stack four of them.
const keepNewestHorde = (popups: ReadonlyArray<Popup>): ReadonlyArray<Popup> =>
  Option.match(
    Array.findLastIndex(popups, ({ kind }) => kind === 'Horde'),
    {
      onNone: () => popups,
      onSome: newest =>
        Array.filter(
          popups,
          ({ kind }, index) => kind !== 'Horde' || index === newest,
        ),
    },
  )

// BLASTS

const ageBlasts = (
  blasts: ReadonlyArray<Blast>,
  deltaMs: number,
): ReadonlyArray<Blast> =>
  Array.filterMap(blasts, blast =>
    blast.ageMs + deltaMs < BLAST_FLASH_MS
      ? Result.succeed({
          x: blast.x,
          y: blast.y,
          radius: blast.radius,
          ageMs: blast.ageMs + deltaMs,
        })
      : Result.failVoid,
  )

// STREAK

const advanceStreak = (
  streak: Streak,
  kills: number,
  worldMs: number,
): Streak => {
  if (kills > 0) {
    return Streak.Hot({
      count: Streak.match(streak, {
        Cold: () => kills,
        Hot: ({ count }) => count + kills,
      }),
      remainingMs: STREAK_WINDOW_MS,
    })
  }

  return Streak.match(streak, {
    Cold: () => streak,
    Hot: ({ count, remainingMs }) =>
      remainingMs > worldMs
        ? Streak.Hot({ count, remainingMs: remainingMs - worldMs })
        : Streak.Cold(),
  })
}

// NOTE: the run's best streak, for the end card's tally.
const streakCount = (streak: Streak): number =>
  Streak.isAnyOf(['Hot'])(streak) ? streak.count : 0

// FRAME

// NOTE: a Kaboomer's burst, a Cooker lid's, and the Pan's ground smash
// each flash a ring.
const blastOf = (event: GameEvent): ReadonlyArray<Blast> =>
  GameEvent.isAnyOf(['Exploded', 'LidBlasted', 'PanSmashed'])(event)
    ? [{ x: event.x, y: event.y, radius: event.radius, ageMs: 0 }]
    : []

// NOTE: the juice runs once a frame, after the step, on the events of all
// its ticks: shake, popups, blast flashes, the streak, and the money
// count-up. `deltaMs` is the frame's real time and `worldMs` the world time
// its ticks ran.
export const advanceJuice: {
  (deltaMs: number, worldMs: number): (model: Model) => Model
  (model: Model, deltaMs: number, worldMs: number): Model
} = Function.dual(
  3,
  (model: Model, deltaMs: number, worldMs: number): Model => {
    const seconds = deltaMs / MS_PER_SECOND
    const events = model.frameEvents
    const kills = countWhere(events, GameEvent.isAnyOf(['ZombieKilled']))
    const newBlasts = Array.flatMap(events, blastOf)
    const streak = advanceStreak(model.streak, kills, worldMs)

    const [shakeState, shake] = advanceShake(
      model.shake,
      events,
      seconds,
      model.cosmeticRngState,
    )
    const [popupState, popupBatches] = Array.mapAccum(
      events,
      shakeState,
      eventPopups(
        focusOf(model).player.calling,
        playedModifiersOf(model),
        levelOf(model),
      ),
    )

    return modifyFocus(
      modifyFields(model, {
        blasts: current =>
          Array.isReadonlyArrayEmpty(current) &&
          Array.isReadonlyArrayEmpty(newBlasts)
            ? current
            : ageBlasts(
                Array.takeRight([...current, ...newBlasts], BLAST_MAX),
                deltaMs,
              ),
        shake: () => shake,
        popups: popups =>
          keepNewestHorde(
            Array.takeRight(
              [
                ...agePopups(popups, seconds, deltaMs),
                ...Array.flatten(popupBatches),
              ],
              POPUP_MAX,
            ),
          ),
        streak: () => streak,
        bestStreak: best => Math.max(best, streakCount(streak)),
        cosmeticRngState: () => popupState,
      }),
      { wallet: wallet => tickShownMoney(wallet, seconds) },
    )
  },
)
