import { Array, Option, Result } from "effect";
import { modifyFields } from "foldkit/struct";

import { findStrike, levelOf } from "./arena";
import {
  type BlastSpec,
  ZOMBIE_BLAST_TARGET,
  blastAll,
  blastOwnSeat,
  blastPlayers,
  bountyOf,
  hitEvent,
  killEvent,
  strikeZombie,
  woundPlayer,
} from "./combat";
import { DRY_FIRE_DELAY_MS, PLAYER_RADIUS } from "./constants";
import { addVectors, circlesOverlap, scaleVector } from "./geometry";
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
} from "./melee";
import { creditKills, payTo, shooterOf } from "./party";
import { isAmmoFree } from "./powerups";
import { trapBlastTarget } from "./traps";
import {
  beginReload,
  canReload,
  handOverWhenDry,
  heldGun,
  heldWeapon,
  isWieldingMelee,
  magazineOf,
  mapPan,
  maybePanOf,
  spendRound,
} from "./weapons";
import type { World } from "./world";
import {
  type CarriedGun,
  Charge,
  GameEvent,
  type Lob,
  type Player,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieAction,
} from "./worldSchema";
import { bodyRadiusOf, isGrounded } from "./zombies";

// The Mystery Leftovers weapons (GAME_DESIGN.md, "Mystery Leftovers"): the
// fridge's prizes, never sold. Each fires no bullets, so the step hands a
// player holding one here instead of to the gun's trigger (fire in
// src/simulation.ts):
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
// - Brain Freeze sprays a cone of cold: small zombies freeze solid, and the
//   next hit of any kind shatters one for SHATTER_SCALE times the damage
//   (src/combat.ts). Big Lugs and Uncle Chunk are only slowed. Twelve
//   charges, never refilled.
//
// Below Nightmare they hurt only zombies. On Nightmare a lid's blast, and a
// lid popping in the hands, hurt their thrower too, never a teammate
// (MULTIPLAYER.md, decided row 6).

const FRIDGE_WEAPONS: ReadonlyArray<WeaponKind> = ["Cooker", "Pan", "Freeze"];

export const isFridgeWeapon = (kind: WeaponKind): boolean =>
  Array.contains(FRIDGE_WEAPONS, kind);

export { isSmallKind };

const isNightmare = (world: World): boolean =>
  world.difficulty.chosen === "Nightmare";

// RULES

type CookerRules = Readonly<{
  fullMs: number;
  overMs: number;
  minCharge: number;
  minThrowPx: number;
  maxThrowPx: number;
  speedPx: number;
  lidRadius: number;
  minRadius: number;
  maxRadius: number;
  minDamage: number;
  maxDamage: number;
  knockback: number;
  popShove: number;
  popDamage: number;
  nightmareDamage: number;
  launchCooldownMs: number;
}>;

export const COOKER_RULES: CookerRules = {
  fullMs: 900,
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
  popDamage: 1,
  nightmareDamage: 1,
  launchCooldownMs: 250,
};

// NOTE: tier 1 (Beefy) blasts bigger, tier 2 (DELUXE) charges faster, and
// tier 3 (3000) carries more lids (its magazine, in src/weapons.ts).
type CookerTier = Readonly<{ blastScale: number; fullMs: number }>;

const COOKER_TIERS: Array.NonEmptyReadonlyArray<CookerTier> = [
  { blastScale: 1, fullMs: COOKER_RULES.fullMs },
  { blastScale: 1.3, fullMs: COOKER_RULES.fullMs },
  { blastScale: 1.3, fullMs: 600 },
  { blastScale: 1.3, fullMs: 600 },
];

const cookerTier = (tier: number): CookerTier =>
  Option.getOrElse(Array.get(COOKER_TIERS, tier), () => COOKER_TIERS[0]);

type PanRules = Readonly<{
  swingMs: number;
  dentedSwingMs: number;
  reachPx: number;
  halfArc: number;
  wideHalfArc: number;
  damage: number;
  knockback: number;
  dazeMs: number;
  swatKnockback: number;
  smashHoldMs: number;
  smashRadius: number;
  smashDamage: number;
  smashKnockback: number;
}>;

// NOTE: tier 1 (Beefy) swings wider, tier 2 (DELUXE) dents half as fast
// (a magazine twice as deep, in src/weapons.ts), and tier 3 (3000) turns a
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
};

export const SMASH_TIER = 3;

type FreezeRules = Readonly<{
  intervalMs: number;
  reachPx: number;
  halfArc: number;
  frozenMs: number;
  chillMs: number;
  chillPace: number;
}>;

export const FREEZE_RULES: FreezeRules = {
  intervalMs: 600,
  reachPx: 60,
  halfArc: 0.5,
  frozenMs: 2500,
  chillMs: 2500,
  chillPace: 0.5,
};

// NOTE: a Chilled zombie walks at this share of its pace.
export const chillPace = (zombie: Zombie): number =>
  ZombieAction.isAnyOf(["Chilled"])(zombie.action) ? FREEZE_RULES.chillPace : 1;

// HELPERS

const withPlayer = (world: World, change: (player: Player) => Player): World =>
  modifyFields(world, { player: change });

const withEvents = (world: World, events: ReadonlyArray<GameEvent>): World =>
  Array.isReadonlyArrayEmpty(events)
    ? world
    : modifyFields(world, {
        frameEvents: (frameEvents) => [...frameEvents, ...events],
      });

const runDry = (world: World): World =>
  withEvents(
    withPlayer(world, (player) =>
      handOverWhenDry(
        modifyFields(player, {
          fireCooldownMs: () => DRY_FIRE_DELAY_MS,
          charge: () => Charge.Idle(),
        }),
      ),
    ),
    [GameEvent.RanDry({ x: world.player.x, y: world.player.y })],
  );

const startReload = (world: World): World =>
  withEvents(
    withPlayer(world, (player) =>
      beginReload(
        modifyFields(player, {
          fireCooldownMs: () => 0,
          charge: () => Charge.Idle(),
        }),
      ),
    ),
    [
      GameEvent.ReloadStarted({
        x: world.player.x,
        y: world.player.y,
        direction: world.player.facing,
        weapon: heldWeapon(world.player.arsenal),
      }),
    ],
  );

const coolDown = (player: Player, deltaMs: number): Player =>
  modifyFields(player, {
    fireCooldownMs: (cooldown) => Math.max(0, cooldown - deltaMs),
  });

// THE PRESSURE COOKER

export const cookerFullMs = (tier: number): number => cookerTier(tier).fullMs;

// NOTE: how full the dial is, from 0 to 1, and past 1 while it is held
// over full, up to the pop.
export const chargeOf = (player: Player): number =>
  Charge.match(player.charge, {
    Idle: () => 0,
    Building: ({ heldMs }) =>
      heldMs / cookerFullMs(heldGun(player.arsenal).tier),
    Spent: () => 0,
  });

const throwCharge = (heldMs: number, tier: number): number =>
  Math.max(COOKER_RULES.minCharge, Math.min(1, heldMs / cookerFullMs(tier)));

const lerp = (from: number, to: number, share: number): number =>
  from + (to - from) * share;

export const lidBlastRadius = (charge: number, tier: number): number =>
  lerp(COOKER_RULES.minRadius, COOKER_RULES.maxRadius, charge) *
  cookerTier(tier).blastScale;

const lidDamage = (charge: number): number =>
  Math.round(lerp(COOKER_RULES.minDamage, COOKER_RULES.maxDamage, charge));

const spendLid = (world: World, player: Player): Player =>
  isAmmoFree(world.boosts) ? player : spendRound(player);

const launch = (
  world: World,
  spare: CarriedGun,
  heldMs: number,
  aim: Vector,
): World => {
  const { player } = world;
  const charge = throwCharge(heldMs, spare.tier);
  const from = addVectors(
    player,
    scaleVector(aim, COOKER_RULES.lidRadius + PLAYER_RADIUS),
  );
  const reach = addVectors(
    from,
    scaleVector(
      aim,
      lerp(COOKER_RULES.minThrowPx, COOKER_RULES.maxThrowPx, charge),
    ),
  );
  const to = Option.getOrElse(
    findStrike(levelOf(world), from, reach),
    () => reach,
  );
  const durationMs = Math.max(
    1,
    (Math.hypot(to.x - from.x, to.y - from.y) / COOKER_RULES.speedPx) * 1000,
  );
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
  };
  const thrown = Option.match(shooterOf(world), {
    onNone: () => lob,
    onSome: (shooter) => ({ ...lob, shooter }),
  });
  return withEvents(
    modifyFields(world, {
      lobs: (lobs) => [...lobs, thrown],
      nextEntityId: (id) => id + 1,
      player: (current) =>
        spendLid(
          world,
          modifyFields(current, {
            charge: () => Charge.Idle(),
            fireCooldownMs: () => COOKER_RULES.launchCooldownMs,
            recoilRemainingMs: () => 180,
          }),
        ),
    }),
    [GameEvent.LidLaunched({ x: from.x, y: from.y, direction: aim })],
  );
};

// NOTE: held past full, the lid blows off in the player's hands: it shoves
// them back, the lid is lost, and nothing builds until fire is let go. It
// hurts only on Nightmare.
const pop = (world: World): World => {
  const { player } = world;
  const back = scaleVector(player.facing, -1);
  const shoved = modifyFields(player, {
    charge: () => Charge.Spent(),
    knockback: (knockback) =>
      addVectors(knockback, scaleVector(back, COOKER_RULES.popShove)),
    recoilRemainingMs: () => 240,
  });
  const hurt =
    isNightmare(world) && player.invulnerability._tag === "Vulnerable"
      ? woundPlayer(shoved, COOKER_RULES.popDamage, back)
      : shoved;
  return withEvents(
    modifyFields(world, { player: () => spendLid(world, hurt) }),
    [GameEvent.CookerPopped({ x: player.x, y: player.y, direction: back })],
  );
};

const fireCooker = (
  world: World,
  spare: CarriedGun,
  deltaMs: number,
): World => {
  const cooled = withPlayer(world, (player) => coolDown(player, deltaMs));
  const { player, intent } = cooled;
  const isHeld = intent.trigger === "Held";
  return Charge.match(player.charge, {
    Spent: () =>
      isHeld
        ? cooled
        : withPlayer(cooled, (current) =>
            modifyFields(current, { charge: () => Charge.Idle() }),
          ),
    Idle: () => {
      if (!isHeld || player.fireCooldownMs > 0) {
        return cooled;
      } else if (spare.loaded > 0) {
        return withPlayer(cooled, (current) =>
          modifyFields(current, {
            charge: () =>
              Charge.Building({ heldMs: deltaMs, aim: current.facing }),
          }),
        );
      } else if (canReload(player)) {
        return startReload(cooled);
      } else {
        return runDry(cooled);
      }
    },
    Building: ({ heldMs, aim }) => {
      if (!isHeld) {
        return launch(cooled, spare, heldMs, aim);
      }
      const nextMs = heldMs + deltaMs;
      return nextMs >= cookerFullMs(spare.tier) + COOKER_RULES.overMs
        ? pop(cooled)
        : withPlayer(cooled, (current) =>
            modifyFields(current, {
              charge: () =>
                Charge.Building({ heldMs: nextMs, aim: current.facing }),
            }),
          );
    },
  });
};

// THE LIDS

const lidAt = (lob: Lob, remainingMs: number): Vector => {
  const share = 1 - Math.max(0, remainingMs) / Math.max(1, lob.durationMs);
  return {
    x: lerp(lob.from.x, lob.to.x, share),
    y: lerp(lob.from.y, lob.to.y, share),
  };
};

const isLidOn =
  (at: Vector) =>
  (zombie: Zombie): boolean =>
    isGrounded(zombie) &&
    circlesOverlap(at, COOKER_RULES.lidRadius, zombie, bodyRadiusOf(zombie));

const lidBlast = (world: World, lob: Lob, at: Vector): World => {
  const blast: BlastSpec = {
    x: at.x,
    y: at.y,
    radius: lidBlastRadius(lob.charge, lob.tier),
    playerDamage: COOKER_RULES.nightmareDamage,
    zombieDamage: lidDamage(lob.charge),
    trapDamage: 0,
    knockback: COOKER_RULES.knockback,
  };
  const zombieOutcome = blastAll(blast, world.zombies, ZOMBIE_BLAST_TARGET);
  const maybeShooter = Option.fromNullishOr(lob.shooter);
  const struck = modifyFields(world, {
    zombies: () => zombieOutcome.targets,
    frameEvents: (frameEvents) => [
      ...frameEvents,
      GameEvent.LidBlasted({ x: at.x, y: at.y, radius: blast.radius }),
      ...zombieOutcome.events,
    ],
  });
  const paid = payTo(struck, maybeShooter, bountyOf(zombieOutcome.events));
  const credited = Option.match(maybeShooter, {
    onNone: () => paid,
    onSome: (slot) => creditKills(paid, slot, countKills(zombieOutcome.events)),
  });
  if (!isNightmare(credited)) {
    return credited;
  }
  const trapOutcome = blastAll(
    { ...blast, trapDamage: lidDamage(lob.charge) },
    credited.traps,
    trapBlastTarget(levelOf(credited)),
  );
  const trapsBlasted = modifyFields(credited, {
    traps: () => trapOutcome.targets,
    frameEvents: (frameEvents) => [...frameEvents, ...trapOutcome.events],
  });
  // NOTE: no shooter is single player, whose one player threw it.
  return Option.match(maybeShooter, {
    onNone: () => blastPlayers(trapsBlasted, blast),
    onSome: (slot) => blastOwnSeat(trapsBlasted, slot, blast),
  });
};

// NOTE: each lid flies on toward where it was thrown and bursts there, or
// on the first grounded zombie it touches on the way.
export const advanceLobs = (world: World, deltaMs: number): World => {
  if (Array.isReadonlyArrayEmpty(world.lobs)) {
    return world;
  }
  const flights = Array.map(world.lobs, (lob) => {
    const remainingMs = lob.remainingMs - deltaMs;
    const at = lidAt(lob, remainingMs);
    const isBursting =
      remainingMs <= 0 || Array.some(world.zombies, isLidOn(at));
    return { lob, at, remainingMs, isBursting };
  });
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
  );
  const landed: World = modifyFields(world, { lobs: () => flying });
  return Array.reduce(
    Array.filter(flights, ({ isBursting }) => isBursting),
    landed,
    (current: World, { lob, at }) => lidBlast(current, lob, at),
  );
};

// THE CLANG PAN

const panHalfArc = (tier: number): number =>
  tier >= 1 ? PAN_RULES.wideHalfArc : PAN_RULES.halfArc;

const isFlying = ZombieAction.isAnyOf(["Flying"]);

const isSteadied = ZombieAction.isAnyOf(["Winded", "Reeling", "Dazed"]);

const panBlow = (damage: number, knockback: number): Blow => ({
  damage,
  knockback,
  maybeDazeMs: Option.some(PAN_RULES.dazeMs),
  struck: (at, direction) =>
    GameEvent.PanClanged({ x: at.x, y: at.y, direction }),
});

// NOTE: a thrown Groaner the swing meets in the air is a home run: it is
// knocked flying back the way the Pan swung, and that is the end of it.
const swat = (player: Player, zombie: Zombie): Struck => {
  const direction = player.facing;
  const struck = modifyFields(
    strikeZombie(
      zombie,
      { damage: zombie.hp, direction, knockbackSpeed: PAN_RULES.swatKnockback },
      "Shot",
    ),
    { action: () => ZombieAction.Roaming() },
  );
  return {
    zombie: struck,
    events: [
      GameEvent.HomeRun({ x: zombie.x, y: zombie.y, direction }),
      hitEvent(zombie, zombie, direction, zombie.hp),
      killEvent(struck, direction),
    ],
  };
};

const swingArc = (world: World, spare: CarriedGun): Swing => {
  const { player } = world;
  const isClanged = isInArc(player, PAN_RULES.reachPx, panHalfArc(spare.tier));
  return swingAt(
    world.zombies,
    (zombie) => {
      if (isFlying(zombie.action) && isClanged(zombie)) {
        return Option.some(swat(player, zombie));
      } else if (isGrounded(zombie) && isClanged(zombie)) {
        return Option.some(
          strikeInMelee(
            player,
            zombie,
            panBlow(PAN_RULES.damage, PAN_RULES.knockback),
          ),
        );
      } else {
        return Option.none();
      }
    },
    GameEvent.PanSwung({ x: player.x, y: player.y, direction: player.facing }),
  );
};

// NOTE: the 3000's overhead smash: the Pan comes down on the floor and
// everything round the player is knocked away and dazed, the guard or not.
const smash = (world: World): Swing => {
  const { player } = world;
  const isNear = (zombie: Zombie): boolean =>
    isGrounded(zombie) &&
    Math.hypot(zombie.x - player.x, zombie.y - player.y) -
      bodyRadiusOf(zombie) <=
      PAN_RULES.smashRadius;
  const swing = swingAt(
    world.zombies,
    (zombie) =>
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
  );
  return { ...swing, connected: true };
};

const holdMsOf = (player: Player): number =>
  Charge.match(player.charge, {
    Idle: () => 0,
    Building: ({ heldMs }) => heldMs,
    Spent: () => 0,
  });

const isPanDented = (spare: CarriedGun): boolean => spare.loaded <= 0;

const firePan = (world: World, spare: CarriedGun, deltaMs: number): World => {
  const cooled = withPlayer(world, (player) => coolDown(player, deltaMs));
  const { player, intent } = cooled;
  if (intent.trigger !== "Held") {
    return Charge.isAnyOf(["Idle"])(player.charge)
      ? cooled
      : withPlayer(cooled, (current) =>
          modifyFields(current, { charge: () => Charge.Idle() }),
        );
  }
  const heldMs = holdMsOf(player) + deltaMs;
  if (player.fireCooldownMs > 0) {
    return withPlayer(cooled, (current) =>
      modifyFields(current, {
        charge: () => Charge.Building({ heldMs, aim: current.facing }),
      }),
    );
  }
  const isSmash = spare.tier >= SMASH_TIER && heldMs >= PAN_RULES.smashHoldMs;
  const swing = isSmash ? smash(cooled) : swingArc(cooled, spare);
  const struck = modifyFields(cooled, {
    zombies: () => swing.zombies,
    player: (current) =>
      modifyFields(
        swing.connected
          ? mapPan(current, (pan) =>
              modifyFields(pan, {
                loaded: (loaded) => Math.max(0, loaded - 1),
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
  });
  return payStriker(withEvents(struck, swing.events), swing.events);
};

// NOTE: Rattles bangs every Pan flat, free, when a break begins.
export const flattenPans = (world: World): World =>
  Option.match(
    Option.filter(
      maybePanOf(world.player),
      (pan) => pan.loaded < magazineOf("Pan", pan.tier),
    ),
    {
      onNone: () => world,
      onSome: () =>
        withEvents(
          withPlayer(world, (player) =>
            mapPan(player, (pan) =>
              modifyFields(pan, {
                loaded: () => magazineOf("Pan", pan.tier),
                rounds: () => magazineOf("Pan", pan.tier),
              }),
            ),
          ),
          [GameEvent.PanFlattened({ x: world.player.x, y: world.player.y })],
        ),
    },
  );

// BRAIN FREEZE

const freezeOne = (zombie: Zombie): Zombie =>
  isSmallKind(zombie.kind)
    ? modifyFields(zombie, {
        action: () =>
          ZombieAction.Frozen({
            remainingMs: FREEZE_RULES.frozenMs,
            durationMs: FREEZE_RULES.frozenMs,
          }),
        knockback: () => ({ x: 0, y: 0 }),
      })
    : ZombieAction.isAnyOf(["Roaming", "Chilled"])(zombie.action)
      ? modifyFields(zombie, {
          action: () =>
            ZombieAction.Chilled({ remainingMs: FREEZE_RULES.chillMs }),
        })
      : zombie;

const spray = (world: World): World => {
  const { player } = world;
  const isChilled = isInArc(player, FREEZE_RULES.reachPx, FREEZE_RULES.halfArc);
  const hit = Array.map(
    world.zombies,
    (zombie) => isGrounded(zombie) && isChilled(zombie),
  );
  const frozen = Array.filter(
    world.zombies,
    (zombie, index) => hit[index] === true && isSmallKind(zombie.kind),
  );
  return withEvents(
    modifyFields(world, {
      zombies: (zombies) =>
        Array.map(zombies, (zombie, index) =>
          hit[index] === true ? freezeOne(zombie) : zombie,
        ),
      player: (current) =>
        spendRound(
          modifyFields(current, {
            fireCooldownMs: () => FREEZE_RULES.intervalMs,
            recoilRemainingMs: () => 160,
          }),
        ),
    }),
    [
      GameEvent.FreezeSprayed({
        x: player.x,
        y: player.y,
        direction: player.facing,
      }),
      ...Array.map(frozen, ({ x, y }) => GameEvent.ZombieFrozen({ x, y })),
    ],
  );
};

const fireFreeze = (
  world: World,
  spare: CarriedGun,
  deltaMs: number,
): World => {
  const cooled = withPlayer(world, (player) => coolDown(player, deltaMs));
  if (cooled.intent.trigger !== "Held" || cooled.player.fireCooldownMs > 0) {
    return cooled;
  }
  return spare.loaded > 0 ? spray(cooled) : runDry(cooled);
};

// THE TRIGGER

// NOTE: the fridge weapon the player holds, if they hold one: the Cooker
// or Brain Freeze in a gun slot, or the Pan drawn from the melee slot.
export const maybeHeldFridgeWeapon = (
  player: Player,
): Option.Option<CarriedGun> =>
  isWieldingMelee(player)
    ? maybePanOf(player)
    : Option.liftPredicate(heldGun(player.arsenal), (gun) =>
        isFridgeWeapon(gun.kind),
      );

// NOTE: one tick of the trigger for a player holding a fridge weapon.
export const fireFridgeWeapon = (
  world: World,
  spare: CarriedGun,
  deltaMs: number,
): World => {
  if (spare.kind === "Cooker") {
    return fireCooker(world, spare, deltaMs);
  } else if (spare.kind === "Pan") {
    return firePan(world, spare, deltaMs);
  } else {
    return fireFreeze(world, spare, deltaMs);
  }
};

// NOTE: a reload, a swap, or the stall lets go of the charge.
export const dropCharge = (player: Player): Player =>
  Charge.isAnyOf(["Idle"])(player.charge)
    ? player
    : modifyFields(player, { charge: () => Charge.Idle() });

// SHATTERS

// NOTE: a zombie that was frozen solid and has been hit since shatters into
// ice: the event the views and sounds read.
export const shatterEvents = (before: World, after: World): World => {
  const wasFrozen = new Map(
    Array.filterMap(before.zombies, (zombie) =>
      ZombieAction.isAnyOf(["Frozen"])(zombie.action)
        ? Result.succeed([zombie.id, zombie.hp] as const)
        : Result.failVoid,
    ),
  );
  if (wasFrozen.size === 0) {
    return after;
  }
  const shattered = Array.filterMap(after.zombies, (zombie) => {
    const hp = wasFrozen.get(zombie.id);
    return hp !== undefined &&
      zombie.hp < hp &&
      !ZombieAction.isAnyOf(["Frozen"])(zombie.action)
      ? Result.succeed(
          GameEvent.ZombieShattered({
            x: zombie.x,
            y: zombie.y,
            kind: zombie.kind,
          }),
        )
      : Result.failVoid;
  });
  return withEvents(after, shattered);
};
