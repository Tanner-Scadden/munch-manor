import { Array, Function, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS, ZOMBIE_HIT_PULSE_MS } from '../../shared/constants'
import { creditGunKills, killerSlotOf } from '../gear/gunLevels'
import {
  type Blow,
  type Struck,
  type Swing,
  countKills,
  isInArc,
  isSmallKind,
  payStriker,
  strikeInMelee,
  swingAt,
} from '../gear/melee'
import { isAmmoFree } from '../gear/powerups'
import {
  beginReload,
  heldGun,
  heldWeapon,
  isWieldingMelee,
  magazineOf,
  mapPan,
  maybePanOf,
  spendRound,
} from '../gear/weapons'
import { findStrike, levelOf } from '../level/arena'
import {
  COOP_RULES,
  atSeat,
  creditKills,
  isFriendlyFireOn,
  modifySeat,
  payKillShared,
  payTo,
  seatStateAt,
  shooterOf,
} from '../party/party'
import type { World } from '../schema/world'
import {
  type Boosts,
  type CarriedGun,
  Charge,
  GameEvent,
  type Lob,
  type Player,
  type PlayerSlot,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from '../schema/worldSchema'
import {
  type BlastSpec,
  ZOMBIE_BLAST_TARGET,
  blastAll,
  blastTeammates,
  bountyOf,
  creditKillEvents,
  hitEvent,
  isIcedSolid,
  killEvent,
  strikeZombie,
} from '../step/combat'
import {
  OUTWARD,
  ZERO_VECTOR,
  addVectors,
  circlesOverlap,
  directionBetween,
  scaleVector,
} from '../step/geometry'
import { bodyRadiusOf, deathState, isGrounded } from '../zombies/zombies'

// The Mystery Leftovers weapons (GAME_DESIGN.md, "Mystery Leftovers"): the
// fridge's prizes, never sold. Each fires no bullets, so the step hands a
// player holding one here instead of to the gun's trigger (fire in
// src/world/step/simulation.ts):
//
// - The Pressure Cooker charges while fire is held, a dial filling over the
//   player, and throws a lid along the aim when it is let go. The lid
//   bursts where it lands or on the first zombie it meets; more charge
//   throws it farther with a bigger blast. Held past full it pops in the
//   player's hands: a shove and a lost lid. Any charge costs one lid.
// - The Clang Pan sits in the melee slot in place of the knife, drawn as
//   the knife is (F or a tap on the slot), and swings on repeat while fire
//   is held, a wide arc in front
//   with huge knockback, scaled per kind as every knockback is. It dazes
//   small zombies, which get up Winded so it cannot daze them again at
//   once, and it swats a thrown Groaner out of the air. Each swing that
//   connects dents it; fully dented it swings slower until Rattles bangs
//   it flat at the next break.
// - Brain Freeze sprays a cone of cold that stings every zombie in it for
//   a point: small zombies freeze solid, and the next hit of any kind
//   shatters one for SHATTER_SCALE times the damage (src/world/step/combat.ts), its
//   shards splashing the small zombies beside it. A Big Lug is only
//   slowed, but sprayed again while still slowed it freezes solid for a
//   moment; Uncle Chunk is only ever slowed. Eighteen charges a load,
//   reloaded like a gun's magazine.
//
// They never hurt their own player, on any setting: a lid's blast spares
// its thrower and a pop only shoves (the owner, 2026-11-02). Only the
// Friendly Fire modifier lets a lid's blast hurt teammates (MULTIPLAYER.md,
// decided row 6).

const FRIDGE_WEAPONS: ReadonlyArray<WeaponKind> = ['Cooker', 'Pan', 'Freeze']

export const isFridgeWeapon = (kind: WeaponKind): boolean =>
  Array.contains(FRIDGE_WEAPONS, kind)

export { isSmallKind }

// RULES

type CookerRules = Readonly<{
  fullMs: number
  overMs: number
  minCharge: number
  minThrowPx: number
  maxThrowPx: number
  speedPx: number
  lidRadius: number
  minRadius: number
  maxRadius: number
  minDamage: number
  maxDamage: number
  knockback: number
  popShove: number
  launchCooldownMs: number
}>

export const COOKER_RULES: CookerRules = {
  fullMs: 550,
  overMs: 800,
  minCharge: 0.2,
  minThrowPx: 36,
  maxThrowPx: 130,
  speedPx: 210,
  lidRadius: 3,
  minRadius: 16,
  maxRadius: 30,
  minDamage: 3,
  maxDamage: 9,
  knockback: 240,
  popShove: 150,
  launchCooldownMs: 250,
}

// NOTE: tier 1 (Beefy) blasts bigger, tier 2 (DELUXE) charges faster, and
// tier 3 (3000) carries more lids (its magazine, in src/world/gear/weapons.ts).
type CookerTier = Readonly<{ blastScale: number; fullMs: number }>

const COOKER_TIERS: Array.NonEmptyReadonlyArray<CookerTier> = [
  { blastScale: 1, fullMs: COOKER_RULES.fullMs },
  { blastScale: 1.3, fullMs: COOKER_RULES.fullMs },
  { blastScale: 1.3, fullMs: 400 },
  { blastScale: 1.3, fullMs: 400 },
]

const cookerTier = (tier: number): CookerTier =>
  Option.getOrElse(Array.get(COOKER_TIERS, tier), () => COOKER_TIERS[0])

type PanRules = Readonly<{
  swingMs: number
  dentedSwingMs: number
  reachPx: number
  halfArc: number
  wideHalfArc: number
  damage: number
  knockback: number
  dazeMs: number
  swatKnockback: number
  smashHoldMs: number
  smashRadius: number
  smashDamage: number
  smashKnockback: number
}>

// NOTE: tier 1 (Beefy) swings wider, tier 2 (DELUXE) dents half as fast
// (a magazine twice as deep, in src/world/gear/weapons.ts), and tier 3 (3000) turns a
// long hold into an overhead ground smash all round.
export const PAN_RULES: PanRules = {
  swingMs: 450,
  dentedSwingMs: 720,
  reachPx: 20,
  halfArc: 1.05,
  wideHalfArc: 1.45,
  damage: 3,
  knockback: 280,
  dazeMs: 700,
  swatKnockback: 520,
  smashHoldMs: 1800,
  smashRadius: 30,
  smashDamage: 4,
  smashKnockback: 300,
}

export const SMASH_TIER = 3

type FreezeRules = Readonly<{
  intervalMs: number
  reachPx: number
  halfArc: number
  damage: number
  frozenMs: number
  lugFrozenMs: number
  chillMs: number
  chillPace: number
  splashShare: number
  splashPx: number
  splashKnockback: number
}>

// NOTE: splashShare of a shattering hit's damage reaches the small zombies
// within splashPx of the one that shattered.
export const FREEZE_RULES: FreezeRules = {
  intervalMs: 600,
  reachPx: 75,
  halfArc: 0.5,
  damage: 1,
  frozenMs: 2500,
  lugFrozenMs: 1500,
  chillMs: 2500,
  chillPace: 0.5,
  splashShare: 0.5,
  splashPx: 20,
  splashKnockback: 120,
}

// NOTE: a Chilled zombie walks at this share of its pace.
export const chillPace = (zombie: Zombie): number =>
  ZombieAction.isAnyOf(['Chilled'])(zombie.action) ? FREEZE_RULES.chillPace : 1

// HELPERS

const withPlayer = (
  world: World,
  slot: PlayerSlot,
  change: (player: Player) => Player,
): World => modifySeat(world, slot, { player: change })

const withEvents = (world: World, events: ReadonlyArray<GameEvent>): World =>
  Array.isReadonlyArrayEmpty(events)
    ? world
    : modifyFields(world, {
        frameEvents: frameEvents => [...frameEvents, ...events],
      })

const startReload = (world: World, slot: PlayerSlot): World => {
  const { player: held } = seatStateAt(world, slot)
  return withEvents(
    withPlayer(world, slot, player =>
      beginReload(
        modifyFields(player, {
          fireCooldownMs: () => 0,
          charge: () => Charge.Idle(),
        }),
      ),
    ),
    [
      GameEvent.ReloadStarted({
        x: held.x,
        y: held.y,
        direction: held.facing,
        weapon: heldWeapon(held.arsenal),
      }),
    ],
  )
}

const coolDown = (player: Player, deltaMs: number): Player =>
  modifyFields(player, {
    fireCooldownMs: cooldown => Math.max(0, cooldown - deltaMs),
  })

// THE PRESSURE COOKER

export const cookerFullMs = (tier: number): number => cookerTier(tier).fullMs

// NOTE: how full the dial is, from 0 to 1, and past 1 while it is held
// over full, up to the pop.
export const chargeOf = (player: Player): number =>
  Charge.match(player.charge, {
    Idle: () => 0,
    Building: ({ heldMs }) =>
      heldMs / cookerFullMs(heldGun(player.arsenal).tier),
    Spent: () => 0,
  })

const throwCharge = (heldMs: number, tier: number): number =>
  Math.max(COOKER_RULES.minCharge, Math.min(1, heldMs / cookerFullMs(tier)))

const lerp = (from: number, to: number, share: number): number =>
  from + (to - from) * share

export const lidBlastRadius: {
  (tier: number): (charge: number) => number
  (charge: number, tier: number): number
} = Function.dual(
  2,
  (charge: number, tier: number): number =>
    lerp(COOKER_RULES.minRadius, COOKER_RULES.maxRadius, charge) *
    cookerTier(tier).blastScale,
)

const lidDamage = (charge: number): number =>
  Math.round(lerp(COOKER_RULES.minDamage, COOKER_RULES.maxDamage, charge))

const spendLid = (boosts: Boosts, player: Player): Player =>
  isAmmoFree(boosts) ? player : spendRound(player)

const launch = (
  world: World,
  slot: PlayerSlot,
  spare: CarriedGun,
  heldMs: number,
  aim: Vector,
): World => {
  const { player, boosts } = seatStateAt(world, slot)
  const charge = throwCharge(heldMs, spare.tier)
  const from = addVectors(
    player,
    scaleVector(aim, COOKER_RULES.lidRadius + PLAYER_RADIUS),
  )
  const reach = addVectors(
    from,
    scaleVector(
      aim,
      lerp(COOKER_RULES.minThrowPx, COOKER_RULES.maxThrowPx, charge),
    ),
  )
  const to = Option.getOrElse(
    findStrike(levelOf(world), from, reach),
    () => reach,
  )
  const durationMs = Math.max(
    1,
    (Math.hypot(to.x - from.x, to.y - from.y) / COOKER_RULES.speedPx) * 1000,
  )
  const lob: Lob = {
    id: world.nextEntityId,
    x: from.x,
    y: from.y,
    from,
    to,
    remainingMs: durationMs,
    durationMs,
    charge,
    tier: spare.tier,
  }
  const thrown = Option.match(shooterOf(world, slot), {
    onNone: () => lob,
    onSome: shooter => ({ ...lob, shooter }),
  })
  return withEvents(
    modifyFields(world, {
      lobs: lobs => [...lobs, thrown],
      nextEntityId: id => id + 1,
      seats: atSeat(slot, {
        player: current =>
          spendLid(
            boosts,
            modifyFields(current, {
              charge: () => Charge.Idle(),
              fireCooldownMs: () => COOKER_RULES.launchCooldownMs,
              recoilRemainingMs: () => 180,
            }),
          ),
      }),
    }),
    [GameEvent.LidLaunched({ x: from.x, y: from.y, direction: aim })],
  )
}

// NOTE: held past full, the lid blows off in the player's hands: it shoves
// them back, the lid is lost, and nothing builds until fire is let go. It
// never hurts, on any setting (the owner, 2026-11-02).
const pop = (world: World, slot: PlayerSlot): World => {
  const { player, boosts } = seatStateAt(world, slot)
  const back = scaleVector(player.facing, -1)
  const shoved = modifyFields(player, {
    charge: () => Charge.Spent(),
    knockback: knockback =>
      addVectors(knockback, scaleVector(back, COOKER_RULES.popShove)),
    recoilRemainingMs: () => 240,
  })
  return withEvents(
    modifySeat(world, slot, { player: () => spendLid(boosts, shoved) }),
    [GameEvent.CookerPopped({ x: player.x, y: player.y, direction: back })],
  )
}

const fireCooker = (
  world: World,
  slot: PlayerSlot,
  spare: CarriedGun,
  deltaMs: number,
): World => {
  const cooled = withPlayer(world, slot, player => coolDown(player, deltaMs))
  const { player, intent } = seatStateAt(cooled, slot)
  const isHeld = intent.trigger === 'Held'
  return Charge.match(player.charge, {
    Spent: () =>
      isHeld
        ? cooled
        : withPlayer(cooled, slot, current =>
            modifyFields(current, { charge: () => Charge.Idle() }),
          ),
    Idle: () => {
      if (!isHeld || player.fireCooldownMs > 0) {
        return cooled
      } else if (spare.loaded > 0) {
        return withPlayer(cooled, slot, current =>
          modifyFields(current, {
            charge: () =>
              Charge.Building({ heldMs: deltaMs, aim: current.facing }),
          }),
        )
      } else {
        return startReload(cooled, slot)
      }
    },
    Building: ({ heldMs, aim }) => {
      if (!isHeld) {
        return launch(cooled, slot, spare, heldMs, aim)
      }
      const nextMs = heldMs + deltaMs
      return nextMs >= cookerFullMs(spare.tier) + COOKER_RULES.overMs
        ? pop(cooled, slot)
        : withPlayer(cooled, slot, current =>
            modifyFields(current, {
              charge: () =>
                Charge.Building({ heldMs: nextMs, aim: current.facing }),
            }),
          )
    },
  })
}

// THE LIDS

const lidAt = (lob: Lob, remainingMs: number): Vector => {
  const share = 1 - Math.max(0, remainingMs) / Math.max(1, lob.durationMs)
  return {
    x: lerp(lob.from.x, lob.to.x, share),
    y: lerp(lob.from.y, lob.to.y, share),
  }
}

const isLidOn =
  (at: Vector) =>
  (zombie: Zombie): boolean =>
    isGrounded(zombie) &&
    circlesOverlap(at, COOKER_RULES.lidRadius, zombie, bodyRadiusOf(zombie))

// NOTE: who a lid's blast hurts: with the Friendly Fire modifier on, every
// standing teammate it reaches, and never its own thrower. Otherwise no
// player, on any difficulty (the owner, 2026-11-02: "Let's get rid of team
// damage on nightmare"). No shooter is single player, whose one player
// threw it, so no one else is there to hurt.
const scorchPlayers = (
  world: World,
  maybeShooter: Option.Option<PlayerSlot>,
  blast: BlastSpec,
): World =>
  isFriendlyFireOn(world)
    ? Option.match(maybeShooter, {
        onNone: () => world,
        onSome: slot => blastTeammates(world, slot, blast),
      })
    : world

const lidBlast = (world: World, lob: Lob, at: Vector): World => {
  const blast: BlastSpec = {
    x: at.x,
    y: at.y,
    radius: lidBlastRadius(lob.charge, lob.tier),
    playerDamage: COOP_RULES.friendlyFireDamage,
    zombieDamage: lidDamage(lob.charge),
    trapDamage: 0,
    knockback: COOKER_RULES.knockback,
  }
  const zombieOutcome = blastAll(blast, world.zombies, ZOMBIE_BLAST_TARGET)
  const maybeShooter = Option.fromNullishOr(lob.shooter)
  const zombieEvents = creditKillEvents(
    zombieOutcome.events,
    maybeShooter,
    'Cooker',
  )
  const struck = modifyFields(world, {
    zombies: () => zombieOutcome.targets,
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.LidBlasted({ x: at.x, y: at.y, radius: blast.radius }),
      ...zombieEvents,
    ],
  })
  const paid = payTo(
    struck,
    maybeShooter,
    bountyOf(levelOf(world), zombieEvents),
  )
  const credited = creditGunKills(
    Option.match(maybeShooter, {
      onNone: () => paid,
      onSome: slot => creditKills(paid, slot, countKills(zombieEvents)),
    }),
    killerSlotOf(paid, maybeShooter),
    'Cooker',
    countKills(zombieEvents),
  )
  return scorchPlayers(credited, maybeShooter, blast)
}

// NOTE: each lid flies on toward where it was thrown and bursts there, or
// on the first grounded zombie it touches on the way.
export const advanceLobs: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World => {
  if (Array.isReadonlyArrayEmpty(world.lobs)) {
    return world
  }
  const flights = Array.map(world.lobs, lob => {
    const remainingMs = lob.remainingMs - deltaMs
    const at = lidAt(lob, remainingMs)
    const isBursting =
      remainingMs <= 0 || Array.some(world.zombies, isLidOn(at))
    return { lob, at, remainingMs, isBursting }
  })
  const flying = Array.filterMap(
    flights,
    ({ lob, at, remainingMs, isBursting }) =>
      isBursting
        ? Result.failVoid
        : Result.succeed(
            modifyFields(lob, {
              x: () => at.x,
              y: () => at.y,
              remainingMs: () => remainingMs,
            }),
          ),
  )
  const landed: World = modifyFields(world, { lobs: () => flying })
  return Array.reduce(
    Array.filter(flights, ({ isBursting }) => isBursting),
    landed,
    (current: World, { lob, at }) => lidBlast(current, lob, at),
  )
})

// THE CLANG PAN

const panHalfArc = (tier: number): number =>
  tier >= 1 ? PAN_RULES.wideHalfArc : PAN_RULES.halfArc

const isFlying = ZombieAction.isAnyOf(['Flying'])

const isSteadied = ZombieAction.isAnyOf(['Winded', 'Reeling', 'Dazed'])

const panBlow = (damage: number, knockback: number): Blow => ({
  damage,
  knockback,
  maybeDazeMs: Option.some(PAN_RULES.dazeMs),
  struck: (at, direction) =>
    GameEvent.PanClanged({ x: at.x, y: at.y, direction }),
})

// NOTE: a thrown Groaner the swing meets in the air is a home run: it is
// knocked flying back the way the Pan swung, and that is the end of it.
const swat = (player: Player, zombie: Zombie): Struck => {
  const direction = player.facing
  const struck = modifyFields(
    strikeZombie(
      zombie,
      { damage: zombie.hp, direction, knockbackSpeed: PAN_RULES.swatKnockback },
      'Shot',
    ),
    { action: () => ZombieAction.Roaming() },
  )
  return {
    zombie: struck,
    events: [
      GameEvent.HomeRun({ x: zombie.x, y: zombie.y, direction }),
      hitEvent(zombie, zombie, direction, zombie.hp),
      killEvent(struck, direction),
    ],
  }
}

const swingArc = (world: World, slot: PlayerSlot, spare: CarriedGun): Swing => {
  const { player } = seatStateAt(world, slot)
  const isClanged = isInArc(player, PAN_RULES.reachPx, panHalfArc(spare.tier))
  return swingAt(
    world.zombies,
    zombie => {
      if (isFlying(zombie.action) && isClanged(zombie)) {
        return Option.some(swat(player, zombie))
      } else if (isGrounded(zombie) && isClanged(zombie)) {
        return Option.some(
          strikeInMelee(
            player,
            zombie,
            panBlow(PAN_RULES.damage, PAN_RULES.knockback),
          ),
        )
      } else {
        return Option.none()
      }
    },
    GameEvent.PanSwung({ x: player.x, y: player.y, direction: player.facing }),
  )
}

// NOTE: the 3000's overhead smash: the Pan comes down on the floor and
// everything round the player is knocked away and dazed, the guard or not.
const smash = (world: World, slot: PlayerSlot): Swing => {
  const { player } = seatStateAt(world, slot)
  const isNear = (zombie: Zombie): boolean =>
    isGrounded(zombie) &&
    Math.hypot(zombie.x - player.x, zombie.y - player.y) -
      bodyRadiusOf(zombie) <=
      PAN_RULES.smashRadius
  const swing = swingAt(
    world.zombies,
    zombie =>
      isNear(zombie)
        ? Option.some(
            strikeInMelee(
              player,
              isSmallKind(zombie.kind) && isSteadied(zombie.action)
                ? modifyFields(zombie, {
                    action: () => ZombieAction.Roaming(),
                  })
                : zombie,
              panBlow(PAN_RULES.smashDamage, PAN_RULES.smashKnockback),
            ),
          )
        : Option.none(),
    GameEvent.PanSmashed({
      x: player.x,
      y: player.y,
      radius: PAN_RULES.smashRadius,
    }),
  )
  return { ...swing, connected: true }
}

const holdMsOf = (player: Player): number =>
  Charge.match(player.charge, {
    Idle: () => 0,
    Building: ({ heldMs }) => heldMs,
    Spent: () => 0,
  })

const isPanDented = (spare: CarriedGun): boolean => spare.loaded <= 0

const firePan = (
  world: World,
  slot: PlayerSlot,
  spare: CarriedGun,
  deltaMs: number,
): World => {
  const cooled = withPlayer(world, slot, player => coolDown(player, deltaMs))
  const { player, intent } = seatStateAt(cooled, slot)
  if (intent.trigger !== 'Held') {
    return Charge.isAnyOf(['Idle'])(player.charge)
      ? cooled
      : withPlayer(cooled, slot, current =>
          modifyFields(current, { charge: () => Charge.Idle() }),
        )
  }
  const heldMs = holdMsOf(player) + deltaMs
  if (player.fireCooldownMs > 0) {
    return withPlayer(cooled, slot, current =>
      modifyFields(current, {
        charge: () => Charge.Building({ heldMs, aim: current.facing }),
      }),
    )
  }
  const isSmash = spare.tier >= SMASH_TIER && heldMs >= PAN_RULES.smashHoldMs
  const swing = isSmash ? smash(cooled, slot) : swingArc(cooled, slot, spare)
  const struck = modifyFields(cooled, {
    zombies: () => swing.zombies,
    seats: atSeat(slot, {
      player: current =>
        modifyFields(
          swing.connected
            ? mapPan(current, pan =>
                modifyFields(pan, {
                  loaded: loaded => Math.max(0, loaded - 1),
                }),
              )
            : current,
          {
            fireCooldownMs: () =>
              isPanDented(spare) ? PAN_RULES.dentedSwingMs : PAN_RULES.swingMs,
            recoilRemainingMs: () => (isSmash ? 320 : 220),
            charge: () =>
              Charge.Building({
                heldMs: isSmash ? 0 : heldMs,
                aim: current.facing,
              }),
          },
        ),
    }),
  })
  const events = creditKillEvents(swing.events, Option.some(slot), 'Pan')
  return creditGunKills(
    payStriker(withEvents(struck, events), slot, events),
    slot,
    'Pan',
    countKills(events),
  )
}

// NOTE: Rattles bangs a Pan flat, free, when a break begins.
export const flattenPans: {
  (slot: PlayerSlot): (world: World) => World
  (world: World, slot: PlayerSlot): World
} = Function.dual(2, (world: World, slot: PlayerSlot): World => {
  const { player: held } = seatStateAt(world, slot)
  return Option.match(
    Option.filter(
      maybePanOf(held),
      pan => pan.loaded < magazineOf('Pan', pan.tier),
    ),
    {
      onNone: () => world,
      onSome: () =>
        withEvents(
          withPlayer(world, slot, player =>
            mapPan(player, pan =>
              modifyFields(pan, {
                loaded: () => magazineOf('Pan', pan.tier),
              }),
            ),
          ),
          [GameEvent.PanFlattened({ x: held.x, y: held.y })],
        ),
    },
  )
})

// BRAIN FREEZE

const isChilledNow = ZombieAction.isAnyOf(['Chilled'])

// NOTE: the big kinds a second spray freezes solid while the first still
// slows them. Uncle Chunk is not one: he is only ever slowed.
const DOUBLE_CHILL_KINDS: ReadonlyArray<ZombieKind> = ['Tank']

const iceFor = (zombie: Zombie, frozenMs: number): Zombie =>
  modifyFields(zombie, {
    action: () =>
      ZombieAction.Frozen({ remainingMs: frozenMs, durationMs: frozenMs }),
    knockback: () => ZERO_VECTOR,
  })

const freezeOne = (zombie: Zombie): Zombie => {
  if (isSmallKind(zombie.kind)) {
    return iceFor(zombie, FREEZE_RULES.frozenMs)
  } else if (
    Array.contains(DOUBLE_CHILL_KINDS, zombie.kind) &&
    isChilledNow(zombie.action)
  ) {
    return iceFor(zombie, FREEZE_RULES.lugFrozenMs)
  }
  return ZombieAction.isAnyOf(['Roaming', 'Chilled'])(zombie.action)
    ? modifyFields(zombie, {
        action: () =>
          ZombieAction.Chilled({ remainingMs: FREEZE_RULES.chillMs }),
      })
    : zombie
}

// NOTE: the spray stings each zombie in the cone for FREEZE_RULES.damage,
// then ices it. The sting is not a hit on the ice: it never shatters a
// zombie frozen solid, by this spray or an earlier one, so a sprayed
// zombie stays frozen.
const sting = (zombie: Zombie, direction: Vector): Zombie => {
  const hp = Math.max(0, zombie.hp - FREEZE_RULES.damage)
  return modifyFields(zombie, {
    hp: () => hp,
    hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
    state: state =>
      hp > 0 ? state : deathState(zombie.kind, direction, 'Shot'),
  })
}

type Sprayed = Readonly<{ zombie: Zombie; events: ReadonlyArray<GameEvent> }>

const sprayOne = (zombie: Zombie, direction: Vector): Sprayed => {
  const stung = sting(zombie, direction)
  const hit = hitEvent(zombie, zombie, direction, FREEZE_RULES.damage)
  if (stung.hp <= 0) {
    return { zombie: stung, events: [hit, killEvent(stung, direction)] }
  }
  const iced = freezeOne(stung)
  return {
    zombie: iced,
    events: isIcedSolid(iced.action)
      ? [hit, GameEvent.ZombieFrozen({ x: zombie.x, y: zombie.y })]
      : [hit],
  }
}

const spray = (world: World, slot: PlayerSlot): World => {
  const { player } = seatStateAt(world, slot)
  const isInCone = isInArc(player, FREEZE_RULES.reachPx, FREEZE_RULES.halfArc)
  const sprayed = Array.map(world.zombies, zombie =>
    isGrounded(zombie) && isInCone(zombie)
      ? sprayOne(zombie, player.facing)
      : { zombie, events: [] },
  )
  const stings = creditKillEvents(
    Array.flatMap(sprayed, ({ events }) => events),
    Option.some(slot),
    'Freeze',
  )
  const iced = withEvents(
    modifyFields(world, {
      zombies: () => Array.map(sprayed, ({ zombie }) => zombie),
      seats: atSeat(slot, {
        player: current =>
          spendRound(
            modifyFields(current, {
              fireCooldownMs: () => FREEZE_RULES.intervalMs,
              recoilRemainingMs: () => 160,
            }),
          ),
      }),
    }),
    [
      GameEvent.FreezeSprayed({
        x: player.x,
        y: player.y,
        direction: player.facing,
      }),
      ...stings,
    ],
  )
  return creditGunKills(
    payStriker(iced, slot, stings),
    slot,
    'Freeze',
    countKills(stings),
  )
}

const fireFreeze = (
  world: World,
  slot: PlayerSlot,
  spare: CarriedGun,
  deltaMs: number,
): World => {
  const cooled = withPlayer(world, slot, player => coolDown(player, deltaMs))
  const { intent, player } = seatStateAt(cooled, slot)
  if (intent.trigger !== 'Held' || player.fireCooldownMs > 0) {
    return cooled
  }
  return spare.loaded > 0 ? spray(cooled, slot) : startReload(cooled, slot)
}

// THE TRIGGER

// NOTE: the fridge weapon the player holds, if they hold one: the Cooker
// or Brain Freeze in a gun slot, or the Pan drawn from the melee slot.
export const maybeHeldFridgeWeapon = (
  player: Player,
): Option.Option<CarriedGun> =>
  isWieldingMelee(player)
    ? maybePanOf(player)
    : Option.liftPredicate(heldGun(player.arsenal), gun =>
        isFridgeWeapon(gun.kind),
      )

// NOTE: one tick of the trigger for a player holding a fridge weapon.
export const fireFridgeWeapon: {
  (
    slot: PlayerSlot,
    spare: CarriedGun,
    deltaMs: number,
  ): (world: World) => World
  (world: World, slot: PlayerSlot, spare: CarriedGun, deltaMs: number): World
} = Function.dual(
  4,
  (
    world: World,
    slot: PlayerSlot,
    spare: CarriedGun,
    deltaMs: number,
  ): World => {
    if (spare.kind === 'Cooker') {
      return fireCooker(world, slot, spare, deltaMs)
    } else if (spare.kind === 'Pan') {
      return firePan(world, slot, spare, deltaMs)
    } else {
      return fireFreeze(world, slot, spare, deltaMs)
    }
  },
)

// NOTE: a reload, a swap, or the stall lets go of the charge.
export const dropCharge = (player: Player): Player =>
  Charge.isAnyOf(['Idle'])(player.charge)
    ? player
    : modifyFields(player, { charge: () => Charge.Idle() })

// SHATTERS

type Shatter = Readonly<{ zombie: Zombie; damage: number }>

type Splashed = Readonly<{
  zombies: ReadonlyArray<Zombie>
  events: ReadonlyArray<GameEvent>
}>

const isSplashedBy =
  (source: Zombie) =>
  (zombie: Zombie): boolean =>
    zombie.id !== source.id &&
    isGrounded(zombie) &&
    isSmallKind(zombie.kind) &&
    Math.hypot(zombie.x - source.x, zombie.y - source.y) -
      bodyRadiusOf(zombie) <=
      FREEZE_RULES.splashPx

// NOTE: a shatter's shards: splashShare of the shattering hit's damage (the
// health it took, at least 1) on every other grounded small zombie within
// splashPx. One frozen solid shatters too, but its own shards go no
// further.
const splash = (splashed: Splashed, { zombie, damage }: Shatter): Splashed => {
  const shards = Math.max(1, Math.round(damage * FREEZE_RULES.splashShare))
  const isReached = isSplashedBy(zombie)
  const outcomes = Array.map(splashed.zombies, target => {
    if (!isReached(target)) {
      return { zombie: target, events: [] }
    }
    const direction = Option.getOrElse(
      directionBetween(zombie, target),
      () => OUTWARD,
    )
    const struck = strikeZombie(
      target,
      {
        damage: shards,
        direction,
        knockbackSpeed: FREEZE_RULES.splashKnockback,
      },
      'Blast',
    )
    return {
      zombie: struck,
      events: [
        hitEvent(target, target, direction, shards),
        ...(struck.hp <= 0 ? [killEvent(struck, direction)] : []),
      ],
    }
  })
  return {
    zombies: Array.map(outcomes, ({ zombie: target }) => target),
    events: [
      ...splashed.events,
      ...Array.flatMap(outcomes, ({ events }) => events),
    ],
  }
}

const shattersOf = (
  wasFrozen: ReadonlyMap<number, number>,
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Shatter> =>
  Array.filterMap(zombies, zombie => {
    const hp = wasFrozen.get(zombie.id)
    return hp !== undefined && zombie.hp < hp && !isIcedSolid(zombie.action)
      ? Result.succeed({ zombie, damage: hp - zombie.hp })
      : Result.failVoid
  })

// NOTE: a zombie that was frozen solid and has been hit since shatters into
// ice: the event the views and sounds read, and the shards that splash its
// small neighbors. Their kills have no one killer, so they pay shared, as a
// Kaboomer's chain does.
export const resolveShatters: {
  (after: World): (before: World) => World
  (before: World, after: World): World
} = Function.dual(2, (before: World, after: World): World => {
  const wasFrozen = new Map(
    Array.filterMap(before.zombies, zombie =>
      isIcedSolid(zombie.action)
        ? Result.succeed([zombie.id, zombie.hp] as const)
        : Result.failVoid,
    ),
  )
  if (wasFrozen.size === 0) {
    return after
  }
  const shattered = shattersOf(wasFrozen, after.zombies)
  if (Array.isReadonlyArrayEmpty(shattered)) {
    return after
  }
  const splashed = Array.reduce(
    shattered,
    { zombies: after.zombies, events: [] },
    splash,
  )
  const cracks = Array.map(
    shattersOf(wasFrozen, splashed.zombies),
    ({ zombie }) =>
      GameEvent.ZombieShattered({
        x: zombie.x,
        y: zombie.y,
        kind: zombie.kind,
      }),
  )
  const bounty = bountyOf(levelOf(after), splashed.events)
  const shards = withEvents(
    modifyFields(after, { zombies: () => splashed.zombies }),
    [...cracks, ...splashed.events],
  )
  return bounty > 0 ? payKillShared(shards, bounty) : shards
})
