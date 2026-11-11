import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { group } from '../../art/sprite'
import { hatRiseOf } from '../../art/sprites/hatArt'
import { caseDrawables } from '../../features/cases/caseView'
import { crateDrawables, mendRingsOf } from '../../features/crates/crateView'
import { dareDrawables, dareOverheadShapes } from '../../features/dare/dareView'
import { frontDoorShapes } from '../../features/dare/frontDoorView'
import {
  chompShapes,
  fallenOf,
  isChomping,
  toppleShapes,
} from '../../features/end/endView'
import {
  fridgeDrawables,
  fridgeOverheadShapes,
  lidShadowShapes,
} from '../../features/fridge/fridgeView'
import { pantryDrawables } from '../../features/kitchen/pantryView'
import { maybeQuestMark } from '../../features/onboarding/firstBreakQuest'
import { isGoodieBeckoning } from '../../features/onboarding/onboarding'
import { questKeyDrawables } from '../../features/onboarding/questKeyView'
import { questLockShapes } from '../../features/onboarding/questLockView'
import { coopNameShapes } from '../../features/onlineRun/coopMarksView'
import {
  RATTLES_FOOT_Y,
  RATTLES_GROUND_SHAPES,
  type RattlesLook,
  rattlesShapes,
} from '../../features/rattles/rattlesSpot'
import {
  stationGroundShapes,
  stationOverheadShapes,
} from '../../features/stations/stationView'
import { bossGroundShapes, bossOverheadShapes } from '../../render/bossView'
import { type Camera, sceneOffset } from '../../render/camera'
import { cellarDarkOf } from '../../render/cellarDark'
import { type Drawable, depthSortedShapes } from '../../render/depth'
import {
  airborneParticleShapes,
  blastShapes,
  bulletShapes,
  doorRattleShapes,
  gibShadow,
  groundParticleShapes,
  popupShape,
} from '../../render/effectsView'
import { kitchenGearGroundShapes } from '../../render/kitchenGearView'
import { isBehindWall, occludersOf } from '../../render/occluders'
import {
  type MateModel,
  isLeadArmed,
  isLeadInHouse,
  leadBodyShapes,
  mateDrawables,
  mateModelsOf,
  mateOverheadShapes,
  mateShadowShapes,
  reviveRingGroundShapes,
} from '../../render/partyView'
import {
  playerFlashShapes,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from '../../render/playerView'
import {
  auraShapes,
  burpRingShapes,
  doorArrowShapes,
  goodieArrowShapes,
  pickupFootY,
  pickupShapes,
} from '../../render/powerupView'
import { kitchenLeakShapes } from '../../render/room/kitchenLeak'
import {
  ovenFlameShapes,
  ovenGlowShapes,
  padlockShapes,
} from '../../render/room/kitchenView'
import {
  fallenChandelierDrawables,
  hearthFireShapes,
  hungChandelierShapes,
} from '../../render/room/room'
import { aimSightShapes } from '../../render/sightView'
import {
  ghostShapes,
  trapFootY,
  trapOverheadShapes,
  trapShadow,
  trapShapes,
} from '../../render/trapView'
import {
  zombieFootY,
  zombieGroundShapes,
  zombieHealthBarShapes,
  zombieShadow,
  zombieShapes,
} from '../../render/zombieView'
import { type Level, isInsideRoomAt, levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import { type Vector, type Zombie } from '../../world/schema/entitySchema'
import { Phase } from '../../world/schema/worldSchema'
import { ZERO_VECTOR } from '../../world/step/geometry'
import { isRoundActive } from '../../world/waves/waves'

// OFFSET

const shakeOffset = (model: Model): Vector =>
  isRoundActive(model.phase) && model.shakeSetting === 'On'
    ? model.shake.offset
    : ZERO_VECTOR

export const worldOffset: {
  (camera: Camera): (model: Model) => Vector
  (model: Model, camera: Camera): Vector
} = Function.dual(2, (model: Model, camera: Camera): Vector =>
  sceneOffset(camera, shakeOffset(model)),
)

// RATTLES

// NOTE: Rattles is up for the breaks and dozes through a wave.
const rattlesLook = (model: Model): RattlesLook =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? 'Awake' : 'Dozing'

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
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Canvas.Shape> => [
  ...hearthFireShapes(levelOf(model), model.elapsedMs),
  ...kitchenLeakShapes(model),
  ...ovenGlowShapes(model),
  ...kitchenGearGroundShapes(model),
  ...RATTLES_GROUND_SHAPES,
  ...reviveRingGroundShapes(model),
  ...(isLeadInHouse(model) ? [playerShadow(focusOf(model).player)] : []),
  ...mateShadowShapes(mates),
  ...zombieGroundShapes(zombies, model.elapsedMs),
  ...Array.filterMap(zombies, zombieShadow),
  ...bossGroundShapes(model),
  ...Array.filterMap(model.traps, trapShadow(levelOf(model))),
  ...Array.filterMap(model.particles, gibShadow),
  ...groundParticleShapes(model.particles),
  ...ghostShapes(model),
  ...doorRattleShapes(model),
  ...(isLeadArmed(model) ? aimSightShapes(model) : []),
  ...Array.flatMap(model.bullets, bulletShapes),
  ...lidShadowShapes(model),
  ...stationGroundShapes(model),
]

// STANDING

const standingDrawables = (
  model: Model,
  look: RattlesLook,
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Drawable> => {
  const drawZombie = zombieShapes(
    focusOf(model).player,
    model.elapsedMs,
    model.boss,
    model.pacing.loneMs,
  )
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
      footY: RATTLES_FOOT_Y,
      rank: 'Prop',
      shapes: rattlesShapes(look, model.elapsedMs),
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
    {
      footY: playerFootY(focusOf(model).player),
      rank: 'Player',
      shapes: leadBodyShapes(model, () =>
        toppleShapes(model, [
          ...auraShapes(
            focusOf(model).player,
            focusOf(model).boosts,
            model.elapsedMs,
          ),
          ...playerShapes(fallenOf(model)),
        ]),
      ),
    },
    ...mateDrawables(mates),
    ...fridgeDrawables(model),
    ...pantryDrawables(model),
    ...questKeyDrawables(model),
    ...caseDrawables(model),
    ...crateDrawables(model),
    ...fallenChandelierDrawables(model),
    ...dareDrawables(model),
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
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Canvas.Shape> => [
  ...(isLeadArmed(model) ? playerFlashShapes(focusOf(model).player) : []),
  ...hungChandelierShapes(model),
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
  ...mendRingsOf(model),
  ...stationOverheadShapes(model),
  ...Option.match(maybeQuestMark(model), {
    onNone: () => [],
    onSome: door => doorArrowShapes(door, model.elapsedMs),
  }),
  ...questLockShapes(model),
  ...Array.map(model.popups, popupShape(camera)),
  ...(isLeadArmed(model)
    ? reloadBarShapes(focusOf(model).player, hatRiseOf(model.appearance))
    : []),
  ...fridgeOverheadShapes(model),
  ...dareOverheadShapes(model),
  ...frontDoorShapes(model),
  ...mateOverheadShapes(model, mates),
  ...coopNameShapes(model),
  ...padlockShapes(model),
]

// WORLD

const titleWorldShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...hearthFireShapes(levelOf(model), model.screenMs),
  ...RATTLES_GROUND_SHAPES,
  ...rattlesShapes('Dozing', model.screenMs),
  ...hungChandelierShapes(model),
]

const playWorldShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  const look = rattlesLook(model)
  const onCamera = shownZombies(model, camera)
  const mates = mateModelsOf(model)
  // NOTE: in the cellar's dark a zombie is only its eyes, over the mask.
  return Option.match(cellarDarkOf(model, camera), {
    onNone: () => [
      ...groundShapes(model, onCamera, mates),
      ...depthSortedShapes(standingDrawables(model, look, onCamera, mates)),
      ...overheadShapes(model, camera, onCamera, mates),
    ],
    onSome: dark => {
      const zombies = Array.filter(onCamera, zombie => !dark.isHidden(zombie))
      return [
        ...groundShapes(model, zombies, mates),
        ...depthSortedShapes(standingDrawables(model, look, zombies, mates)),
        ...dark.maskShapes,
        ...dark.eyesShapes(onCamera),
        ...overheadShapes(model, camera, zombies, mates),
      ]
    },
  })
}

const worldShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Phase.isAnyOf(['Ready'])(model.phase)
    ? titleWorldShapes(model)
    : playWorldShapes(model, camera)

export const worldLayerShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> => [
    group({
      translate: worldOffset(model, camera),
      shapes: worldShapes(model, camera),
    }),
  ],
)
