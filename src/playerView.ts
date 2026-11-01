import { Array, Option, Result } from 'effect'
import { Canvas } from 'foldkit'

import { PLAYER_WIDTH, playerSprites } from './appearance'
import {
  MUZZLE_FLASH_BIG_MS,
  MUZZLE_FLASH_CORE_COLOR,
  MUZZLE_FLASH_MS,
  MUZZLE_FLASH_OUTER_COLOR,
  PLAYER_BLINK_MS,
  PLAYER_BLINK_OPACITY,
  PLAYER_BREATH_FRAME_MS,
  PLAYER_FOOT_OFFSET,
  PLAYER_HURT_FLASH_MS,
  PLAYER_HURT_PULSE_MS,
  PLAYER_HURT_SQUASH,
  PLAYER_RADIUS,
  PLAYER_SHADOW_WIDTH,
  PLAYER_WALK_FRAME_MS,
  RELOAD_BAR_BACK_COLOR,
  RELOAD_BAR_COLOR,
  RELOAD_BAR_LIFT_PX,
  RELOAD_BAR_WIDTH,
  SHADOW_COLOR,
} from './constants'
import {
  AIMING_UP,
  QUARTER_TURN,
  UNIT_SCALE,
  centeredRect,
  footPosition,
  footShadow,
  multiplyScales,
  squashPulse,
} from './drawing'
import { chargeOf } from './fridgeWeapons'
import { clamp, vectorLength } from './geometry'
import { KNIFE_RULES, maybeSlashShare } from './knife'
import {
  Invulnerability,
  type Model,
  type Player,
  Reload,
  type Vector,
  type WeaponKind,
} from './model'
import {
  type Facing,
  type Sprite,
  type SpriteSet,
  type Tone,
  frameAt,
  group,
} from './sprite'
import { gunSprite, knifeSprite } from './sprites/guns'
import {
  type MuzzleFlash,
  type WeaponStats,
  heldGun,
  isWieldingKnife,
  maybeWieldedPan,
  statsAt,
} from './weapons'

// PLAYER

export const maybeMsSinceHurt = (player: Player): Option.Option<number> =>
  Invulnerability.match(player.invulnerability, {
    Vulnerable: () => Option.none(),
    Invulnerable: ({ remainingMs, durationMs }) =>
      Option.some(durationMs - remainingMs),
  })

const playerFrames = (model: Model): SpriteSet => {
  const sprites = playerSprites(model.appearance, model.player.calling)
  return vectorLength(model.intent.move) > 0
    ? frameAt(sprites.walk, Math.floor(model.elapsedMs / PLAYER_WALK_FRAME_MS))
    : frameAt(
        sprites.idle,
        Math.floor(model.elapsedMs / PLAYER_BREATH_FRAME_MS),
      )
}

const playerTone = (player: Player): Tone =>
  Option.match(maybeMsSinceHurt(player), {
    onNone: () => 'Normal',
    onSome: msSinceHurt =>
      msSinceHurt < PLAYER_HURT_FLASH_MS ? 'Flash' : 'Normal',
  })

const playerOpacity = (player: Player): number =>
  Invulnerability.match(player.invulnerability, {
    Vulnerable: () => 1,
    Invulnerable: ({ remainingMs }) =>
      Math.floor(remainingMs / PLAYER_BLINK_MS) % 2 === 0
        ? 1
        : PLAYER_BLINK_OPACITY,
  })

const playerHurtScale = (player: Player): Vector =>
  Option.match(maybeMsSinceHurt(player), {
    onNone: () => UNIT_SCALE,
    onSome: msSinceHurt =>
      squashPulse(
        PLAYER_HURT_PULSE_MS - msSinceHurt,
        PLAYER_HURT_PULSE_MS,
        PLAYER_HURT_SQUASH,
      ),
  })

export const MUZZLE_FLASHES: Readonly<
  Record<
    MuzzleFlash,
    (isBig: boolean, x: number, y: number) => ReadonlyArray<Canvas.Shape>
  >
> = {
  Flicker: (isBig, x, y) =>
    isBig
      ? [
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 1, 1, MUZZLE_FLASH_CORE_COLOR),
        ]
      : [centeredRect(x, y, 1, 1, MUZZLE_FLASH_OUTER_COLOR)],
  Pop: (isBig, x, y) =>
    isBig
      ? [
          centeredRect(x, y, 5, 3, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 3, 5, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_CORE_COLOR),
        ]
      : [
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 1, 1, MUZZLE_FLASH_CORE_COLOR),
        ],
  Blast: (isBig, x, y) =>
    isBig
      ? [
          centeredRect(x, y, 11, 5, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 5, 11, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 7, 7, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 5, 5, MUZZLE_FLASH_CORE_COLOR),
        ]
      : [
          centeredRect(x, y, 7, 5, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 5, 7, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_CORE_COLOR),
        ],
}

type FlashSpark = Readonly<{ dx: number; dy: number; fill: string }>

const SPARK_BLUE = '#9be3ff'
const SPARK_PINK = '#ff9df0'
const SPARK_GOLD = '#ffe066'

const TIER_SPARKS: ReadonlyArray<ReadonlyArray<FlashSpark>> = [
  [],
  [
    { dx: -3, dy: -3, fill: SPARK_BLUE },
    { dx: 3, dy: 3, fill: SPARK_BLUE },
  ],
  [
    { dx: -3, dy: -3, fill: SPARK_BLUE },
    { dx: 3, dy: 3, fill: SPARK_BLUE },
    { dx: 3, dy: -3, fill: SPARK_PINK },
    { dx: -3, dy: 3, fill: SPARK_PINK },
  ],
  [
    { dx: -3, dy: -3, fill: SPARK_GOLD },
    { dx: 3, dy: 3, fill: SPARK_GOLD },
    { dx: 3, dy: -3, fill: SPARK_GOLD },
    { dx: -3, dy: 3, fill: SPARK_GOLD },
    { dx: 0, dy: -5, fill: SPARK_PINK },
    { dx: 0, dy: 5, fill: SPARK_PINK },
    { dx: -5, dy: 0, fill: SPARK_BLUE },
    { dx: 5, dy: 0, fill: SPARK_BLUE },
  ],
]

const tierSparkShapes = (
  tier: number,
  x: number,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(
    Option.getOrElse(Array.get(TIER_SPARKS, tier), () => []),
    ({ dx, dy, fill }) =>
      Canvas.Rect({ x: x + dx, y: y + dy, width: 1, height: 1, fill }),
  )

const muzzleFlashShapes = (
  player: Player,
  stats: WeaponStats,
  tier: number,
  muzzleX: number,
  muzzleY: number,
): ReadonlyArray<Canvas.Shape> => {
  const msSinceShot = stats.recoilMs - player.recoilRemainingMs
  if (player.recoilRemainingMs <= 0 || msSinceShot >= MUZZLE_FLASH_MS) {
    return []
  } else {
    const isBig = msSinceShot < MUZZLE_FLASH_BIG_MS
    return [
      ...MUZZLE_FLASHES[stats.flash](isBig, muzzleX, muzzleY),
      ...(isBig ? tierSparkShapes(tier, muzzleX, muzzleY) : []),
    ]
  }
}

export const GUN_HOLD_PX = 2

// NOTE: the Clang Pan sweeps across the front as it swings: from one side
// to the other over the swing, then back at rest.
const SWING_TURN = 1.3

const swingTurn = (weapon: WeaponKind, recoil: number): number =>
  weapon === 'Pan' && recoil > 0 ? (recoil - 0.5) * 2 * SWING_TURN : 0

// NOTE: the Cooker's lid rattles as the pressure builds, harder near full.
const RATTLE_MS = 50

const lidRattlePx = (player: Player, elapsedMs: number): number => {
  const charge = chargeOf(player)
  return charge >= 0.5 && Math.floor(elapsedMs / RATTLE_MS) % 2 === 0
    ? charge >= 1
      ? 1
      : Math.floor(elapsedMs / (RATTLE_MS * 2)) % 2 === 0
        ? 1
        : 0
    : 0
}

type PlayerPose = Readonly<{
  weapon: WeaponKind
  tier: number
  stats: WeaponStats
  bodyX: number
  bodyY: number
}>

// NOTE: the Pan drawn from the melee slot is held and swung as a gun in
// hand is; with the knife out the last gun's pose stays.
const playerPose = (player: Player): PlayerPose => {
  const { kind: weapon, tier } = Option.getOrElse(maybeWieldedPan(player), () =>
    heldGun(player.arsenal),
  )
  const stats = statsAt(weapon, tier)
  const recoil = clamp(player.recoilRemainingMs / stats.recoilMs, 0, 1)
  const kick = stats.recoilKickPx * recoil
  return {
    weapon,
    tier,
    stats,
    bodyX: player.x - player.facing.x * kick,
    bodyY: player.y - player.facing.y * kick,
  }
}

export const playerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const { weapon, tier, stats, bodyX, bodyY } = playerPose(player)
  const recoil = clamp(player.recoilRemainingMs / stats.recoilMs, 0, 1)
  const facing: Facing = player.facing.x < 0 ? 'Left' : 'Right'
  const body = group({
    translate: footPosition({ x: bodyX, y: bodyY }, PLAYER_FOOT_OFFSET),
    scale: multiplyScales(playerHurtScale(player), {
      x: 1 + stats.recoilSquash * recoil,
      y: 1 - stats.recoilSquash * recoil,
    }),
    opacity: playerOpacity(player),
    shapes: playerFrames(model)[playerTone(player)][facing],
  })
  const rattle = lidRattlePx(player, model.elapsedMs)
  const angle = Math.atan2(player.facing.y, player.facing.x)
  const gun = group({
    translate: {
      x: Math.round(bodyX + player.facing.x * GUN_HOLD_PX) + rattle,
      y: Math.round(bodyY + player.facing.y * GUN_HOLD_PX),
    },
    opacity: playerOpacity(player),
    shapes: heldSprite(player, weapon, tier, angle + swingTurn(weapon, recoil)),
  })
  return player.facing.y < AIMING_UP ? [gun, body] : [body, gun]
}

// KNOCKED OVER

// NOTE: how a co-op player who is out of the fight lies on the floor:
// Downed, crawling on (decided row 4), or BledOut, a still body until the
// break brings them back.
export type Lying = 'Downed' | 'BledOut'

// NOTE: the body's middle over its feet, and how far it drops once turned
// a quarter, so the lying body rests on the floor where the player stood.
const BODY_MIDDLE_PX = 6
const LYING_DROP_PX = BODY_MIDDLE_PX - PLAYER_WIDTH / 2
const CRAWL_FRAME_MS = PLAYER_WALK_FRAME_MS * 2
const BLED_OUT_OPACITY = 0.55

const lyingFrames = (model: Model, lying: Lying): SpriteSet => {
  const sprites = playerSprites(model.appearance, model.player.calling)
  return lying === 'Downed' && vectorLength(model.intent.move) > 0
    ? frameAt(sprites.walk, Math.floor(model.elapsedMs / CRAWL_FRAME_MS))
    : frameAt(sprites.idle, 0)
}

// NOTE: the player's own sprites turned a quarter about the body's middle,
// head toward where they face, with no gun in hand: the same images, so
// nothing new is baked. Crawling plays the walk slower; a bled-out body
// lies still and faded.
export const lyingShapes = (
  model: Model,
  lying: Lying,
): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const facing: Facing = player.facing.x < 0 ? 'Left' : 'Right'
  const foot = footPosition(player, PLAYER_FOOT_OFFSET)
  return [
    group({
      translate: { x: foot.x, y: foot.y - BODY_MIDDLE_PX + LYING_DROP_PX },
      rotate: facing === 'Left' ? -QUARTER_TURN : QUARTER_TURN,
      opacity: lying === 'BledOut' ? BLED_OUT_OPACITY : playerOpacity(player),
      shapes: [
        group({
          translate: { x: 0, y: BODY_MIDDLE_PX },
          shapes: lyingFrames(model, lying)[
            lying === 'BledOut' ? 'Normal' : playerTone(player)
          ][facing],
        }),
      ],
    }),
  ]
}

// NOTE: the knife in hand rests where the gun would; mid-slash the thrust
// blade (knifeSlashShapes) takes its place.
const heldSprite = (
  player: Player,
  weapon: WeaponKind,
  tier: number,
  angle: number,
): Sprite => {
  if (!isWieldingKnife(player)) {
    return gunSprite(weapon, tier, angle)
  }
  return Option.isSome(maybeSlashShare(player)) ? [] : knifeSprite(angle)
}

// THE KNIFE

// NOTE: a stab thrusts the blade out past the body and pulls it back, and a
// thin white crescent sweeps across the arc it reaches, fading as it goes.
// They change every frame of the slash, so they stay plain pixels.
const BLADE_COLOR = '#d9dde6'
const BLADE_TIP_COLOR = '#ffffff'
const HANDLE_COLOR = '#7a4a2a'
const BLADE_LENGTH = 4
const THRUST_PX = 7
const THRUST_SHARE = 0.35
const ARC_DOTS = 7

const thrustOf = (share: number): number =>
  share < THRUST_SHARE
    ? share / THRUST_SHARE
    : 1 - (share - THRUST_SHARE) / (1 - THRUST_SHARE)

const pixelAt = (
  center: Vector,
  direction: Vector,
  distance: number,
  fill: string,
): Canvas.Shape =>
  Canvas.Rect({
    x: Math.round(center.x + direction.x * distance),
    y: Math.round(center.y + direction.y * distance),
    width: 1,
    height: 1,
    fill,
  })

const bladeShapes = (
  player: Player,
  share: number,
): ReadonlyArray<Canvas.Shape> => {
  const base = PLAYER_RADIUS + 1 + thrustOf(share) * THRUST_PX
  return [
    pixelAt(player, player.facing, base - 2, HANDLE_COLOR),
    pixelAt(player, player.facing, base - 1, HANDLE_COLOR),
    ...Array.makeBy(BLADE_LENGTH, index =>
      pixelAt(
        player,
        player.facing,
        base + index,
        index === BLADE_LENGTH - 1 ? BLADE_TIP_COLOR : BLADE_COLOR,
      ),
    ),
  ]
}

const slashArcShapes = (
  player: Player,
  share: number,
): ReadonlyArray<Canvas.Shape> => {
  const radius = PLAYER_RADIUS + KNIFE_RULES.reachPx * 0.8
  const facingAngle = Math.atan2(player.facing.y, player.facing.x)
  const swept = Math.min(1, share * 2.5)
  const alpha = Math.round((1 - share) * 100) / 100
  return Array.filterMap(
    Array.makeBy(ARC_DOTS, index => index),
    index => {
      const along = index / (ARC_DOTS - 1)
      if (along > swept) {
        return Result.failVoid
      }
      const angle = facingAngle + (along * 2 - 1) * KNIFE_RULES.halfArc
      return Result.succeed(
        pixelAt(
          player,
          { x: Math.cos(angle), y: Math.sin(angle) },
          radius,
          `rgba(255, 255, 255, ${alpha})`,
        ),
      )
    },
  )
}

const knifeSlashShapes = (player: Player): ReadonlyArray<Canvas.Shape> =>
  Option.match(maybeSlashShare(player), {
    onNone: () => [],
    onSome: share => [
      ...bladeShapes(player, share),
      ...slashArcShapes(player, share),
    ],
  })

export const playerFlashShapes = (
  player: Player,
): ReadonlyArray<Canvas.Shape> => {
  const { tier, stats, bodyX, bodyY } = playerPose(player)
  const flashReach = stats.muzzleReach + 2
  return [
    ...muzzleFlashShapes(
      player,
      stats,
      tier,
      Math.round(bodyX + player.facing.x * flashReach),
      Math.round(bodyY + player.facing.y * flashReach),
    ),
    ...knifeSlashShapes(player),
  ]
}

export const playerFootY = (player: Player): number =>
  player.y + PLAYER_FOOT_OFFSET

export const playerShadow = (player: Player): Canvas.Shape =>
  footShadow(player, PLAYER_FOOT_OFFSET, PLAYER_SHADOW_WIDTH, SHADOW_COLOR)

export const reloadBarShapes = (player: Player): ReadonlyArray<Canvas.Shape> =>
  Reload.match(player.reload, {
    Ready: () => [],
    Reloading: ({ remainingMs, durationMs }) => {
      const progress =
        durationMs > 0 ? clamp(1 - remainingMs / durationMs, 0, 1) : 1
      const left = Math.round(player.x - RELOAD_BAR_WIDTH / 2)
      const top = Math.round(player.y) - RELOAD_BAR_LIFT_PX
      return [
        Canvas.Rect({
          x: left - 1,
          y: top - 1,
          width: RELOAD_BAR_WIDTH + 2,
          height: 3,
          fill: RELOAD_BAR_BACK_COLOR,
        }),
        Canvas.Rect({
          x: left,
          y: top,
          width: Math.max(1, Math.round(RELOAD_BAR_WIDTH * progress)),
          height: 1,
          fill: RELOAD_BAR_COLOR,
        }),
      ]
    },
  })
