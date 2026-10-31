import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { isAtAmmoWindow, isCounterOpen } from './ammoCounter'
import { type Level, isInsideRoomAt, levelOf } from './arena'
import { bossGroundShapes, bossOverheadShapes } from './bossView'
import { type Camera, sceneOffset } from './camera'
import { coopNameShapes } from './coopMarksView'
import { type Drawable, depthSortedShapes } from './depth'
import {
  airborneParticleShapes,
  blastShapes,
  bulletShapes,
  doorRattleShapes,
  gibShadow,
  groundParticleShapes,
  popupShape,
} from './effectsView'
import { chompShapes, fallenOf, isChomping, toppleShapes } from './endView'
import { maybeQuestDoor } from './firstBreakQuest'
import {
  fridgeDrawables,
  fridgeOverheadShapes,
  lidShadowShapes,
} from './fridgeView'
import { ZERO_VECTOR } from './geometry'
import { ovenFlameShapes, ovenGlowShapes, padlockShapes } from './kitchenView'
import {
  CounterSale,
  type Model,
  Phase,
  ShopState,
  type Vector,
  type Zombie,
} from './model'
import { isBehindWall, occludersOf } from './occluders'
import { isGoodieBeckoning } from './onboarding'
import {
  isLeadShown,
  mateDrawables,
  mateOverheadShapes,
  mateShadowShapes,
} from './partyView'
import {
  playerFlashShapes,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from './playerView'
import {
  auraShapes,
  burpRingShapes,
  doorArrowShapes,
  goodieArrowShapes,
  pickupFootY,
  pickupShapes,
} from './powerupView'
import { hearthFireShapes } from './room'
import { isShopOpenFor, stallPrompt } from './shop'
import { aimSightShapes } from './sightView'
import { group } from './sprite'
import {
  STALL_FOOT_Y,
  type StallLook,
  counterSaleShapes,
  stallGroundShapes,
  stallPromptShapes,
  stallShapes,
} from './stall'
import {
  ghostShapes,
  trapFootY,
  trapOverheadShapes,
  trapShadow,
  trapShapes,
} from './trapView'
import { isRoundActive } from './waves'
import {
  zombieFootY,
  zombieGroundShapes,
  zombieHealthBarShapes,
  zombieShadow,
  zombieShapes,
} from './zombieView'

// OFFSET

const shakeOffset = (model: Model): Vector =>
  isRoundActive(model.phase) && model.shakeSetting === 'On'
    ? model.shake.offset
    : ZERO_VECTOR

export const worldOffset = (model: Model, camera: Camera): Vector =>
  sceneOffset(camera, shakeOffset(model))

// STALL

const stallLook = (model: Model): StallLook => {
  if (isCounterOpen(model)) {
    return isAtAmmoWindow(model) ||
      CounterSale.isAnyOf(['Selling'])(model.counterSale)
      ? 'CounterAwake'
      : 'Counter'
  } else if (!isShopOpenFor(model.phase)) {
    return 'Closed'
  } else if (ShopState.isAnyOf(['Away'])(model.shop)) {
    return 'Beckoning'
  } else {
    return 'Open'
  }
}

// CULLING

const CULL_MARGIN_PX = 24

// NOTE: on a map bigger than the window, a zombie out of the camera's view
// costs nothing to draw, and one outside the house, in the yard or past the
// map's edge, is never drawn at all. The margin keeps a big zombie whose feet
// are just off the edge drawn, along with its shadow and its health bar.
const isOnCamera =
  (camera: Camera) =>
  ({ x, y }: Vector): boolean =>
    x > camera.x - CULL_MARGIN_PX &&
    x < camera.x + camera.width + CULL_MARGIN_PX &&
    y > camera.y - CULL_MARGIN_PX &&
    y < camera.y + camera.height + CULL_MARGIN_PX

const shownZombies = (model: Model, camera: Camera): ReadonlyArray<Zombie> => {
  const level = levelOf(model)
  const onCamera = isOnCamera(camera)
  return Array.filter(
    model.zombies,
    zombie => onCamera(zombie) && isInsideRoomAt(level, zombie),
  )
}

// GROUND

const groundShapes = (
  model: Model,
  look: StallLook,
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Canvas.Shape> => [
  ...hearthFireShapes(levelOf(model), model.elapsedMs),
  ...ovenGlowShapes(model),
  ...stallGroundShapes(look, model.elapsedMs),
  ...(isLeadShown(model) ? [playerShadow(model.player)] : []),
  ...mateShadowShapes(model),
  ...zombieGroundShapes(zombies, model.elapsedMs),
  ...Array.filterMap(zombies, zombieShadow),
  ...bossGroundShapes(model),
  ...Array.filterMap(model.traps, trapShadow(levelOf(model))),
  ...Array.filterMap(model.particles, gibShadow),
  ...groundParticleShapes(model.particles),
  ...ghostShapes(model),
  ...doorRattleShapes(model),
  ...aimSightShapes(model),
  ...Array.flatMap(model.bullets, bulletShapes),
  ...lidShadowShapes(model),
]

// STANDING

const standingDrawables = (
  model: Model,
  look: StallLook,
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Drawable> => {
  const drawZombie = zombieShapes(model.player, model.elapsedMs, model.boss)
  const isChomp = isChomping(model.phase)
  const level = levelOf(model)
  const drawTrap = trapShapes(level, model.elapsedMs)
  return [
    ...Array.map(occludersOf(level), ({ floorY, shapes }): Drawable => ({
      footY: floorY,
      rank: 'Wall',
      shapes,
    })),
    {
      footY: STALL_FOOT_Y,
      rank: 'Prop',
      shapes: stallShapes(look, model.elapsedMs),
    },
    ...Array.map(model.traps, (trap): Drawable => ({
      footY: trapFootY(level, trap),
      rank: 'Trap',
      shapes: drawTrap(trap),
    })),
    ...Array.map(model.pickups, (pickup): Drawable => ({
      footY: pickupFootY(pickup),
      rank: 'Pickup',
      shapes: pickupShapes(pickup),
    })),
    ...Array.map(zombies, (zombie): Drawable => ({
      footY: zombieFootY(zombie),
      rank: 'Zombie',
      shapes: isChomp
        ? chompShapes(model, zombie, drawZombie(zombie))
        : drawZombie(zombie),
    })),
    ...(isLeadShown(model)
      ? [
          {
            footY: playerFootY(model.player),
            rank: 'Player' as const,
            shapes: toppleShapes(model, [
              ...auraShapes(model.player, model.boosts, model.elapsedMs),
              ...playerShapes(fallenOf(model)),
            ]),
          },
        ]
      : []),
    ...mateDrawables(model),
    ...fridgeDrawables(model),
  ]
}

// OVERHEAD

// NOTE: a zombie still in a doorway behind the wall's face is covered by the
// lintel, so its bar would float over the wall. It shows once it steps in.
const isInView =
  (level: Level) =>
  (zombie: Zombie): boolean =>
    !isBehindWall(level)(zombie.x, zombieFootY(zombie))

const overheadShapes = (
  model: Model,
  camera: Camera,
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Canvas.Shape> => [
  ...playerFlashShapes(model.player),
  ...ovenFlameShapes(model),
  ...Array.flatMap(
    model.traps,
    trapOverheadShapes(levelOf(model), model.elapsedMs),
  ),
  ...Array.flatMap(
    Array.filter(zombies, isInView(levelOf(model))),
    zombieHealthBarShapes,
  ),
  ...Array.flatMap(model.blasts, blastShapes),
  ...Array.flatMap(model.callouts, burpRingShapes),
  ...bossOverheadShapes(model),
  ...airborneParticleShapes(model.particles),
  ...(isGoodieBeckoning(model)
    ? Array.flatMap(model.pickups, goodieArrowShapes)
    : []),
  ...Option.match(maybeQuestDoor(model), {
    onNone: () => [],
    onSome: door => doorArrowShapes(door, model.elapsedMs),
  }),
  ...Array.map(model.popups, popupShape(camera)),
  ...reloadBarShapes(model.player),
  ...fridgeOverheadShapes(model),
  ...mateOverheadShapes(model),
  ...coopNameShapes(model),
  ...stallPromptShapes(stallPrompt(model)),
  ...CounterSale.match(model.counterSale, {
    Quiet: () => [],
    Selling: ({ ageMs, line }) => counterSaleShapes(ageMs, line),
  }),
  ...padlockShapes(model),
]

// WORLD

const titleWorldShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...hearthFireShapes(levelOf(model), model.screenMs),
  ...stallGroundShapes('Closed', model.screenMs),
  ...stallShapes('Closed', model.screenMs),
]

const playWorldShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  const look = stallLook(model)
  const zombies = shownZombies(model, camera)
  return [
    ...groundShapes(model, look, zombies),
    ...depthSortedShapes(standingDrawables(model, look, zombies)),
    ...overheadShapes(model, camera, zombies),
  ]
}

const worldShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Phase.isAnyOf(['Ready'])(model.phase)
    ? titleWorldShapes(model)
    : playWorldShapes(model, camera)

export const worldLayerShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  group({
    translate: worldOffset(model, camera),
    shapes: worldShapes(model, camera),
  }),
]
