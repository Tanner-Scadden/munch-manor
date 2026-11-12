import { Array, Function, Option } from 'effect'
import { Canvas } from 'foldkit'

import {
  type Facing,
  type Sprite,
  type SpriteFrames,
  type SpriteSet,
  type Tone,
  bakeShapes,
  frameAt,
  group,
  placeAt,
} from '../art/sprite'
import {
  KABOOMER_FUSE_MAX,
  ZOMBIE_SPRITES,
  kaboomerFuseSprite,
  kaboomerFuseTip,
  wornFramesAt,
} from '../art/sprites/zombies'
import {
  ZOMBIE_DEATH_FADE_START,
  ZOMBIE_DEATH_FALL_END,
  ZOMBIE_DEATH_LANDING_END,
  ZOMBIE_DEATH_LANDING_SQUASH,
  ZOMBIE_DEATH_POP_END,
  ZOMBIE_DEATH_POP_PINCH,
  ZOMBIE_DEATH_POP_STRETCH,
  ZOMBIE_HIT_FLASH_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_HIT_SQUASH,
} from '../shared/constants'
import {
  Frenzy,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from '../world/schema/entitySchema'
import type { Boss } from '../world/schema/worldSchema'
import { clamp } from '../world/step/geometry'
import { isEnraged } from '../world/zombies/bossFight'
import { shieldAim } from '../world/zombies/chucker'
import {
  type DeathStyle,
  ZOMBIE_KINDS,
  isGrounded,
  statsOf,
  strideAt,
  wearOf,
} from '../world/zombies/zombies'
import { STANDING_POSE, bossPose } from './bossPoseView'
import {
  FULL_TURN,
  HEALTH_BAR_GAP,
  QUARTER_TURN,
  facingToward,
  footPosition,
  multiplyScales,
  progressBetween,
  squashPulse,
} from './drawing'
import { isRaging } from './frenzyView'
import { barWidthOf, healthBarShapes } from './healthBarView'
import {
  DAZE_STAR_COLOR,
  DAZE_STAR_MS,
  TAUNT_PUMP_MS,
  heftTone,
  isTauntingAt,
  placementOf,
} from './zombiePlacement'

// ZOMBIES

const zombieHitTone = (hitRemainingMs: number): Tone =>
  hitRemainingMs > 0 &&
  ZOMBIE_HIT_PULSE_MS - hitRemainingMs < ZOMBIE_HIT_FLASH_MS
    ? 'Flash'
    : 'Normal'

type Gait = Readonly<{
  leanRadians: number
  waddleRadians: number
  stompSquash: number
  fuseTellPx: number
}>

const STILL_GAIT: Gait = {
  leanRadians: 0,
  waddleRadians: 0,
  stompSquash: 0,
  fuseTellPx: 0,
}

const GAITS: Readonly<Record<ZombieKind, Gait>> = {
  Shambler: STILL_GAIT,
  Runner: { ...STILL_GAIT, leanRadians: 0.3 },
  Tank: { ...STILL_GAIT, stompSquash: 0.08 },
  Exploder: { ...STILL_GAIT, waddleRadians: 0.16, fuseTellPx: 80 },
  Thrower: { ...STILL_GAIT, waddleRadians: 0.08 },
  Crawler: { ...STILL_GAIT, waddleRadians: 0.04 },
  Boss: { ...STILL_GAIT, stompSquash: 0.06, waddleRadians: 0.05 },
}

const WEAR_WOBBLE_RADIANS = 0.05

const URGENCY_STEPS = 5
const WEAR_URGENCY = 0.35

const distanceBetween = (first: Vector, second: Vector): number =>
  Math.hypot(first.x - second.x, first.y - second.y)

// NOTE: a Kaboomer's fuse burns shorter and sparks faster as he closes in and
// each time he is shot. Urgency is stepped so the fuse drops in a few clean
// jumps instead of jittering every frame as the distance changes.
const fuseUrgency = (zombie: Zombie, player: Player, stage: number): number => {
  const tellPx = GAITS[zombie.kind].fuseTellPx
  if (tellPx <= 0) {
    return 0
  }

  const nearness = clamp(1 - distanceBetween(zombie, player) / tellPx, 0, 1)
  const urgency = clamp(nearness + WEAR_URGENCY * stage, 0, 1)
  return Math.round(urgency * URGENCY_STEPS) / URGENCY_STEPS
}

// KABOOMER FUSE

const SPARK_SLOW_MS = 180
const SPARK_FAST_MS = 50
const SPARK_FUSING_MS = 35
const SPARK_CORE_COLOR = '#fffbe6'
const SPARK_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#ffe066',
  '#ff9d2e',
  '#ffffff',
]
const SPARK_RAYS: Array.NonEmptyReadonlyArray<Vector> = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: -2 },
  { x: 2, y: -1 },
  { x: -1, y: -2 },
]

const fuseLengthAt = (urgency: number): number =>
  1 + Math.round((1 - urgency) * (KABOOMER_FUSE_MAX - 1))

const sparkMsAt = (urgency: number): number =>
  Math.round(SPARK_SLOW_MS + (SPARK_FAST_MS - SPARK_SLOW_MS) * urgency)

export const kaboomerFuseLength: {
  (player: Player): (zombie: Zombie) => number
  (zombie: Zombie, player: Player): number
} = Function.dual(2, (zombie: Zombie, player: Player): number =>
  fuseLengthAt(fuseUrgency(zombie, player, wearOf(zombie))),
)

export const kaboomerSparkMs: {
  (player: Player): (zombie: Zombie) => number
  (zombie: Zombie, player: Player): number
} = Function.dual(2, (zombie: Zombie, player: Player): number =>
  sparkMsAt(fuseUrgency(zombie, player, wearOf(zombie))),
)

const sparkShapes = (
  tip: Vector,
  flick: number,
  count: number,
): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x: tip.x,
    y: tip.y,
    width: 1,
    height: 1,
    fill: SPARK_CORE_COLOR,
  }),
  ...Array.makeBy(count, index => {
    const ray = Option.getOrElse(
      Array.get(SPARK_RAYS, (flick * 3 + index * 5) % SPARK_RAYS.length),
      () => Array.headNonEmpty(SPARK_RAYS),
    )
    return Canvas.Rect({
      x: tip.x + ray.x,
      y: tip.y + ray.y,
      width: 1,
      height: 1,
      fill: Option.getOrElse(
        Array.get(SPARK_COLORS, (flick + index) % SPARK_COLORS.length),
        () => Array.headNonEmpty(SPARK_COLORS),
      ),
    })
  }),
]

const fuseShapes = (
  zombie: Zombie,
  player: Player,
  stage: number,
  stride: number,
  facing: Facing,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const urgency = fuseUrgency(zombie, player, stage)
  const length = fuseLengthAt(urgency)
  const flick = Math.floor((elapsedMs + zombie.id * 31) / sparkMsAt(urgency))
  return [
    ...kaboomerFuseSprite(length, stride, facing),
    ...sparkShapes(
      kaboomerFuseTip(length, stride, facing),
      flick,
      urgency < 0.5 ? 2 : 3,
    ),
  ]
}

const FUSE_CLEARANCE_PX = 5

export const zombieHealthBarShapes = (
  zombie: Zombie,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  if (
    !isGrounded(zombie) ||
    stats.healthBar === 'Hidden' ||
    zombie.hp >= zombie.maxHp
  ) {
    return []
  }

  const foot = footPosition(zombie, stats.footOffset)
  const fuseClearance =
    GAITS[zombie.kind].fuseTellPx > 0 ? FUSE_CLEARANCE_PX : 0
  const top =
    foot.y - ZOMBIE_SPRITES[zombie.kind].height - HEALTH_BAR_GAP - fuseClearance
  return healthBarShapes(
    'Small',
    'Zombie',
    foot.x - barWidthOf('Small') / 2,
    top - 1,
    zombie.hp / zombie.maxHp,
  )
}

// FRENZY

const STEAM_RISE_PX = 6
const STEAM_CYCLE_MS = 520
const STEAM_COLOR = 'rgba(244, 241, 222, 0.6)'

const HALO_COLOR = 'rgba(255, 43, 43, 0.32)'
const HALO_RADIUS = 4
const HALO_BELOW_TOP_PX = 3

const haloShapes = (
  zombie: Zombie,
  headTop: number,
): ReadonlyArray<Canvas.Shape> =>
  Frenzy.isAnyOf(['Frenzied'])(zombie.frenzy)
    ? [
        Canvas.Circle({
          x: Math.round(zombie.x),
          y: headTop + HALO_BELOW_TOP_PX,
          radius: HALO_RADIUS,
          fill: HALO_COLOR,
        }),
      ]
    : []

const steamShapes = (
  zombie: Zombie,
  elapsedMs: number,
  headY: number,
): ReadonlyArray<Canvas.Shape> => {
  if (!Frenzy.isAnyOf(['Frenzied'])(zombie.frenzy)) {
    return []
  }
  const phase =
    ((elapsedMs + zombie.id * 173) % STEAM_CYCLE_MS) / STEAM_CYCLE_MS
  const side = zombie.id % 2 === 0 ? 1 : -1
  return [
    Canvas.Rect({
      x: Math.round(zombie.x) + side * (2 + Math.round(phase * 2)),
      y: headY - 1 - Math.round(phase * STEAM_RISE_PX),
      width: phase < 0.5 ? 1 : 2,
      height: phase < 0.5 ? 1 : 2,
      fill: STEAM_COLOR,
    }),
  ]
}

// ICE

// NOTE: a zombie Brain Freeze froze solid stands in a block of ice baked
// once per kind, which blinks as it is about to melt; a Chilled one only
// sparkles with frost.
const ICE_EDGE = '#e8fbff'
const ICE_FACE = 'rgba(150, 220, 255, 0.5)'
const ICE_SHINE = 'rgba(255, 255, 255, 0.75)'
const ICE_MELT_BLINK_MS = 120
const ICE_MELT_WARN_MS = 600
const FROST_SPARKLE_MS = 160
const FROST_BRIGHT = '#9fe8ff'

const iceBlock = (kind: ZombieKind): Sprite => {
  const width = Math.round(ZOMBIE_KINDS[kind].bodyRadius * 2) + 4
  const height = ZOMBIE_SPRITES[kind].height + 3
  return bakeShapes([
    Canvas.Rect({ x: 0, y: 0, width, height, fill: ICE_FACE }),
    Canvas.Rect({ x: 0, y: 0, width, height: 1, fill: ICE_EDGE }),
    Canvas.Rect({ x: 0, y: 0, width: 1, height, fill: ICE_EDGE }),
    Canvas.Rect({ x: width - 1, y: 0, width: 1, height, fill: ICE_EDGE }),
    Canvas.Rect({ x: 0, y: height - 1, width, height: 1, fill: ICE_EDGE }),
    Canvas.Rect({ x: 2, y: 2, width: 1, height: 3, fill: ICE_SHINE }),
    Canvas.Rect({ x: 3, y: 2, width: 2, height: 1, fill: ICE_SHINE }),
  ])
}

const ICE_BLOCKS: Readonly<Record<ZombieKind, Sprite>> = {
  Shambler: iceBlock('Shambler'),
  Runner: iceBlock('Runner'),
  Tank: iceBlock('Tank'),
  Exploder: iceBlock('Exploder'),
  Thrower: iceBlock('Thrower'),
  Crawler: iceBlock('Crawler'),
  Boss: iceBlock('Boss'),
}

const iceShapes = (
  zombie: Zombie,
  foot: Vector,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const action = zombie.action
  if (ZombieAction.isAnyOf(['Frozen'])(action)) {
    const isBlinking =
      action.remainingMs < ICE_MELT_WARN_MS &&
      Math.floor(elapsedMs / ICE_MELT_BLINK_MS) % 2 === 0
    if (isBlinking) {
      return []
    }
    const block = ICE_BLOCKS[zombie.kind]
    const width = Math.round(statsOf(zombie).bodyRadius * 2) + 4
    return [
      placeAt(
        Math.round(foot.x - width / 2),
        Math.round(foot.y - ZOMBIE_SPRITES[zombie.kind].height - 2),
        block,
      ),
    ]
  } else if (ZombieAction.isAnyOf(['Chilled'])(action)) {
    const phase = Math.floor(elapsedMs / FROST_SPARKLE_MS) % 4
    const top = foot.y - ZOMBIE_SPRITES[zombie.kind].height
    return Array.map(
      [
        { x: -5 + phase * 2, y: top + phase * 3 },
        { x: 5 - phase * 2, y: foot.y - 4 - phase },
        { x: -2 + phase, y: top + 6 - phase },
        { x: 3 - phase, y: foot.y - 2 },
      ],
      ({ x, y }, index) =>
        Canvas.Rect({
          x: Math.round(foot.x + x),
          y: Math.round(y),
          width: index % 2 === 0 ? 2 : 1,
          height: index % 2 === 0 ? 2 : 1,
          fill: index % 2 === 0 ? FROST_BRIGHT : ICE_EDGE,
        }),
    )
  } else {
    return []
  }
}

const dazeStarShapes = (
  zombie: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (!ZombieAction.isAnyOf(['Dazed', 'Reeling'])(zombie.action)) {
    return []
  }
  // NOTE: the Clang Pan's ring is louder: three bigger stars.
  const isRung = ZombieAction.isAnyOf(['Reeling'])(zombie.action)
  const stars = isRung ? 3 : 2
  const size = isRung ? 2 : 1
  return Array.makeBy(stars, index => {
    const angle =
      (FULL_TURN * elapsedMs) / DAZE_STAR_MS +
      (FULL_TURN * index) / stars +
      zombie.id
    return Canvas.Rect({
      x: Math.round(zombie.x + Math.cos(angle) * 5),
      y: Math.round(zombie.y - 3 + Math.sin(angle) * 2),
      width: size,
      height: size,
      fill: DAZE_STAR_COLOR,
    })
  })
}

const walkingZombieShapes = (
  zombie: Zombie,
  player: Player,
  elapsedMs: number,
  boss: Boss,
  loneMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (ZombieAction.isAnyOf(['Burrowed'])(zombie.action)) {
    return []
  }

  const stats = statsOf(zombie)
  const gait = GAITS[zombie.kind]
  const stage = wearOf(zombie)
  const sprites = wornFramesAt(zombie.kind, stage)
  const pose = zombie.kind === 'Boss' ? bossPose(boss, zombie) : STANDING_POSE
  const placement = placementOf(zombie, elapsedMs)
  const isStill = pose !== STANDING_POSE || placement.isStill
  const stride = isStill ? 0 : strideAt(zombie, elapsedMs)
  const facing = Option.match(shieldAim(zombie), {
    onNone: () => facingToward(zombie.x, player.x),
    onSome: (aim): Facing => (Math.cos(aim) >= 0 ? 'Right' : 'Left'),
  })
  const isPlanted = stride % 2 === 0
  const stomp = isPlanted && !isStill ? gait.stompSquash : 0
  const isBossRaging = zombie.kind === 'Boss' && isEnraged(boss)
  const isFrenzied = isRaging(zombie, loneMs)
  const isHefting = ZombieAction.isAnyOf(['Hefting'])(zombie.action)
  const frames: SpriteFrames = isBossRaging
    ? sprites.lit
    : isFrenzied
      ? sprites.rage
      : sprites.walk
  const wobble =
    zombie.kind === 'Boss' ? 0 : WEAR_WOBBLE_RADIANS * Math.min(stage, 2)
  const foot = footPosition(zombie, stats.footOffset)
  const toned = zombieHitTone(zombie.hitRemainingMs)
  const tone: Tone =
    toned === 'Flash' ? toned : isHefting ? heftTone(zombie) : pose.tone
  const gape = isBossRaging
    ? sprites.litGape
    : isFrenzied
      ? sprites.rageGape
      : sprites.gape
  const isTaunting = isTauntingAt(zombie)
  const sprite =
    pose.isGaping || isHefting
      ? gape
      : isTaunting
        ? sprites.taunt
        : frameAt(frames, stride)
  const shake =
    pose.shakePx * (Math.floor(elapsedMs / 50) % 2 === 0 ? 1 : -1) +
    placement.nudgeX
  const pump =
    isTaunting && Math.floor(elapsedMs / TAUNT_PUMP_MS) % 2 === 0 ? 1 : 0
  const top = Math.round(foot.y - placement.lift - pump)
  const headTop = top - ZOMBIE_SPRITES[zombie.kind].height
  return [
    ...haloShapes(zombie, headTop),
    group({
      translate: { x: foot.x + shake, y: top },
      rotate:
        placement.rotate +
        pose.leanRadians +
        gait.leanRadians * (facing === 'Right' ? 1 : -1) +
        (isStill ? 0 : (gait.waddleRadians + wobble) * (isPlanted ? 1 : -1)),
      scale: multiplyScales(
        squashPulse(
          zombie.hitRemainingMs,
          ZOMBIE_HIT_PULSE_MS,
          ZOMBIE_HIT_SQUASH,
        ),
        multiplyScales(pose.scale, { x: 1 + stomp, y: 1 - stomp }),
      ),
      shapes:
        gait.fuseTellPx > 0
          ? [
              ...sprite[tone][facing],
              ...fuseShapes(zombie, player, stage, stride, facing, elapsedMs),
            ]
          : sprite[tone][facing],
    }),
    ...steamShapes(zombie, elapsedMs, headTop),
    ...dazeStarShapes(zombie, elapsedMs),
    ...iceShapes(zombie, foot, elapsedMs),
  ]
}

const FUSE_SWELL_MS = 300
const FUSE_SWELL = 0.35
const FUSE_FLASH_MS = 40
const FUSING_SPARKS = 4

const fusingZombieShapes = (
  zombie: Zombie,
  player: Player,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  const sprites = wornFramesAt(zombie.kind, wearOf(zombie))
  const swell = 1 + FUSE_SWELL * (1 - clamp(remainingMs / FUSE_SWELL_MS, 0, 1))
  const flicker = Math.floor(remainingMs / FUSE_FLASH_MS) % 2 === 0
  const foot = footPosition(zombie, stats.footOffset)
  const facing = facingToward(zombie.x, player.x)
  return [
    group({
      translate: { x: foot.x + (flicker ? 1 : -1), y: foot.y },
      scale: { x: swell * (flicker ? 1.08 : 1), y: swell },
      shapes: [
        ...frameAt(sprites.lit, 0)[flicker ? 'Flash' : 'Normal'][facing],
        ...sparkShapes(
          kaboomerFuseTip(0, 0, facing),
          Math.floor(remainingMs / SPARK_FUSING_MS),
          FUSING_SPARKS,
        ),
      ],
    }),
  ]
}

type DeathPose = Readonly<{
  zombie: Zombie
  progress: number
  direction: Vector
  sprite: SpriteSet
}>

const toppleShape = ({
  zombie,
  progress,
  direction,
  sprite,
}: DeathPose): Canvas.Shape => {
  const pop = Math.sin(
    Math.PI * progressBetween(progress, 0, ZOMBIE_DEATH_POP_END),
  )
  const fall = progressBetween(
    progress,
    ZOMBIE_DEATH_POP_END,
    ZOMBIE_DEATH_FALL_END,
  )
  const landing = Math.sin(
    Math.PI *
      progressBetween(
        progress,
        ZOMBIE_DEATH_FALL_END,
        ZOMBIE_DEATH_LANDING_END,
      ),
  )
  const isFallingRight = direction.x >= 0
  const tone: Tone = progress < ZOMBIE_DEATH_POP_END ? 'Flash' : 'Normal'
  const facing: Facing = isFallingRight ? 'Left' : 'Right'
  return group({
    translate: footPosition(zombie, statsOf(zombie).footOffset),
    rotate: (isFallingRight ? 1 : -1) * QUARTER_TURN * fall * fall,
    scale: {
      x:
        (1 - ZOMBIE_DEATH_POP_PINCH * pop) *
        (1 - ZOMBIE_DEATH_LANDING_SQUASH * landing),
      y: 1 + ZOMBIE_DEATH_POP_STRETCH * pop,
    },
    opacity: 1 - progressBetween(progress, ZOMBIE_DEATH_FADE_START, 1),
    shapes: sprite[tone][facing],
  })
}

const TUMBLE_TURNS = 1.25
const TUMBLE_SLIDE_PX = 14
const TUMBLE_FLASH_END = 0.15

const tumbleShape = ({
  zombie,
  progress,
  direction,
  sprite,
}: DeathPose): Canvas.Shape => {
  const eased = 1 - (1 - progress) * (1 - progress)
  const foot = footPosition(zombie, statsOf(zombie).footOffset)
  const spin = direction.x >= 0 ? 1 : -1
  return group({
    translate: {
      x: Math.round(foot.x + direction.x * TUMBLE_SLIDE_PX * eased),
      y: Math.round(
        foot.y +
          direction.y * TUMBLE_SLIDE_PX * eased -
          4 * Math.sin(Math.PI * progressBetween(progress, 0, 0.5)),
      ),
    },
    rotate: spin * FULL_TURN * TUMBLE_TURNS * eased,
    opacity: 1 - progressBetween(progress, ZOMBIE_DEATH_FADE_START, 1),
    shapes:
      sprite[progress < TUMBLE_FLASH_END ? 'Flash' : 'Normal'][
        spin > 0 ? 'Left' : 'Right'
      ],
  })
}

const SLUMP_SHUDDER_END = 0.3
const SLUMP_FALL_END = 0.7
const SLUMP_LANDING_END = 0.85
const SLUMP_SHUDDER_MS = 45

const slumpShape = ({
  zombie,
  progress,
  direction,
  sprite,
}: DeathPose): Canvas.Shape => {
  const isShuddering = progress < SLUMP_SHUDDER_END
  const fall = progressBetween(progress, SLUMP_SHUDDER_END, SLUMP_FALL_END)
  const landing = Math.sin(
    Math.PI * progressBetween(progress, SLUMP_FALL_END, SLUMP_LANDING_END),
  )
  const foot = footPosition(zombie, statsOf(zombie).footOffset)
  const shudder =
    isShuddering &&
    Math.floor((progress * statsOf(zombie).dyingMs) / SLUMP_SHUDDER_MS) % 2 ===
      0
      ? 1
      : -1
  const isFallingRight = direction.x >= 0
  return group({
    translate: { x: foot.x + (isShuddering ? shudder : 0), y: foot.y },
    rotate: (isFallingRight ? 1 : -1) * QUARTER_TURN * fall * fall * fall,
    scale: { x: 1 + 0.25 * landing, y: 1 - 0.4 * landing },
    opacity: 1 - progressBetween(progress, SLUMP_LANDING_END, 1),
    shapes:
      sprite[isShuddering && shudder > 0 ? 'Flash' : 'Normal'][
        isFallingRight ? 'Left' : 'Right'
      ],
  })
}

const DEATH_POSES: Readonly<
  Record<DeathStyle, (pose: DeathPose) => Canvas.Shape>
> = {
  Topple: toppleShape,
  Tumble: tumbleShape,
  Slump: slumpShape,
  Burst: toppleShape,
}

const dyingZombieShape = (
  zombie: Zombie,
  remainingMs: number,
  direction: Vector,
): Canvas.Shape => {
  const stats = statsOf(zombie)
  return DEATH_POSES[stats.deathStyle]({
    zombie,
    progress: clamp(1 - remainingMs / Math.max(1, stats.dyingMs), 0, 1),
    direction,
    sprite: frameAt(
      wornFramesAt(zombie.kind, statsOf(zombie).wear.length).walk,
      0,
    ),
  })
}

export const zombieShapes: {
  (
    player: Player,
    elapsedMs: number,
    boss: Boss,
    loneMs: number,
  ): (zombie: Zombie) => ReadonlyArray<Canvas.Shape>
  (
    zombie: Zombie,
    player: Player,
    elapsedMs: number,
    boss: Boss,
    loneMs: number,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  5,
  (
    zombie: Zombie,
    player: Player,
    elapsedMs: number,
    boss: Boss,
    loneMs: number,
  ): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () =>
        walkingZombieShapes(zombie, player, elapsedMs, boss, loneMs),
      Fusing: ({ remainingMs }) =>
        fusingZombieShapes(zombie, player, remainingMs),
      Dying: ({ remainingMs, direction }) => [
        dyingZombieShape(zombie, remainingMs, direction),
      ],
    }),
)
