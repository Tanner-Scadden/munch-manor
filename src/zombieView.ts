import { Array, Option, Result } from 'effect'
import { Canvas } from 'foldkit'

import { isEnraged } from './boss'
import { CHUCKER_RULES, THROWER_KIND, shieldAim } from './chucker'
import {
  SHADOW_COLOR,
  SHADOW_FADED_COLOR,
  SHADOW_FADE_START,
  SHADOW_HIDE_START,
  ZOMBIE_DEATH_FADE_START,
  ZOMBIE_DEATH_FALL_END,
  ZOMBIE_DEATH_LANDING_END,
  ZOMBIE_DEATH_LANDING_SQUASH,
  ZOMBIE_DEATH_POP_END,
  ZOMBIE_DEATH_POP_PINCH,
  ZOMBIE_DEATH_POP_STRETCH,
  ZOMBIE_FOOT_OFFSET,
  ZOMBIE_HIT_FLASH_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_HIT_SQUASH,
} from './constants'
import { surfacingProgress } from './crawler'
import {
  FULL_TURN,
  HEALTH_BAR_BACK_COLOR,
  HEALTH_BAR_GAP,
  QUARTER_TURN,
  facingToward,
  footPosition,
  footShadow,
  multiplyScales,
  progressBetween,
  squashPulse,
  tellAlpha,
} from './drawing'
import { clamp } from './geometry'
import {
  Boss,
  BossMove,
  Frenzy,
  type PlantedAttack,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from './model'
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
} from './sprite'
import {
  KABOOMER_FUSE_MAX,
  ZOMBIE_SPRITES,
  kaboomerFuseSprite,
  kaboomerFuseTip,
  wornFramesAt,
} from './sprites/zombies'
import {
  Behavior,
  type DeathStyle,
  ZOMBIE_KINDS,
  isGrounded,
  statsOf,
  strideAt,
  wearOf,
} from './zombies'

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

export const kaboomerFuseLength = (zombie: Zombie, player: Player): number =>
  fuseLengthAt(fuseUrgency(zombie, player, wearOf(zombie)))

export const kaboomerSparkMs = (zombie: Zombie, player: Player): number =>
  sparkMsAt(fuseUrgency(zombie, player, wearOf(zombie)))

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

const HEALTH_BAR_WIDTH = 12
const FUSE_CLEARANCE_PX = 5
const HEALTH_BAR_COLOR = '#ff3b3f'

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
  const left = foot.x - HEALTH_BAR_WIDTH / 2
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: HEALTH_BAR_WIDTH + 2,
      height: 3,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Canvas.Rect({
      x: left,
      y: top,
      width: Math.max(
        1,
        Math.round((HEALTH_BAR_WIDTH * zombie.hp) / zombie.maxHp),
      ),
      height: 1,
      fill: HEALTH_BAR_COLOR,
    }),
  ]
}

// BOSS POSES

const BOSS_RISE_STRETCH = 0.16
const BOSS_CROUCH_SQUASH = 0.12
const BOSS_BELCH_SWELL = 0.18
const BOSS_SPIT_SWELL = 0.1
const BOSS_TELL_FAST_MS = 60
const BOSS_TELL_SLOW_MS = 180
const BOSS_LANDING_SQUASH = 0.2
const BOSS_STAMP_MS = 200
const BOSS_STAMP_SQUASH = 0.08
const BOSS_BRACE_LEAN = 0.12
const BOSS_RUSH_LEAN = 0.3
const BOSS_RUSH_STRETCH = 0.1
const BOSS_DAZE_SWAY = 0.14
const BOSS_DAZE_SWAY_MS = 140

type Pose = Readonly<{
  scale: Vector
  tone: Tone
  isGaping: boolean
  shakePx: number
  leanRadians: number
}>

const STANDING_POSE: Pose = {
  scale: { x: 1, y: 1 },
  tone: 'Normal',
  isGaping: false,
  shakePx: 0,
  leanRadians: 0,
}

const tellTone = (remainingMs: number, durationMs: number): Tone => {
  const urgency = 1 - remainingMs / Math.max(1, durationMs)
  const periodMs =
    BOSS_TELL_SLOW_MS + (BOSS_TELL_FAST_MS - BOSS_TELL_SLOW_MS) * urgency
  return Math.floor(remainingMs / periodMs) % 2 === 0 ? 'Flash' : 'Normal'
}

const leanToward = (fromX: number, toX: number): number =>
  toX < fromX ? -1 : 1

const windUpPose = (
  attack: PlantedAttack,
  remainingMs: number,
  durationMs: number,
): Pose => {
  const progress = 1 - remainingMs / Math.max(1, durationMs)
  if (attack === 'Stomp') {
    const rise = Math.sin(Math.PI * Math.min(1, progress * 1.2))
    return {
      scale: {
        x: 1 - BOSS_CROUCH_SQUASH * rise * 0.5,
        y: 1 + BOSS_RISE_STRETCH * rise,
      },
      tone: tellTone(remainingMs, durationMs),
      isGaping: true,
      shakePx: 0,
      leanRadians: 0,
    }
  } else {
    const swell =
      (attack === 'Belch' ? BOSS_BELCH_SWELL : BOSS_SPIT_SWELL) * progress
    return {
      scale: { x: 1 + swell, y: 1 - swell * 0.4 },
      tone: 'Normal',
      isGaping: progress > 0.5,
      shakePx: progress > 0.5 ? 1 : 0,
      leanRadians: 0,
    }
  }
}

const bossPose = (boss: Boss, zombie: Zombie): Pose =>
  Boss.isAnyOf(['Fighting'])(boss) && boss.id === zombie.id
    ? BossMove.match(boss.move, {
        Stalking: (): Pose => STANDING_POSE,
        WindingUp: ({ attack, remainingMs, durationMs }): Pose =>
          windUpPose(attack, remainingMs, durationMs),
        Bracing: ({ target, remainingMs, durationMs }): Pose => {
          const isStamping = Math.floor(remainingMs / BOSS_STAMP_MS) % 2 === 0
          return {
            scale: {
              x: 1 + (isStamping ? BOSS_STAMP_SQUASH : 0),
              y: 1 - (isStamping ? BOSS_STAMP_SQUASH : 0),
            },
            tone: tellTone(remainingMs, durationMs),
            isGaping: true,
            shakePx: isStamping ? 1 : 0,
            leanRadians: -BOSS_BRACE_LEAN * leanToward(zombie.x, target.x),
          }
        },
        Rushing: ({ direction }): Pose => ({
          scale: { x: 1 + BOSS_RUSH_STRETCH, y: 1 - BOSS_RUSH_STRETCH * 0.6 },
          tone: 'Normal',
          isGaping: true,
          shakePx: 1,
          leanRadians: BOSS_RUSH_LEAN * (direction.x < 0 ? -1 : 1),
        }),
        Dazed: ({ remainingMs }): Pose => ({
          scale: { x: 1, y: 1 },
          tone: 'Normal',
          isGaping: true,
          shakePx: 0,
          leanRadians:
            BOSS_DAZE_SWAY * Math.sin(remainingMs / BOSS_DAZE_SWAY_MS),
        }),
        Recovering: ({ remainingMs }): Pose => ({
          scale: {
            x: 1 + BOSS_LANDING_SQUASH * Math.min(1, remainingMs / 400),
            y: 1 - BOSS_LANDING_SQUASH * Math.min(1, remainingMs / 400),
          },
          tone: 'Normal',
          isGaping: false,
          shakePx: 0,
          leanRadians: 0,
        }),
      })
    : STANDING_POSE

// FRENZY

const STEAM_RISE_PX = 6
const STEAM_CYCLE_MS = 520
const STEAM_COLOR = 'rgba(244, 241, 222, 0.6)'
const FADE_BLINK_MS = 110

const isRaging = (zombie: Zombie): boolean =>
  Frenzy.match(zombie.frenzy, {
    Calm: () => false,
    Frenzied: () => true,
    Fading: ({ remainingMs }) =>
      Math.floor(remainingMs / FADE_BLINK_MS) % 2 === 0,
    Spent: () => false,
  })

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

// ACTIONS

const HEFT_TELL_SLOW_MS = 200
const HEFT_TELL_FAST_MS = 60
const CARRY_LIFT_PX = 28
const CARRY_WIGGLE_MS = 90
const FLIGHT_PEAK_PX = 34
const FLIGHT_LIFT_PX = 15
const FLIGHT_SPIN_MS = 260
const DAZE_STAR_MS = 700
const DAZE_STAR_COLOR = '#ffe066'
const CLING_SHAKE_MS = 60
const SHIELD_LIFT_PX = 2
const SQUIRM_MS = 110
const SQUIRM_RADIANS = 0.18

const TAUNT_MS = 500
const TAUNT_PUMP_MS = 120

// NOTE: right after a throw the Big Leaguer pumps his fist. His wind after a
// throw is the only one long enough to start inside the taunt, so arriving
// winded or cooling down from a shield never shows it.
const isTauntingAt = (zombie: Zombie): boolean =>
  zombie.kind === THROWER_KIND &&
  ZombieAction.isAnyOf(['Winded'])(zombie.action) &&
  zombie.action.remainingMs > CHUCKER_RULES.windedMs - TAUNT_MS

const heftTone = (zombie: Zombie): Tone => {
  if (!ZombieAction.isAnyOf(['Hefting'])(zombie.action)) {
    return 'Normal'
  }
  const { remainingMs, durationMs } = zombie.action
  const urgency = 1 - remainingMs / Math.max(1, durationMs)
  const periodMs =
    HEFT_TELL_SLOW_MS + (HEFT_TELL_FAST_MS - HEFT_TELL_SLOW_MS) * urgency
  return Math.floor(remainingMs / periodMs) % 2 === 0 ? 'Flash' : 'Normal'
}

type Placement = Readonly<{
  lift: number
  rotate: number
  nudgeX: number
  isStill: boolean
}>

const ON_FEET: Placement = { lift: 0, rotate: 0, nudgeX: 0, isStill: false }

// NOTE: a Groaner held overhead hangs upside down by its ankles in the
// Big Leaguer's raised hands, kicking. A half turn hangs its body below its feet,
// so its feet are lifted above the Big Leaguer's head by its own height.

const placementOf = (zombie: Zombie, elapsedMs: number): Placement =>
  ZombieAction.match(zombie.action, {
    Roaming: () => ON_FEET,
    Winded: () => ON_FEET,
    Hefting: () => ({
      lift: 0,
      rotate: 0,
      nudgeX: Math.floor(elapsedMs / 50) % 2 === 0 ? 1 : 0,
      isStill: true,
    }),
    Carried: () => ({
      lift: CARRY_LIFT_PX,
      rotate:
        Math.PI +
        (Math.floor(elapsedMs / CARRY_WIGGLE_MS) % 2 === 0 ? 0.12 : -0.12),
      nudgeX: 0,
      isStill: false,
    }),
    Flying: ({ remainingMs, durationMs }) => {
      const progress = 1 - remainingMs / Math.max(1, durationMs)
      return {
        lift:
          4 * FLIGHT_PEAK_PX * progress * (1 - progress) +
          FLIGHT_LIFT_PX * (1 - progress),
        rotate: (FULL_TURN * (durationMs - remainingMs)) / FLIGHT_SPIN_MS,
        nudgeX: 0,
        isStill: false,
      }
    },
    Dazed: () => ({
      lift: 0,
      rotate: QUARTER_TURN,
      nudgeX: 0,
      isStill: true,
    }),
    Burrowed: () => ON_FEET,
    Frozen: () => ({ lift: 0, rotate: 0, nudgeX: 0, isStill: true }),
    Chilled: () => ON_FEET,
    Reeling: () => ({
      lift: 0,
      rotate: QUARTER_TURN,
      nudgeX: 0,
      isStill: true,
    }),
    Shielding: () => ({ lift: 0, rotate: 0, nudgeX: 0, isStill: true }),
    Shielded: () => ({
      lift: SHIELD_LIFT_PX,
      rotate:
        Math.floor(elapsedMs / SQUIRM_MS) % 2 === 0
          ? SQUIRM_RADIANS
          : -SQUIRM_RADIANS,
      nudgeX: 0,
      isStill: false,
    }),
    Clinging: () => ({
      lift: 0,
      rotate: 0,
      nudgeX: Math.floor(elapsedMs / CLING_SHAKE_MS) % 2 === 0 ? 1 : -1,
      isStill: true,
    }),
  })

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
  const isFrenzied = isRaging(zombie)
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

export const zombieShapes =
  (player: Player, elapsedMs: number, boss: Boss) =>
  (zombie: Zombie): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () => walkingZombieShapes(zombie, player, elapsedMs, boss),
      Fusing: ({ remainingMs }) =>
        fusingZombieShapes(zombie, player, remainingMs),
      Dying: ({ remainingMs, direction }) => [
        dyingZombieShape(zombie, remainingMs, direction),
      ],
    })

// DEPTH AND SHADOW

const CARRIED_DEPTH_PX = 2
const FLYING_DEPTH_PX = 1000

// NOTE: a Groaner held overhead draws just after its Big Leaguer, and one in the
// air draws after everything standing, since it flies over their heads.
export const zombieFootY = (zombie: Zombie): number =>
  zombie.y +
  statsOf(zombie).footOffset +
  ZombieAction.match(zombie.action, {
    Roaming: () => 0,
    Winded: () => 0,
    Hefting: () => 0,
    Carried: () => CARRIED_DEPTH_PX,
    Flying: () => FLYING_DEPTH_PX,
    Dazed: () => 0,
    Shielding: () => 0,
    Shielded: () => 0,
    Burrowed: () => 0,
    Clinging: () => 0,
    Frozen: () => 0,
    Chilled: () => 0,
    Reeling: () => 0,
  })

const zombieFootShadow = (zombie: Zombie, fill: string): Canvas.Shape => {
  const stats = statsOf(zombie)
  return footShadow(
    zombie,
    stats.footOffset,
    Math.round(stats.radius * 2),
    fill,
  )
}

const hasShadow = ZombieAction.isAnyOf([
  'Roaming',
  'Shielding',
  'Winded',
  'Hefting',
  'Flying',
  'Dazed',
  'Clinging',
  'Frozen',
  'Chilled',
  'Reeling',
])

export const zombieShadow = (
  zombie: Zombie,
): Result.Result<Canvas.Shape, void> =>
  ZombieState.match(zombie.state, {
    Walking: (): Result.Result<Canvas.Shape, void> =>
      hasShadow(zombie.action)
        ? Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR))
        : Result.failVoid,
    Fusing: (): Result.Result<Canvas.Shape, void> =>
      Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR)),
    Dying: ({ remainingMs }): Result.Result<Canvas.Shape, void> => {
      const progress = 1 - remainingMs / Math.max(1, statsOf(zombie).dyingMs)
      if (progress < SHADOW_FADE_START) {
        return Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR))
      } else if (progress < SHADOW_HIDE_START) {
        return Result.succeed(zombieFootShadow(zombie, SHADOW_FADED_COLOR))
      } else {
        return Result.failVoid
      }
    },
  })

// FLOOR TELLS

const TELL_EDGE_COLOR = '#ff4a4f'
const TELL_SWEEP_COLOR = '#ffe066'

const tellFill = (progress: number): string =>
  `rgba(255, 58, 63, ${tellAlpha(0.1, 0.3, progress)})`

const tellRingShapes = (
  at: Vector,
  radius: number,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(at.x)
  const y = Math.round(at.y)
  return [
    Canvas.Circle({
      x,
      y,
      radius,
      fill: tellFill(progress),
      stroke: TELL_EDGE_COLOR,
      lineWidth: 1,
    }),
    Canvas.Circle({
      x,
      y,
      radius: Math.max(1, Math.round(radius * progress)),
      stroke: TELL_SWEEP_COLOR,
      lineWidth: 1,
    }),
  ]
}

const blastRadiusOf = (zombie: Zombie): number =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => 0,
    Bomber: ({ blastRadius }) => blastRadius,
    Thrower: () => 0,
    Crawler: () => 0,
  })

const fuseLengthOf = (zombie: Zombie): number =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => 1,
    Bomber: ({ contactFuseMs }) => contactFuseMs,
    Thrower: () => 1,
    Crawler: () => 1,
  })

const fuseRingShapes = (
  zombie: Zombie,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const radius = blastRadiusOf(zombie)
  return radius > 0
    ? tellRingShapes(
        zombie,
        radius,
        clamp(1 - remainingMs / Math.max(1, fuseLengthOf(zombie)), 0, 1),
      )
    : []
}

const landingShapes = (zombie: Zombie): ReadonlyArray<Canvas.Shape> => {
  if (!ZombieAction.isAnyOf(['Flying'])(zombie.action)) {
    return []
  }
  const { to, remainingMs, durationMs } = zombie.action
  return tellRingShapes(
    { x: to.x, y: to.y + ZOMBIE_FOOT_OFFSET },
    CHUCKER_RULES.landRadius,
    clamp(1 - remainingMs / Math.max(1, durationMs), 0, 1),
  )
}

const CRACK_COLOR = '#f0c27a'
const HOLE_COLOR = '#140c10'
const CLAW_COLOR = '#dcf5b8'
const CRACK_RING_COLOR = 'rgba(240, 194, 122, 0.55)'
const CRACK_DUST_COLOR = 'rgba(214, 196, 160, 0.8)'
const CRACK_JUMP_MS = 90
const CRACK_RING_MIN_PX = 3
const CRACK_RING_GROW_PX = 8

type Crack = Readonly<{ dx: number; dy: number; length: number }>

const CRACKS: ReadonlyArray<Crack> = [
  { dx: 1, dy: 0, length: 7 },
  { dx: -1, dy: 0, length: 6 },
  { dx: 0, dy: 1, length: 3 },
  { dx: 0, dy: -1, length: 4 },
]

// NOTE: the floor tells where an Ankle Biter is coming up: a ring of dust
// spreads, pale cracks split the boards, a hole opens, and a claw pokes
// through just before it climbs out.
const crackShapes = (
  zombie: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const progress = surfacingProgress(zombie)
  const x = Math.round(zombie.x)
  const y = Math.round(zombie.y) + statsOf(zombie).footOffset
  const jump = Math.floor((elapsedMs + zombie.id * 53) / CRACK_JUMP_MS) % 2
  const ring = Canvas.Circle({
    x,
    y,
    radius: CRACK_RING_MIN_PX + Math.round(CRACK_RING_GROW_PX * progress),
    stroke: CRACK_RING_COLOR,
    lineWidth: 1,
  })
  const cracks = Array.map(CRACKS, ({ dx, dy, length }) => {
    const reach = Math.max(1, Math.round(length * Math.min(1, progress * 1.4)))
    return Canvas.Rect({
      x: dx < 0 ? x - reach : x + (dx > 0 ? 1 : 0),
      y: dy < 0 ? y - reach : y + (dy > 0 ? 1 : 0),
      width: dx === 0 ? 1 : reach,
      height: dy === 0 ? 1 : reach,
      fill: CRACK_COLOR,
    })
  })
  const hole =
    progress > 0.4
      ? [
          Canvas.Rect({
            x: x - 2,
            y: y - 1,
            width: progress > 0.7 ? 5 : 3,
            height: progress > 0.7 ? 3 : 2,
            fill: HOLE_COLOR,
          }),
        ]
      : []
  const claw =
    progress > 0.8 && jump === 0
      ? [Canvas.Rect({ x, y: y - 2, width: 1, height: 2, fill: CLAW_COLOR })]
      : []
  const dust =
    progress > 0.2
      ? [
          Canvas.Rect({
            x: x - 4 + jump * 7,
            y: y - 2 - Math.round(progress * 4),
            width: 2,
            height: 1,
            fill: CRACK_DUST_COLOR,
          }),
        ]
      : []
  return [ring, ...cracks, ...hole, ...claw, ...dust]
}

const groundTellShapes =
  (elapsedMs: number) =>
  (zombie: Zombie): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () =>
        ZombieAction.isAnyOf(['Burrowed'])(zombie.action)
          ? crackShapes(zombie, elapsedMs)
          : landingShapes(zombie),
      Fusing: ({ remainingMs }) => fuseRingShapes(zombie, remainingMs),
      Dying: () => [],
    })

export const zombieGroundShapes = (
  zombies: ReadonlyArray<Zombie>,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(zombies, groundTellShapes(elapsedMs))
