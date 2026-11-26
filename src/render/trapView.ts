import { Array, Function, Option, Result } from 'effect'

import { type Facing, type Sprite, type Tone, group } from '../art/sprite'
import { gunSprite } from '../art/sprites/guns'
import {
  BARRICADE_SPRITES,
  GNOME_HEIGHT,
  GNOME_SPRITES,
  type Lay,
} from '../art/sprites/traps'
import {
  MUZZLE_FLASH_BIG_MS,
  MUZZLE_FLASH_MS,
  SHADOW_COLOR,
  TRAP_HIT_FLASH_MS,
  TRAP_HIT_PULSE_MS,
} from '../shared/constants'
import {
  PlaceVerdict,
  TURRET_WEAPON,
  TrapSpot,
  type TrapStage,
  barricadedDoors,
  maybePlacement,
  spotBox,
  stageOf,
  trapBox,
  trapCenter,
} from '../world/gear/traps'
import { WEAPONS } from '../world/gear/weapons'
import { type Level, levelOf } from '../world/level/arena'
import { type Box, boxCenter } from '../world/level/tileGrid'
import { focusOf, focusSlotOf } from '../world/party/party'
import type { DoorId, Vector } from '../world/schema/entitySchema'
import type { World } from '../world/schema/world'
import { Trap, type Turret, TurretGun } from '../world/schema/worldSchema'
import { isBreak } from '../world/waves/waves'
import { type Drawable, glowOn } from './depth'
import * as Draw from './draw'
import {
  AIMING_UP,
  FULL_TURN,
  HEALTH_BAR_BACK_COLOR,
  HEALTH_BAR_GAP,
  footShadow,
  placeSprite,
} from './drawing'
import { MUZZLE_FLASHES, flashPointOf } from './playerView'

// TRAPS

const LAYS: Readonly<Record<DoorId, Lay>> = {
  North: 'Across',
  South: 'Across',
  West: 'Upright',
  East: 'Upright',
  Back: 'Across',
  Window: 'Upright',
  WestTop: 'Across',
  WestBottom: 'Across',
  EastTop: 'Across',
  EastBottom: 'Across',
  FarTop: 'Across',
  FarBottom: 'Across',
  Front: 'Across',
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

const barricadeSprite = (door: DoorId, stage: TrapStage, tone: Tone): Sprite =>
  BARRICADE_SPRITES[LAYS[door]][stage][tone]

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
  maxHp: number,
): ReadonlyArray<Draw.Shape> => {
  if (hp >= maxHp) {
    return []
  }

  const foot = turretFoot(center)
  const top = foot.y - GNOME_HEIGHT - HEALTH_BAR_GAP
  const left = foot.x - TURRET_HEALTH_BAR_WIDTH / 2
  return [
    Draw.Rect({
      x: left - 1,
      y: top - 1,
      width: TURRET_HEALTH_BAR_WIDTH + 2,
      height: 3,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Draw.Rect({
      x: left,
      y: top,
      width: Math.max(1, Math.round((TURRET_HEALTH_BAR_WIDTH * hp) / maxHp)),
      height: 1,
      fill: TURRET_HEALTH_COLOR,
    }),
  ]
}

// NOTE: the gnome's gun is held by this pixel, its art turned about it.
const turretHoldOf = (center: Vector, jolt: number): Vector => ({
  x: turretFoot(center).x + jolt,
  y: Math.round(center.y),
})

const gnomeShapes = (
  center: Vector,
  facing: Vector,
  angle: number,
  tone: Tone,
  jolt: number,
): ReadonlyArray<Draw.Shape> => {
  const foot = turretFoot(center)
  const side: Facing = facing.x < 0 ? 'Left' : 'Right'
  const body = group({
    translate: { x: foot.x + jolt, y: foot.y },
    shapes: GNOME_SPRITES[tone][side],
  })
  const gun = group({
    translate: turretHoldOf(center, jolt),
    shapes: gunSprite(TURRET_WEAPON, 0, angle),
  })
  return Math.sin(angle) < AIMING_UP ? [gun, body] : [body, gun]
}

const turretShapes = (
  level: Level,
  turret: Turret,
  elapsedMs: number,
): ReadonlyArray<Draw.Shape> =>
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
): ReadonlyArray<Draw.Shape> =>
  turretHealthBar(trapCenter(level, turret), turret.hp, turret.maxHp)

export const trapOverheadShapes: {
  (level: Level): (trap: Trap) => ReadonlyArray<Draw.Shape>
  (trap: Trap, level: Level): ReadonlyArray<Draw.Shape>
} = Function.dual(2, (trap: Trap, level: Level): ReadonlyArray<Draw.Shape> =>
  Trap.match(trap, {
    Barricade: () => [],
    Turret: turret => turretOverheadShapes(level, turret),
  }),
)

// NOTE: the gnome's muzzle flash stands on the gnome's own plane, as its gun
// does, centered just past the gun's drawn tip (`flashPointOf`), so in 3D it
// moves with the gnome at any angle.
const turretFlashShapes = (
  level: Level,
  turret: Turret,
  elapsedMs: number,
): ReadonlyArray<Draw.Shape> =>
  Option.match(msSinceTurretShot(turret.gun), {
    onNone: () => [],
    onSome: msSinceShot => {
      if (msSinceShot >= MUZZLE_FLASH_MS) {
        return []
      }
      const angle = turretAngle(turret.facing, turret.gun, turret.id, elapsedMs)
      const flash = flashPointOf({
        hold: turretHoldOf(
          trapCenter(level, turret),
          trapJolt(turret.hitRemainingMs),
        ),
        kind: TURRET_WEAPON,
        angle,
      })
      return MUZZLE_FLASHES[WEAPONS[TURRET_WEAPON].flash](
        msSinceShot < MUZZLE_FLASH_BIG_MS,
        flash.x,
        flash.y,
      )
    },
  })

export const trapGlowDrawables: {
  (level: Level, elapsedMs: number): (trap: Trap) => ReadonlyArray<Drawable>
  (trap: Trap, level: Level, elapsedMs: number): ReadonlyArray<Drawable>
} = Function.dual(
  3,
  (trap: Trap, level: Level, elapsedMs: number): ReadonlyArray<Drawable> =>
    Trap.match(trap, {
      Barricade: () => [],
      Turret: turret => {
        const shapes = turretFlashShapes(level, turret, elapsedMs)
        return Array.isReadonlyArrayNonEmpty(shapes)
          ? [glowOn({ bodyFootY: trapFootY(level, trap), shapes })]
          : []
      },
    }),
)

export const trapShapes: {
  (level: Level, elapsedMs: number): (trap: Trap) => ReadonlyArray<Draw.Shape>
  (trap: Trap, level: Level, elapsedMs: number): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (trap: Trap, level: Level, elapsedMs: number): ReadonlyArray<Draw.Shape> =>
    Trap.match(trap, {
      Barricade: ({ door, hitRemainingMs }) => {
        const center = trapCenter(level, trap)
        return [
          placeSprite(
            center.x + trapJolt(hitRemainingMs),
            center.y,
            barricadeSprite(door, stageOf(trap), trapTone(hitRemainingMs)),
          ),
        ]
      },
      Turret: turret => turretShapes(level, turret, elapsedMs),
    }),
)

export const trapFootY: {
  (trap: Trap): (level: Level) => number
  (level: Level, trap: Trap): number
} = Function.dual(2, (level: Level, trap: Trap): number =>
  Trap.match(trap, {
    Barricade: () => trapBox(level, trap).bottom,
    Turret: () => trapCenter(level, trap).y + TURRET_FOOT_DROP,
  }),
)

const TURRET_SHADOW_WIDTH = 8

export const trapShadow =
  (level: Level) =>
  (trap: Trap): Result.Result<Draw.Shape, void> =>
    Trap.match(trap, {
      Barricade: (): Result.Result<Draw.Shape, void> => Result.failVoid,
      Turret: (): Result.Result<Draw.Shape, void> =>
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

const ghostSprite = (spot: TrapSpot, model: World): ReadonlyArray<Draw.Shape> =>
  TrapSpot.match(spot, {
    Doorway: ({ door }) => {
      const center = boxCenter(spotBox(levelOf(model), spot))
      return [
        placeSprite(
          center.x,
          center.y,
          barricadeSprite(door, 'Sturdy', 'Normal'),
        ),
      ]
    },
    Floor: () =>
      gnomeShapes(
        boxCenter(spotBox(levelOf(model), spot)),
        focusOf(model).player.facing,
        Math.atan2(
          focusOf(model).player.facing.y,
          focusOf(model).player.facing.x,
        ),
        'Normal',
        0,
      ),
  })

const outlineShape = (box: Box, color: string): Draw.Shape =>
  Draw.Rect({
    x: box.left + 0.5,
    y: box.top + 0.5,
    width: box.right - box.left - 1,
    height: box.bottom - box.top - 1,
    stroke: color,
    lineWidth: 1,
  })

const openDoorwayHints = (model: World): ReadonlyArray<Draw.Shape> => {
  const boarded = barricadedDoors(model.traps)
  const level = levelOf(model)
  const isLit = Math.floor(model.elapsedMs / DOORWAY_HINT_PULSE_MS) % 2 === 0
  return isLit
    ? Array.filterMap(level.doorIds, door =>
        // NOTE: at most 13 doors by at most 8 traps.
        // oxlint-disable-next-line munch/no-nested-scan
        Array.contains(boarded, door)
          ? Result.failVoid
          : Result.succeed(
              outlineShape(level.thresholds[door].box, DOORWAY_HINT_COLOR),
            ),
      )
    : []
}

// NOTE: the spot the placement ghost stands on, in a break only.
const ghostSpotOf = (model: World): Option.Option<TrapSpot> =>
  isBreak(model)
    ? Option.flatMap(
        maybePlacement(model, focusSlotOf(model)),
        ({ maybeSpot }) => maybeSpot,
      )
    : Option.none()

// NOTE: on the floor: the ghost's footprint, green where it may go and red
// where it may not, or the open doorways' hints while no spot is picked.
export const ghostShapes = (model: World): ReadonlyArray<Draw.Shape> =>
  isBreak(model)
    ? Option.match(maybePlacement(model, focusSlotOf(model)), {
        onNone: () => [],
        onSome: ({ maybeSpot, verdict }) =>
          Option.match(maybeSpot, {
            onNone: () => openDoorwayHints(model),
            onSome: spot => [
              outlineShape(
                spotBox(levelOf(model), spot),
                PlaceVerdict.isAnyOf(['Placeable'])(verdict)
                  ? GHOST_OK_COLOR
                  : GHOST_BLOCKED_COLOR,
              ),
            ],
          }),
      })
    : []

// NOTE: the trap itself, standing carved as a placed one does, see-through.
export const ghostDrawables = (model: World): ReadonlyArray<Drawable> =>
  Option.match(ghostSpotOf(model), {
    onNone: () => [],
    onSome: spot => {
      const box = spotBox(levelOf(model), spot)
      return [
        {
          footY: TrapSpot.match(spot, {
            Doorway: () => box.bottom,
            Floor: () => boxCenter(box).y + TURRET_FOOT_DROP,
          }),
          rank: 'Trap',
          shapes: [
            group({ opacity: GHOST_OPACITY, shapes: ghostSprite(spot, model) }),
          ],
        },
      ]
    },
  })
