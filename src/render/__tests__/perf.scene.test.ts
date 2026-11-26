import { Array, Effect, Option, Predicate, pipe } from 'effect'

import { UiStruct } from '@effect/ui'
import type { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { startOrResume } from '#app/frame/runFlow.ts'
import { Message } from '#app/message.ts'
import {
  Alarm,
  type Blast,
  BoostTimer,
  type Boosts,
  Boss,
  BossMove,
  type Bullet,
  BulletGlaze,
  type CarriedGun,
  Charge,
  ClocheLift,
  Frenzy,
  FridgeDoor,
  Glob,
  Lesson,
  type Model,
  Oven,
  ParticleKind,
  Phase,
  type Pickup,
  PickupKind,
  Pierce,
  type Popup,
  type PopupKind,
  RunMode,
  Streak,
  Trap,
  TurretGun,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { sceneShapes } from '#app/views/layers.ts'
import type * as Draw from '#render/draw.ts'
import { type Leaf, flatten } from '#render/iso/flatten.ts'
import { type Decal, DecalKind, type Particle } from '#render/renderSchema.ts'
import {
  BLAST_MAX,
  BULLET_MAX,
  DECAL_MAX,
  PARTICLE_MAX,
  POPUP_MAX,
  ZOMBIE_ALIVE_MAX,
} from '#shared/constants.ts'
import { holdingSecond } from '#test/arsenals.ts'
import {
  ackHudSlots,
  byClass,
  fromSubscription,
  measureSurfaceAs,
} from '#test/sceneTesting.ts'
import {
  type AppScene,
  CELLAR_SPOT,
  WIDE_SURFACE,
  exactSceneOf,
  jsonOf,
  scoring,
} from '#test/testing.ts'
import { asVeteran } from '#test/veteran.ts'
import { DROP_RULES } from '#world/gear/powerups.ts'
import { TRAPS as TRAP_STATS } from '#world/gear/traps.ts'
import { freshGun } from '#world/gear/weapons.ts'
import { openExitIn, startingLevelFor } from '#world/level/arena.ts'
import { KITCHEN_EXIT } from '#world/level/exits.ts'
import {
  CELLAR_ROOM_ID,
  EAST_EXIT,
  FAR_EXIT,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
  SECRET_EXIT,
  WEST_EXIT,
} from '#world/level/plan.ts'
import { DOOR_IDS } from '#world/level/tileGrid.ts'
import { modifyFocus } from '#world/party/party.ts'
import { rollSpawns } from '#world/waves/endlessWaves.ts'
import { FINAL_WAVE } from '#world/waves/wavePlans.ts'
import { BOSS_RULES } from '#world/zombies/bossRules.ts'
import { ZOMBIE_KINDS } from '#world/zombies/zombies.ts'

const cycle = <A>(items: Array.NonEmptyReadonlyArray<A>, index: number): A =>
  pipe(
    Array.get(items, index % items.length),
    Option.getOrElse(() => Array.headNonEmpty(items)),
  )

const zombieStateAt = (index: number): ZombieState => {
  if (index % 7 === 0) {
    return ZombieState.Dying({ remainingMs: 300, direction: { x: 1, y: 0 } })
  } else if (index % 5 === 0) {
    return ZombieState.Fusing({ remainingMs: 400 })
  } else {
    return ZombieState.Walking()
  }
}

const plainZombieAt =
  (wave: number) =>
  (index: number): Zombie => {
    const kind = cycle(HORDE_KINDS, index)
    return {
      id: 1000 + index,
      kind,
      x: 30 + ((index * 37) % 260),
      y: 30 + ((index * 23) % 120),
      speed: 20,
      hp: ZOMBIE_KINDS[kind].hp + wave,
      maxHp: ZOMBIE_KINDS[kind].hp * 2 + wave,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: index % 3 === 0 ? 60 : 0,
      state: zombieStateAt(index),
      action: ZombieAction.Roaming(),
      frenzy: Frenzy.Calm(),
    }
  }

const HORDE_KINDS: Array.NonEmptyReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Exploder',
  'Tank',
]

const CHUCKER_INDEX = 1
const CARRIED_INDEX = 3
const FLYING_INDEX = 8
const BURROWED_INDEX = 11
const GLOWING_INDEX = 2
const FRENZIED_INDICES: ReadonlyArray<number> = [4, 9, 12, 13, 16, 17, 19]
const FRENZY_PACK = 77

const stagedZombie = (zombie: Zombie, index: number): Zombie => {
  if (index === CHUCKER_INDEX) {
    return UiStruct.evolve(zombie, {
      kind: () => 'Thrower',
      action: () =>
        ZombieAction.Hefting({
          victimId: 1000 + CARRIED_INDEX,
          remainingMs: 300,
          durationMs: 900,
        }),
    })
  } else if (index === CARRIED_INDEX) {
    return UiStruct.evolve(zombie, {
      kind: () => 'Shambler',
      x: () => 30 + ((CHUCKER_INDEX * 37) % 260),
      y: () => 30 + ((CHUCKER_INDEX * 23) % 120),
      action: () => ZombieAction.Carried({ byId: 1000 + CHUCKER_INDEX }),
    })
  } else if (index === FLYING_INDEX) {
    return UiStruct.evolve(zombie, {
      kind: () => 'Shambler',
      action: () =>
        ZombieAction.Flying({
          from: { x: 230, y: 60 },
          to: { x: 150, y: 100 },
          remainingMs: 400,
          durationMs: 900,
        }),
    })
  } else if (index === BURROWED_INDEX) {
    return UiStruct.evolve(zombie, {
      kind: () => 'Crawler',
      action: () =>
        ZombieAction.Burrowed({ remainingMs: 100, durationMs: 1500 }),
    })
  } else if (index === GLOWING_INDEX) {
    return UiStruct.evolve(zombie, {
      x: () => 172,
      y: () => 92,
      hp: () => 1,
      maxHp: () => 3,
    })
  } else if (Array.contains(FRENZIED_INDICES, index)) {
    return UiStruct.evolve(zombie, {
      frenzy: () => Frenzy.Frenzied({ pack: FRENZY_PACK, apartMs: 0 }),
    })
  } else {
    return zombie
  }
}

const zombieAt =
  (wave: number) =>
  (index: number): Zombie =>
    stagedZombie(plainZombieAt(wave)(index), index)

const BOSS_ID = 999

const bossAt = (wave: number): Zombie => ({
  id: BOSS_ID,
  kind: 'Boss',
  x: 170,
  y: 70,
  speed: 10,
  hp: ZOMBIE_KINDS.Boss.hp * 0.3,
  maxHp: ZOMBIE_KINDS.Boss.hp + wave,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const particleAt = (index: number): Particle => ({
  kind: cycle(ParticleKind.literals, index),
  x: 20 + ((index * 13) % 280),
  y: 20 + ((index * 7) % 140),
  z: index % 4 === 0 ? 0 : 6,
  velocityX: 10,
  velocityY: -5,
  velocityZ: 20,
  size: 1 + (index % 3),
  remainingMs: 400,
})

const decalAt = (index: number): Decal => ({
  kind: cycle(DecalKind.literals, index),
  x: 24 + ((index * 31) % 272),
  y: 24 + ((index * 17) % 132),
  width: 2 + (index % 5),
  height: 1 + (index % 3),
})

const bulletAt = (index: number): Bullet => ({
  id: 5000 + index,
  x: 40 + ((index * 11) % 240),
  y: 30 + ((index * 19) % 120),
  velocityX: 200,
  velocityY: 40,
  remainingMs: 500,
  weapon: index % 2 === 0 ? 'Smg' : 'Shotgun',
  damage: 1,
  knockback: 60,
  glaze: cycle(BulletGlaze.literals, index),
  pierce: Pierce.Stops(),
})

const blastAt = (index: number): Blast => ({
  x: 60 + index * 30,
  y: 60 + (index % 3) * 20,
  radius: 18,
  ageMs: 40 + index * 20,
})

const POPUP_KINDS_IN_TURN: Array.NonEmptyReadonlyArray<PopupKind> = [
  'Damage',
  'Kill',
  'Payday',
  'Saved',
]

const popupKindAt = (index: number): PopupKind => {
  if (index === POPUP_MAX - 1) {
    return 'Horde'
  } else if (index === POPUP_MAX - 2) {
    return 'Wipe'
  } else {
    return cycle(POPUP_KINDS_IN_TURN, index)
  }
}

const popupAt = (index: number): Popup => ({
  kind: popupKindAt(index),
  value: 10 + index * 7,
  x: 40 + index * 25,
  y: 50 + (index % 4) * 15,
  velocityX: 4,
  ageMs: 100 + index * 30,
})

const TRAPS: ReadonlyArray<Trap> = [
  ...Array.map(Array.take(DOOR_IDS, 2), (door, index) =>
    Trap.Barricade({
      id: 9000 + index,
      door,
      hp: 4,
      maxHp: TRAP_STATS.Barricade.hp,
      hitRemainingMs: 0,
    }),
  ),
  Trap.Turret({
    id: 9100,
    column: 12,
    row: 6,
    hp: 5,
    maxHp: TRAP_STATS.Turret.hp,
    hitRemainingMs: 0,
    facing: { x: 1, y: 0 },
    gun: TurretGun.Armed(),
  }),
]

const pickupAt = (index: number): Pickup => ({
  id: 7000 + index,
  kind: cycle(PickupKind.literals, index * 3),
  x: 60 + index * 140,
  y: 120,
  ageMs: 8000,
})

const ALL_BOOSTED: Boosts = {
  RapidFire: BoostTimer.On({ remainingMs: 1500, durationMs: 8000 }),
  Damage: BoostTimer.On({ remainingMs: 6000, durationMs: 8000 }),
  Speed: BoostTimer.On({ remainingMs: 9000, durationMs: 10000 }),
  Pierce: BoostTimer.On({ remainingMs: 4000, durationMs: 9000 }),
}

const WORST_GLOBS: ReadonlyArray<Glob> = [
  ...Array.makeBy(BOSS_RULES.globMax - 1, index =>
    Glob.Pooled({
      at: { x: 80 + index * 40, y: 150 },
      remainingMs: 2000,
      durationMs: BOSS_RULES.puddleMs,
    }),
  ),
  Glob.Flying({
    from: { x: 170, y: 70 },
    to: { x: 120, y: 120 },
    remainingMs: 400,
    durationMs: BOSS_RULES.spitFlightMs,
  }),
]

const fullRoom = (mode: RunMode, wave: number, tier: number): Model => {
  const started = startOrResume(
    UiStruct.evolve(asVeteran(initialModel), {
      lessons: lessons =>
        UiStruct.evolve(lessons, {
          pickup: () => Lesson.Learned({ atMs: 0 }),
          swap: () => Lesson.Learned({ atMs: 0 }),
        }),
    }),
    mode,
  )
  const [rngState, spawns] = rollSpawns(started.rngState, wave)
  return modifyFocus(
    UiStruct.evolve(started, {
      rngState: () => rngState,
      maybeSurface: () => Option.some(WIDE_SURFACE),
      phase: () => Phase.Wave({ wave, elapsedMs: 30_000, spawns }),
      pacing: pacing =>
        UiStruct.evolve(pacing, {
          warnedPacks: () => Array.map(spawns, ({ pack }) => pack),
          alarm: () => Alarm.Ringing({ remainingMs: 1000 }),
        }),
      zombies: () => [
        ...Array.makeBy(ZOMBIE_ALIVE_MAX, zombieAt(wave)),
        bossAt(wave),
      ],
      boss: () =>
        Boss.Fighting({
          guestHpScale: 1,
          id: BOSS_ID,
          move: BossMove.Bracing({
            target: { x: 60, y: 140 },
            remainingMs: 400,
            durationMs: 800,
          }),
          standingMs: 4000,
          mood: 'Enraged',
          nextFar: 'Spit',
          belchMs: 0,
          globs: WORST_GLOBS,
        }),
      bullets: () => Array.makeBy(BULLET_MAX, bulletAt),
      traps: () => TRAPS,
      pickups: () => Array.makeBy(DROP_RULES.floorMax, pickupAt),
      streak: () => Streak.Hot({ count: 12, remainingMs: 900 }),
      stats: scoring(98_760),
      keys: ring => ({ ...ring, held: 99 }),
      cosmetics: UiStruct.evolve({
        particles: () => Array.makeBy(PARTICLE_MAX, particleAt),
        decals: () => Array.makeBy(DECAL_MAX, decalAt),
        blasts: () => Array.makeBy(BLAST_MAX / 2, blastAt),
        popups: () => Array.makeBy(POPUP_MAX, popupAt),
        callouts: () => [
          { kind: 'Pierce', look: 'Explained', x: 160, y: 90, ageMs: 600 },
        ],
      }),
    }),
    {
      boosts: () => ALL_BOOSTED,
      trapStock: () => ({ Barricade: 2, Turret: 1 }),
      player: player => ({
        ...player,
        arsenal: holdingSecond({ kind: 'Smg', loaded: 30, tier, kills: 0 }),
      }),
    },
  )
}

type PaintCounts = Readonly<{
  paintOps: number
  fillStyleChanges: number
  shapesPainted: number
}>

const NOTHING_PAINTED: PaintCounts = {
  paintOps: 0,
  fillStyleChanges: 0,
  shapesPainted: 0,
}

const flatImageCount = (shapes: ReadonlyArray<Draw.Shape>): number =>
  Array.reduce(
    shapes,
    0,
    (count, shape) =>
      count +
      (shape._tag === 'Image' ? 1 : 0) +
      (shape._tag === 'Group' ? flatImageCount(shape.shapes) : 0),
  )

const flatShapeCount = (shapes: ReadonlyArray<Draw.Shape>): number =>
  Array.reduce(
    shapes,
    0,
    (count, shape) =>
      count + 1 + (shape._tag === 'Group' ? flatShapeCount(shape.shapes) : 0),
  )

const fillOf = (leaf: Leaf): Option.Option<string> =>
  leaf.shape._tag === 'Image'
    ? Option.none()
    : Option.some(leaf.shape.fill ?? '')

const paintOf = (shapes: ReadonlyArray<Draw.Shape>): PaintCounts => {
  const leaves = flatten(shapes)
  const fills = Array.getSomes(Array.map(leaves, fillOf))
  const fillStyleChanges = Array.reduce(
    fills,
    { count: 0, last: '' },
    ({ count, last }, fill) => ({
      count: fill === last ? count : count + 1,
      last: fill,
    }),
  ).count
  return {
    paintOps: leaves.length,
    fillStyleChanges,
    shapesPainted: flatShapeCount(shapes),
  }
}

type OverlayShapes = ReadonlyArray<Draw.Shape>

const isOverlayPicture = (
  value: unknown,
): value is Readonly<{ shapes: OverlayShapes }> =>
  Predicate.hasProperty(value, 'shapes') && Array.isArray(value.shapes)

const overlayPictureOf = (s: AppScene): Option.Option<unknown> =>
  pipe(
    Array.head(s.all(byClass('overlay-layer'))),
    Option.flatMap((node: Locator.Node) =>
      Option.fromNullishOr(node.props?.['picture']),
    ),
  )

const paintBetween = (
  previous: Option.Option<unknown>,
  current: Option.Option<unknown>,
): PaintCounts =>
  pipe(
    current,
    Option.filter(isOverlayPicture),
    Option.filter(picture => !Option.contains(previous, picture)),
    Option.match({
      onNone: () => NOTHING_PAINTED,
      onSome: picture => paintOf(picture.shapes),
    }),
  )

type FrameCost = Readonly<{
  shapesBuilt: number
  steadyPaintOps: number
  steadyFillStyleChanges: number
  steadyShapesPainted: number
  fullRepaintPaintOps: number
}>

type Measured = FrameCost & Readonly<{ imagesBuilt: number }>

const measureFrames = Effect.fnUntraced(function* (model: Model) {
  const s = yield* exactSceneOf(model)
  s.pipe(measureSurfaceAs(WIDE_SURFACE), ackHudSlots)
  const beforeLast = overlayPictureOf(s)
  fromSubscription(
    'MouseAim',
    Message.MovedMouse({ clientX: 900, clientY: 300 }),
  )(s)
  const last = overlayPictureOf(s)
  const steady = paintBetween(beforeLast, last)
  return {
    shapesBuilt: flatShapeCount(sceneShapes(model)),
    steadyPaintOps: steady.paintOps,
    steadyFillStyleChanges: steady.fillStyleChanges,
    steadyShapesPainted: steady.shapesPainted,
    fullRepaintPaintOps: paintBetween(Option.none(), last).paintOps,
    imagesBuilt: flatImageCount(sceneShapes(model)),
  } satisfies Measured
})

const BUDGET: FrameCost = {
  shapesBuilt: 800,
  steadyPaintOps: 650,
  steadyFillStyleChanges: 500,
  steadyShapesPainted: 685,
  fullRepaintPaintOps: 1200,
}

const IMAGES_BUILT_MIN = ZOMBIE_ALIVE_MAX + 1

const BUDGET_KEYS: ReadonlyArray<keyof FrameCost> = [
  'shapesBuilt',
  'steadyPaintOps',
  'steadyFillStyleChanges',
  'steadyShapesPainted',
  'fullRepaintPaintOps',
]

const kitchenRoom = (wave: number): Model => {
  const room = fullRoom(RunMode.Campaign(), wave, 2)
  return modifyFocus(
    UiStruct.evolve(room, {
      level: level => openExitIn(level, KITCHEN_EXIT),
      ovens: ovens =>
        Array.map(ovens, () =>
          Oven.Belching({ remainingMs: 400, burnedTicks: 2 }),
        ),
      zombies: zombies =>
        Array.map(zombies, (zombie, index) =>
          index % 2 === 0
            ? UiStruct.evolve(zombie, {
                x: () => 30 + ((index * 17) % 150),
                y: () => -110 + ((index * 23) % 100),
              })
            : zombie,
        ),
    }),
    {
      player: player => UiStruct.evolve(player, { x: () => 100, y: () => -40 }),
    },
  )
}

const cellarRoom = (wave: number): Model => {
  const room = fullRoom(RunMode.Campaign(), wave, 2)
  return modifyFocus(
    UiStruct.evolve(room, {
      level: level => Array.reduce([EAST_EXIT, FAR_EXIT], level, openExitIn),
      zombies: zombies =>
        Array.map(zombies, (zombie, index) =>
          UiStruct.evolve(zombie, {
            x: () => 690 + ((index * 37) % 300),
            y: () => 25 + ((index * 23) % 145),
          }),
        ),
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          x: () => CELLAR_SPOT.x,
          y: () => CELLAR_SPOT.y,
          recoilRemainingMs: () => 40,
        }),
    },
  )
}

const rolledCellarRoom = (wave: number): Model => {
  const room = fullRoom(RunMode.Campaign(), wave, 2)
  return modifyFocus(
    UiStruct.evolve(room, {
      level: () =>
        Array.reduce(
          [KITCHEN_EXIT, WEST_EXIT, EAST_EXIT, FAR_EXIT, SECRET_EXIT],
          startingLevelFor({
            West: CELLAR_ROOM_ID,
            East: LIBRARY_ROOM_ID,
            Far: PARLOUR_ROOM_ID,
          }),
          openExitIn,
        ),
      zombies: zombies =>
        Array.map(zombies, (zombie, index) =>
          UiStruct.evolve(zombie, {
            x: () => -300 + ((index * 37) % 300),
            y: () => 65 + ((index * 23) % 145),
          }),
        ),
      cosmetics: UiStruct.evolve({
        clocheLift: () =>
          ClocheLift.Lifting({
            room: PARLOUR_ROOM_ID,
            at: { x: -10, y: 125 },
            ageMs: 500,
          }),
      }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          x: () => -40,
          y: () => 130,
          recoilRemainingMs: () => 40,
        }),
    },
  )
}

const fridgeFight = (
  room: Model,
  spare: CarriedGun,
  charge: Charge,
  recoilMs: number,
): Model =>
  modifyFocus(
    UiStruct.evolve(room, {
      fridge: fridge =>
        UiStruct.evolve(fridge, {
          door: () =>
            FridgeDoor.Open({
              prize: 'Freeze',
              slot: 0,
              remainingMs: 400,
              durationMs: 1100,
            }),
        }),
      lobs: () =>
        Array.makeBy(3, index => ({
          id: 8000 + index,
          x: 110 + index * 20,
          y: -60 - index * 10,
          from: { x: 100, y: -40 },
          to: { x: 150 + index * 10, y: -80 - index * 10 },
          remainingMs: 200,
          durationMs: 500,
          charge: 1,
          tier: 3,
        })),
      zombies: zombies =>
        Array.map(zombies, (zombie, index) =>
          index % 3 === 0 && zombie.kind !== 'Boss'
            ? UiStruct.evolve(zombie, {
                action: () =>
                  index % 2 === 0
                    ? ZombieAction.Frozen({
                        remainingMs: 2000,
                        durationMs: 2500,
                      })
                    : ZombieAction.Reeling({
                        remainingMs: 400,
                        durationMs: 700,
                      }),
              })
            : zombie,
        ),
      cosmetics: UiStruct.evolve({
        blasts: () => [{ x: 140, y: -70, radius: 34, ageMs: 60 }],
      }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          arsenal: () => holdingSecond(spare),
          charge: () => charge,
          recoilRemainingMs: () => recoilMs,
        }),
    },
  )

const SCENARIOS: ReadonlyArray<Readonly<{ name: string; model: Model }>> = [
  {
    name: 'wave 9 in the kitchen with the Cooker blasting and the fridge open',
    model: fridgeFight(
      kitchenRoom(9),
      { ...freshGun('Cooker'), tier: 3 },
      Charge.Building({ heldMs: 1200, aim: { x: 1, y: 0 } }),
      0,
    ),
  },
  {
    name: 'wave 9 in the kitchen with the Pan swinging',
    model: fridgeFight(
      kitchenRoom(9),
      { ...freshGun('Pan'), tier: 3 },
      Charge.Building({ heldMs: 900, aim: { x: 1, y: 0 } }),
      120,
    ),
  },
  {
    name: 'campaign wave 9 in the open kitchen with both ovens belching',
    model: kitchenRoom(9),
  },
  {
    name: 'campaign wave 9 in the dark cellar at the alive cap, firing',
    model: cellarRoom(9),
  },
  {
    name: 'campaign wave 9 in a rolled house, the dark cellar west, every room open',
    model: rolledCellarRoom(9),
  },
  {
    name: 'campaign wave 10 at the alive cap with the boss enraged mid-charge',
    model: fullRoom(RunMode.Campaign(), FINAL_WAVE, 0),
  },
  {
    name: 'endless wave 15 at the alive cap',
    model: fullRoom(RunMode.Endless(), 15, 3),
  },
]

describe('Frame cost', () => {
  it.effect.each(SCENARIOS)(
    '$name stays within the canvas work budget',
    ({ model }) =>
      Effect.gen(function* () {
        const measured = yield* measureFrames(model)
        const report = `measured ${jsonOf(measured)}\nbudget   ${jsonOf(BUDGET)}`
        expect(measured.fullRepaintPaintOps, report).toBeGreaterThan(0)
        Array.forEach(BUDGET_KEYS, key => {
          expect(
            measured[key],
            `${key} is over budget.\n${report}`,
          ).toBeLessThanOrEqual(BUDGET[key])
        })
      }),
  )

  it.effect.each(SCENARIOS)('$name builds its sprites as images', ({ model }) =>
    Effect.map(measureFrames(model), ({ imagesBuilt }) => {
      expect(imagesBuilt).toBeGreaterThanOrEqual(IMAGES_BUILT_MIN)
    }),
  )
})
