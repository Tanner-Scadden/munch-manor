import { Array, Option, Result } from 'effect'
import { Canvas } from 'foldkit'

import { type Box, type Level, boxCenter, levelOf } from './arena'
import {
  MUZZLE_FLASH_BIG_MS,
  MUZZLE_FLASH_MS,
  SHADOW_COLOR,
  TRAP_HIT_FLASH_MS,
  TRAP_HIT_PULSE_MS,
} from './constants'
import {
  AIMING_UP,
  FULL_TURN,
  HEALTH_BAR_BACK_COLOR,
  HEALTH_BAR_GAP,
  footShadow,
  placeSprite,
} from './drawing'
import {
  type DoorId,
  type Model,
  Phase,
  ShopState,
  Trap,
  type Turret,
  TurretGun,
  type Vector,
} from './model'
import { MUZZLE_FLASHES } from './playerView'
import { type Facing, type Sprite, type Tone, group } from './sprite'
import { gunSprite } from './sprites/guns'
import {
  BARRICADE_SPRITES,
  GNOME_HEIGHT,
  GNOME_SPRITES,
  type Lay,
} from './sprites/traps'
import {
  PlaceVerdict,
  TRAPS,
  TURRET_WEAPON,
  TrapSpot,
  barricadedDoors,
  maybePlacement,
  spotBox,
  stageOf,
  trapBox,
  trapCenter,
} from './traps'
import { WEAPONS } from './weapons'

// TRAPS

const LAYS: Readonly<Record<DoorId, Lay>> = {
  North: 'Across',
  South: 'Across',
  West: 'Upright',
  East: 'Upright',
  Back: 'Across',
  Window: 'Upright',
}

const trapTone = (hitRemainingMs: number): Tone =>
  hitRemainingMs > 0 && TRAP_HIT_PULSE_MS - hitRemainingMs < TRAP_HIT_FLASH_MS
    ? 'Flash'
    : 'Normal'

const TRAP_JOLT_MS = 35

const trapJolt = (hitRemainingMs: number): number => {
  if (hitRemainingMs <= 0) {
    return 0
  } else {
    return Math.floor(hitRemainingMs / TRAP_JOLT_MS) % 2 === 0 ? 1 : -1
  }
}

const barricadeSprite = (door: DoorId, hp: number, tone: Tone): Sprite =>
  BARRICADE_SPRITES[LAYS[door]][stageOf('Barricade', hp)][tone]

const TURRET_FOOT_DROP = 4
const TURRET_IDLE_SWAY = 0.35
const TURRET_IDLE_SWAY_MS = 900
const TURRET_HEALTH_BAR_WIDTH = 10
const TURRET_HEALTH_COLOR = '#9be36a'

const turretFoot = (center: Vector): Vector => ({
  x: Math.round(center.x),
  y: Math.round(center.y) + TURRET_FOOT_DROP,
})

const msSinceTurretShot = (gun: TurretGun): Option.Option<number> =>
  TurretGun.match(gun, {
    Armed: () => Option.none(),
    CoolingDown: ({ remainingMs }) =>
      Option.some(WEAPONS[TURRET_WEAPON].fireIntervalMs - remainingMs),
  })

const turretAngle = (
  facing: Vector,
  gun: TurretGun,
  id: number,
  elapsedMs: number,
): number => {
  const aim = Math.atan2(facing.y, facing.x)
  return TurretGun.match(gun, {
    Armed: () =>
      aim +
      TURRET_IDLE_SWAY *
        Math.sin((FULL_TURN * elapsedMs) / TURRET_IDLE_SWAY_MS + id),
    CoolingDown: () => aim,
  })
}

const turretHealthBar = (
  center: Vector,
  hp: number,
): ReadonlyArray<Canvas.Shape> => {
  if (hp >= TRAPS.Turret.hp) {
    return []
  }

  const foot = turretFoot(center)
  const top = foot.y - GNOME_HEIGHT - HEALTH_BAR_GAP
  const left = foot.x - TURRET_HEALTH_BAR_WIDTH / 2
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: TURRET_HEALTH_BAR_WIDTH + 2,
      height: 3,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Canvas.Rect({
      x: left,
      y: top,
      width: Math.max(
        1,
        Math.round((TURRET_HEALTH_BAR_WIDTH * hp) / TRAPS.Turret.hp),
      ),
      height: 1,
      fill: TURRET_HEALTH_COLOR,
    }),
  ]
}

const gnomeShapes = (
  center: Vector,
  facing: Vector,
  angle: number,
  tone: Tone,
  jolt: number,
): ReadonlyArray<Canvas.Shape> => {
  const foot = turretFoot(center)
  const side: Facing = facing.x < 0 ? 'Left' : 'Right'
  const body = group({
    translate: { x: foot.x + jolt, y: foot.y },
    shapes: GNOME_SPRITES[tone][side],
  })
  const gun = group({
    translate: { x: foot.x + jolt, y: Math.round(center.y) },
    shapes: gunSprite(TURRET_WEAPON, 0, angle),
  })
  return Math.sin(angle) < AIMING_UP ? [gun, body] : [body, gun]
}

const turretShapes = (
  level: Level,
  turret: Turret,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  gnomeShapes(
    trapCenter(level, turret),
    turret.facing,
    turretAngle(turret.facing, turret.gun, turret.id, elapsedMs),
    trapTone(turret.hitRemainingMs),
    trapJolt(turret.hitRemainingMs),
  )

const turretOverheadShapes = (
  level: Level,
  turret: Turret,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const center = trapCenter(level, turret)
  const angle = turretAngle(turret.facing, turret.gun, turret.id, elapsedMs)
  const reach = WEAPONS[TURRET_WEAPON].muzzleReach + 1
  const flash = Option.match(msSinceTurretShot(turret.gun), {
    onNone: () => [],
    onSome: msSinceShot =>
      msSinceShot < MUZZLE_FLASH_MS
        ? MUZZLE_FLASHES[WEAPONS[TURRET_WEAPON].flash](
            msSinceShot < MUZZLE_FLASH_BIG_MS,
            Math.round(center.x + Math.cos(angle) * reach),
            Math.round(center.y + Math.sin(angle) * reach),
          )
        : [],
  })
  return [...flash, ...turretHealthBar(center, turret.hp)]
}

export const trapOverheadShapes =
  (level: Level, elapsedMs: number) =>
  (trap: Trap): ReadonlyArray<Canvas.Shape> =>
    Trap.match(trap, {
      Barricade: () => [],
      Turret: turret => turretOverheadShapes(level, turret, elapsedMs),
    })

export const trapShapes =
  (level: Level, elapsedMs: number) =>
  (trap: Trap): ReadonlyArray<Canvas.Shape> =>
    Trap.match(trap, {
      Barricade: ({ door, hp, hitRemainingMs }) => {
        const center = trapCenter(level, trap)
        return [
          placeSprite(
            center.x + trapJolt(hitRemainingMs),
            center.y,
            barricadeSprite(door, hp, trapTone(hitRemainingMs)),
          ),
        ]
      },
      Turret: turret => turretShapes(level, turret, elapsedMs),
    })

export const trapFootY = (level: Level, trap: Trap): number =>
  Trap.match(trap, {
    Barricade: () => trapBox(level, trap).bottom,
    Turret: () => trapCenter(level, trap).y + TURRET_FOOT_DROP,
  })

const TURRET_SHADOW_WIDTH = 8

export const trapShadow =
  (level: Level) =>
  (trap: Trap): Result.Result<Canvas.Shape, void> =>
    Trap.match(trap, {
      Barricade: (): Result.Result<Canvas.Shape, void> => Result.failVoid,
      Turret: (): Result.Result<Canvas.Shape, void> =>
        Result.succeed(
          footShadow(
            trapCenter(level, trap),
            TURRET_FOOT_DROP,
            TURRET_SHADOW_WIDTH,
            SHADOW_COLOR,
          ),
        ),
    })

const GHOST_OPACITY = 0.5
const GHOST_OK_COLOR = '#9be36a'
const GHOST_BLOCKED_COLOR = '#ff6b5e'
const DOORWAY_HINT_COLOR = 'rgba(255, 224, 102, 0.8)'
const DOORWAY_HINT_PULSE_MS = 600

const ghostSprite = (
  spot: TrapSpot,
  model: Model,
): ReadonlyArray<Canvas.Shape> =>
  TrapSpot.match(spot, {
    Doorway: ({ door }) => {
      const center = boxCenter(spotBox(levelOf(model), spot))
      return [
        placeSprite(
          center.x,
          center.y,
          barricadeSprite(door, TRAPS.Barricade.hp, 'Normal'),
        ),
      ]
    },
    Floor: () =>
      gnomeShapes(
        boxCenter(spotBox(levelOf(model), spot)),
        model.player.facing,
        Math.atan2(model.player.facing.y, model.player.facing.x),
        'Normal',
        0,
      ),
  })

const outlineShape = (box: Box, color: string): Canvas.Shape =>
  Canvas.Rect({
    x: box.left + 0.5,
    y: box.top + 0.5,
    width: box.right - box.left - 1,
    height: box.bottom - box.top - 1,
    stroke: color,
    lineWidth: 1,
  })

const openDoorwayHints = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const boarded = barricadedDoors(model.traps)
  const level = levelOf(model)
  const isLit = Math.floor(model.elapsedMs / DOORWAY_HINT_PULSE_MS) % 2 === 0
  return isLit
    ? Array.filterMap(level.doorIds, door =>
        Array.contains(boarded, door)
          ? Result.failVoid
          : Result.succeed(
              outlineShape(level.thresholds[door].box, DOORWAY_HINT_COLOR),
            ),
      )
    : []
}

const isPlacingNow = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !ShopState.isAnyOf(['Browsing'])(model.shop)

export const ghostShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (!isPlacingNow(model)) {
    return []
  }

  return Option.match(maybePlacement(model), {
    onNone: () => [],
    onSome: ({ maybeSpot, verdict }) =>
      Option.match(maybeSpot, {
        onNone: () => openDoorwayHints(model),
        onSome: spot => [
          group({
            opacity: GHOST_OPACITY,
            shapes: ghostSprite(spot, model),
          }),
          outlineShape(
            spotBox(levelOf(model), spot),
            PlaceVerdict.isAnyOf(['Placeable'])(verdict)
              ? GHOST_OK_COLOR
              : GHOST_BLOCKED_COLOR,
          ),
        ],
      }),
  })
}
