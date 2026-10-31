import { Array, Option, pipe } from 'effect'
import type { Canvas } from 'foldkit'
import type { Html } from 'foldkit/html'
import { Subscription, given, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { DOOR_IDS, openExitIn } from './arena'
import { BOSS_RULES } from './boss'
import type { ApplicationViewBuilder } from './composition'
import {
  BLAST_MAX,
  BULLET_MAX,
  DECAL_MAX,
  PARTICLE_MAX,
  POPUP_MAX,
  ZOMBIE_ALIVE_MAX,
} from './constants'
import { rollSpawns } from './endlessWaves'
import { KITCHEN_EXIT } from './exits'
import { WARM_UP_CLASS, sceneShapes } from './layers'
import { update } from './main'
import { Message } from './message'
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
  type Decal,
  DecalKind,
  Frenzy,
  FridgeDoor,
  Glob,
  Lesson,
  type Model,
  Oven,
  type Particle,
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
  initialModel,
} from './model'
import { DROP_RULES } from './powerups'
import { startOrResume } from './runFlow'
import {
  SCENE_SUBSCRIPTIONS,
  WIDE_SURFACE,
  holdingSecond,
  measureSurfaceAs,
  scoring,
} from './testing'
import { asVeteran } from './veteran'
import { view } from './view'
import { FINAL_WAVE } from './wavePlans'
import { freshGun } from './weapons'
import { ZOMBIE_KINDS } from './zombies'

// WORST-CASE ROOMS

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

// NOTE: the worst case stages one of each new sight: a Big Leaguer heaving a
// Groaner overhead while another Groaner is in the air over its landing mark,
// an Ankle Biter about to break through the floor, a Kaboomer shot twice and
// pulsing hard beside the player, and a frenzied pack with its steam.
const stagedZombie = (zombie: Zombie, index: number): Zombie => {
  if (index === CHUCKER_INDEX) {
    return modifyFields(zombie, {
      kind: () => 'Thrower',
      action: () =>
        ZombieAction.Hefting({
          victimId: 1000 + CARRIED_INDEX,
          remainingMs: 300,
          durationMs: 900,
        }),
    })
  } else if (index === CARRIED_INDEX) {
    return modifyFields(zombie, {
      kind: () => 'Shambler',
      x: () => 30 + ((CHUCKER_INDEX * 37) % 260),
      y: () => 30 + ((CHUCKER_INDEX * 23) % 120),
      action: () => ZombieAction.Carried({ byId: 1000 + CHUCKER_INDEX }),
    })
  } else if (index === FLYING_INDEX) {
    return modifyFields(zombie, {
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
    return modifyFields(zombie, {
      kind: () => 'Crawler',
      action: () =>
        ZombieAction.Burrowed({ remainingMs: 100, durationMs: 1500 }),
    })
  } else if (index === GLOWING_INDEX) {
    return modifyFields(zombie, {
      x: () => 172,
      y: () => 92,
      hp: () => 1,
      maxHp: () => 3,
    })
  } else if (Array.contains(FRENZIED_INDICES, index)) {
    return modifyFields(zombie, {
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

// NOTE: the game keeps only the newest HORDE! callout, so the worst case has
// one of them, a pack bonus, and the other kinds in turn.
const POPUP_KINDS_IN_TURN: Array.NonEmptyReadonlyArray<PopupKind> = [
  'Damage',
  'Kill',
  'Payday',
  'Empty',
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
    Trap.Barricade({ id: 9000 + index, door, hp: 4, hitRemainingMs: 0 }),
  ),
  Trap.Turret({
    id: 9100,
    column: 12,
    row: 6,
    hp: 5,
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

// NOTE: the game never shows a glob in the air while he braces, since he waits
// for a glob to land before he winds up again. The worst case draws both
// anyway, with the most puddles, so the budget covers any frame he can make.
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

// NOTE: the room is played by a veteran who has learned every lesson, so no
// tutorial hint is drawn. The budgets were recorded without hints.
const fullRoom = (mode: RunMode, wave: number, tier: number): Model => {
  const started = startOrResume(
    modifyFields(asVeteran(initialModel), {
      lessons: lessons =>
        modifyFields(lessons, {
          pickup: () => Lesson.Learned({ atMs: 0 }),
          swap: () => Lesson.Learned({ atMs: 0 }),
        }),
    }),
    mode,
  )
  const [rngState, spawns] = rollSpawns(started.rngState, wave)
  return modifyFields(started, {
    rngState: () => rngState,
    maybeSurface: () => Option.some(WIDE_SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 30_000, spawns }),
    pacing: pacing =>
      modifyFields(pacing, {
        warnedPacks: () => Array.map(spawns, ({ pack }) => pack),
        alarm: () => Alarm.Ringing({ remainingMs: 1000 }),
      }),
    zombies: () => [
      ...Array.makeBy(ZOMBIE_ALIVE_MAX, zombieAt(wave)),
      bossAt(wave),
    ],
    boss: () =>
      Boss.Fighting({
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
    particles: () => Array.makeBy(PARTICLE_MAX, particleAt),
    decals: () => Array.makeBy(DECAL_MAX, decalAt),
    bullets: () => Array.makeBy(BULLET_MAX, bulletAt),
    blasts: () => Array.makeBy(BLAST_MAX / 2, blastAt),
    popups: () => Array.makeBy(POPUP_MAX, popupAt),
    traps: () => TRAPS,
    pickups: () => Array.makeBy(DROP_RULES.floorMax, pickupAt),
    boosts: () => ALL_BOOSTED,
    callouts: () => [
      { kind: 'Pierce', look: 'Explained', x: 160, y: 90, ageMs: 600 },
    ],
    streak: () => Streak.Hot({ count: 12, remainingMs: 900 }),
    stats: scoring(98_760),
    trapStock: () => ({ Barricade: 2, Turret: 1 }),
    wallet: wallet => ({ ...wallet, balance: 1234, shown: 1234 }),
    player: player => ({
      ...player,
      arsenal: holdingSecond({ kind: 'Smg', rounds: 300, loaded: 30, tier }),
    }),
  })
}

// COUNTING PAINTER

type PaintCounts = {
  paintOps: number
  fillStyleChanges: number
  shapesPainted: number
  imagesDrawn: number
}

const emptyCounts = (): PaintCounts => ({
  paintOps: 0,
  fillStyleChanges: 0,
  shapesPainted: 0,
  imagesDrawn: 0,
})

const countingContext = (counts: PaintCounts) => {
  const savedFills: Array<string> = []
  const state = { fill: '' }
  const paint = () => {
    counts.paintOps += 1
  }
  const ignore = () => undefined
  const drawImage = () => {
    counts.paintOps += 1
    counts.imagesDrawn += 1
  }
  return {
    get fillStyle() {
      return state.fill
    },
    set fillStyle(next: string) {
      if (next !== state.fill) {
        counts.fillStyleChanges += 1
      }
      state.fill = next
    },
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    save: () => {
      counts.shapesPainted += 1
      savedFills.push(state.fill)
    },
    restore: () => {
      state.fill = savedFills.pop() ?? state.fill
    },
    fillRect: paint,
    strokeRect: paint,
    fill: paint,
    stroke: paint,
    fillText: paint,
    strokeText: paint,
    drawImage,
    clearRect: ignore,
    beginPath: ignore,
    closePath: ignore,
    arc: ignore,
    moveTo: ignore,
    lineTo: ignore,
    quadraticCurveTo: ignore,
    bezierCurveTo: ignore,
    translate: ignore,
    rotate: ignore,
    scale: ignore,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  }
}

type CanvasNode = NonNullable<Html>

// NOTE: the sprite warm-up canvases paint once as the game loads and never
// again, so they are not part of a frame's cost.
const canvasNodes = (node: Html | string): ReadonlyArray<CanvasNode> => {
  if (node === null || typeof node === 'string') {
    return []
  } else if (node.sel?.startsWith('canvas') === true) {
    return node.data?.class?.[WARM_UP_CLASS] === true ? [] : [node]
  } else {
    return Array.flatMap(node.children ?? [], canvasNodes)
  }
}

// NOTE: Foldkit's Canvas paints from the canvas element's snabbdom insert and
// postpatch hooks, and snabbdom skips both when a render hands back the same
// VNode it rendered the time before. So a canvas whose VNode is new is one
// the browser repaints that frame, and running its insert hook against a
// counting context measures that frame's paint work through Foldkit's own
// painter.
const paintCanvases = (
  previous: ReadonlyArray<CanvasNode>,
  current: ReadonlyArray<CanvasNode>,
): PaintCounts => {
  const counts = emptyCounts()
  const context = countingContext(counts)
  Array.forEach(current, (node, index) => {
    if (Option.contains(Array.get(previous, index), node)) {
      return
    }
    const element = document.createElement('canvas')
    Object.defineProperty(element, 'getContext', { value: () => context })
    node.data?.hook?.insert?.({ ...node, elm: element })
  })
  return counts
}

const flatShapeCount = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  Array.reduce(
    shapes,
    0,
    (count, shape) =>
      count + 1 + (shape._tag === 'Group' ? flatShapeCount(shape.shapes) : 0),
  )

type FrameCost = Readonly<{
  shapesBuilt: number
  steadyPaintOps: number
  steadyFillStyleChanges: number
  steadyShapesPainted: number
  fullRepaintPaintOps: number
}>

type Measured = FrameCost & Readonly<{ steadyImagesDrawn: number }>

const measureFrames = (model: Model): Measured => {
  const renders: Array<ReadonlyArray<CanvasNode>> = []
  const recordingView = (current: Model, h: ApplicationViewBuilder) => {
    const rendered = view(current, h)
    renders.push(canvasNodes(rendered.body))
    return rendered
  }
  scene(
    { update, view: recordingView, subscriptions: SCENE_SUBSCRIPTIONS },
    given(model),
    measureSurfaceAs(WIDE_SURFACE),
    Subscription.emit(
      SCENE_SUBSCRIPTIONS.mouseAim,
      Message.MovedMouse({ clientX: 900, clientY: 300 }),
    ),
  )
  const last = Option.getOrElse(Array.last(renders), () => [])
  const beforeLast = Option.getOrElse(
    Array.get(renders, renders.length - 2),
    () => [],
  )
  const steady = paintCanvases(beforeLast, last)
  return {
    shapesBuilt: flatShapeCount(sceneShapes(model)),
    steadyPaintOps: steady.paintOps,
    steadyFillStyleChanges: steady.fillStyleChanges,
    steadyShapesPainted: steady.shapesPainted,
    fullRepaintPaintOps: paintCanvases([], last).paintOps,
    steadyImagesDrawn: steady.imagesDrawn,
  }
}

// BUDGETS

// NOTE: shapesBuilt went from 2200 to 2250 when a horde's DINNER BELL banner
// and the rattling doors joined the worst case. It went to 2450, and
// fullRepaintPaintOps from 2550 to 2750, when power-ups joined it: two pickups
// on the floor, all four boosts running, and a callout with the longest name.
// The callout is about two thirds of that and sits on the overlay canvas, so
// the steady paint budgets did not change. The boss and wear raised them
// again: the room was 2430 shapes, 1420 steady paint operations, and 2720 on
// a full repaint before. Worn sprites, gas leaks, and the red stump on a limb
// decal add about 30 shapes and 40 paint operations. Uncle Chunk adds about
// 150 shapes: his sprite is about 65 rectangles, his stomp ring 3 circles, and
// his bar about 70 more on the overlay, most of them the letters of his name.
// His far attacks did not raise them. The worst case now has him enraged and
// bracing for a charge, with a glob in the air and four puddles, instead of
// mid-stomp: 2614 shapes, 1527 steady paint operations, and 2935 on a full
// repaint before, 2628, 1554, and 2952 after. ENRAGED replaces his name on
// the bar instead of joining it, which keeps the overlay the same size.
// The Chucker, the Ankle Biter, frenzy, and the new Gasbag raised the steady
// paint budget from 1560 to 1585. The staged sights alone cost nothing net:
// an Ankle Biter under the floor is a ring and a few cracks, cheaper than the
// Big Lug it replaced, and a held or thrown Groaner draws no health bar. What
// they add is the one HORDE! callout the game allows at a time (14 paint
// operations, its letters) and a red glow and a puff of steam on each of
// the seven frenzied zombies (14). The Gasbag's sprite was redrawn so its
// glowing belly costs no more runs than the old one, and its two bubbles and
// valve spark add 3. The room measured 2656 shapes, 1577 steady paint
// operations, 1564 fill changes, 1659 shapes painted, and 2986 on a full
// repaint.
// Then drawing every fixed sprite, glyph, and baked text as one Canvas.Image
// instead of a Rect per pixel run cut the room from 2656 shapes, 1577 steady
// paint operations, and 2986 on a full repaint to 687, 543, and 1120,
// with 458 fill changes and 581 shapes painted. What is left is mostly
// particles, decals, bars, and shadows, which change every frame.
const BUDGET: FrameCost = {
  shapesBuilt: 740,
  steadyPaintOps: 590,
  steadyFillStyleChanges: 500,
  steadyShapesPainted: 630,
  fullRepaintPaintOps: 1200,
}

// NOTE: happy-dom loads a data URL image as soon as its src is set, so every
// sprite image here is drawn. If none were, the paint budgets above would pass
// without measuring the sprites at all.
const IMAGES_DRAWN_MIN = ZOMBIE_ALIVE_MAX + 1

const BUDGET_KEYS: ReadonlyArray<keyof FrameCost> = [
  'shapesBuilt',
  'steadyPaintOps',
  'steadyFillStyleChanges',
  'steadyShapesPainted',
  'fullRepaintPaintOps',
]

// NOTE: the kitchen open with both ovens belching, the player up in it, and
// half the crowd moved up beside the player. The other half stays down in
// the parlour, out of the camera's view, where it is culled from drawing.
const kitchenRoom = (wave: number): Model => {
  const room = fullRoom(RunMode.Campaign(), wave, 2)
  return modifyFields(room, {
    level: level => openExitIn(level, KITCHEN_EXIT),
    ovens: ovens =>
      Array.map(ovens, () =>
        Oven.Belching({ remainingMs: 400, burnedTicks: 2 }),
      ),
    player: player => modifyFields(player, { x: () => 100, y: () => -40 }),
    zombies: zombies =>
      Array.map(zombies, (zombie, index) =>
        index % 2 === 0
          ? modifyFields(zombie, {
              x: () => 30 + ((index * 17) % 150),
              y: () => -110 + ((index * 23) % 100),
            })
          : zombie,
      ),
  })
}

// NOTE: the fridge weapons at their busiest in the open kitchen: the
// Cooker held at full pressure with three lids in the air and a blast
// flashing, the fridge open with a prize flying out, and a third of the
// crowd frozen solid or reeling from the Pan.
const fridgeFight = (
  room: Model,
  spare: CarriedGun,
  charge: Charge,
  recoilMs: number,
): Model =>
  modifyFields(room, {
    player: player =>
      modifyFields(player, {
        arsenal: () => holdingSecond(spare),
        charge: () => charge,
        recoilRemainingMs: () => recoilMs,
      }),
    fridge: fridge =>
      modifyFields(fridge, {
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
    blasts: () => [{ x: 140, y: -70, radius: 34, ageMs: 60 }],
    zombies: zombies =>
      Array.map(zombies, (zombie, index) =>
        index % 3 === 0 && zombie.kind !== 'Boss'
          ? modifyFields(zombie, {
              action: () =>
                index % 2 === 0
                  ? ZombieAction.Frozen({ remainingMs: 2000, durationMs: 2500 })
                  : ZombieAction.Reeling({ remainingMs: 400, durationMs: 700 }),
            })
          : zombie,
      ),
  })

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
    name: 'campaign wave 10 at the alive cap with the boss enraged mid-charge',
    model: fullRoom(RunMode.Campaign(), FINAL_WAVE, 0),
  },
  {
    name: 'endless wave 15 at the alive cap',
    model: fullRoom(RunMode.Endless(), 15, 3),
  },
]

describe('Frame cost', () => {
  test.each(SCENARIOS)(
    '$name stays within the canvas work budget',
    ({ model }) => {
      const measured = measureFrames(model)
      const report = `measured ${JSON.stringify(measured)}\nbudget   ${JSON.stringify(BUDGET)}`
      Array.forEach(BUDGET_KEYS, key => {
        expect(
          measured[key],
          `${key} is over budget.\n${report}`,
        ).toBeLessThanOrEqual(BUDGET[key])
      })
    },
  )

  test.each(SCENARIOS)('$name draws its sprites as images', ({ model }) => {
    expect(measureFrames(model).steadyImagesDrawn).toBeGreaterThanOrEqual(
      IMAGES_DRAWN_MIN,
    )
  })
})
