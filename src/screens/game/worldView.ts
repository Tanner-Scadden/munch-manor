import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { group } from '../../art/sprite'
import { hatRiseOf } from '../../art/sprites/hatArt'
import { caseDrawables } from '../../features/cases/caseView'
import { crateDrawables, mendRingsOf } from '../../features/crates/crateView'
import {
  dareDrawables,
  dareGroundShapes,
  dareOverheadShapes,
} from '../../features/dare/dareView'
import { findDrawables, findOverheadShapes } from '../../features/dare/findView'
import { frontDoorShapes } from '../../features/dare/frontDoorView'
import { hubTouchDrawables } from '../../features/dining/hubTouchView'
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
  stationDrawables,
  stationGroundShapes,
  stationOverheadShapes,
} from '../../features/stations/stationView'
import { backDoorDrawables } from '../../render/backDoorView'
import { bossGroundShapes, bossOverheadShapes } from '../../render/bossView'
import {
  type Camera,
  type ViewMargin,
  isInView,
  sceneOffset,
} from '../../render/camera'
import { cellarDarkOf } from '../../render/cellarDark'
import { type Drawable, depthSortedShapes } from '../../render/depth'
import { isBehindWall } from '../../render/doorways'
import {
  bulletShapes,
  doorRattleShapes,
  gibShadow,
  popupShape,
} from '../../render/effectsView'
import type { WorldStrata } from '../../render/iso/frame'
import {
  kitchenGearDrawables,
  kitchenGearGroundShapes,
} from '../../render/kitchenGearView'
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
  playerFlashDrawable,
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
  ovenWindowDrawables,
  padlockShapes,
  wetFloorSignDrawables,
} from '../../render/room/kitchenView'
import {
  fallenChandelierDrawables,
  hearthFireDrawables,
  hungChandelierShapes,
} from '../../render/room/room'
import { tallCoverDrawables } from '../../render/room/tallCover'
import { aimSightShapes } from '../../render/sightView'
import {
  ghostDrawables,
  ghostShapes,
  trapFootY,
  trapGlowDrawables,
  trapOverheadShapes,
  trapShadow,
  trapShapes,
} from '../../render/trapView'
import {
  zombieFootY,
  zombieGroundShapes,
  zombieShadow,
} from '../../render/zombieGroundView'
import { zombieHealthBarShapes, zombieShapes } from '../../render/zombieView'
import { type Level, levelOf } from '../../world/level/arena'
import { isInsideRoomAt } from '../../world/level/tileQueries'
import { focusOf } from '../../world/party/party'
import { type Vector, type Zombie } from '../../world/schema/entitySchema'
import { Phase } from '../../world/schema/worldSchema'
import { ZERO_VECTOR } from '../../world/step/geometry'
import { isRoundActive } from '../../world/waves/waves'

// OFFSET

// NOTE: the shake moves the world by whole pixels, rounded here at draw time
// and never in the World. A fractional shake left the floor canvases (moved
// by CSS) between device pixels while the painter put each sprite on whole
// ones, so the floor slid under the sprites and the canvas blended the edges
// of every rectangle into its neighbours.
export const shakeOffset = (model: Model): Vector =>
  isRoundActive(model.phase) && model.settings.shakeSetting === 'On'
    ? {
        x: Math.round(model.shake.offset.x),
        y: Math.round(model.shake.offset.y),
      }
    : ZERO_VECTOR

const worldOffset: {
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

// NOTE: on a map bigger than the window, a zombie out of the camera's view
// costs nothing to draw, and one outside the house, in the yard or past the
// map's edge, is never drawn at all. The margin keeps a zombie that still
// shows drawn: half the widest body (18 pixels) and its health bar at the
// sides, the tallest body under the bottom edge, and its shadow and the
// rings round its feet over the top.
const CULL_MARGIN: ViewMargin = { side: 12, above: 6, below: 24 }

const isOnCamera =
  (camera: Camera) =>
  (point: Vector): boolean =>
    isInView(camera, point, CULL_MARGIN)

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
  camera: Camera,
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Canvas.Shape> => [
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
  ...dareGroundShapes(model),
  ...Array.flatMap(model.cosmetics.callouts, burpRingShapes),
  ...Array.filterMap(model.traps, trapShadow(levelOf(model))),
  ...Array.filterMap(model.cosmetics.particles, gibShadow),
  ...ghostShapes(model),
  ...doorRattleShapes(model),
  ...(isLeadArmed(model) ? aimSightShapes(model) : []),
  ...Array.flatMap(model.bullets, bulletShapes),
  ...lidShadowShapes(model),
  ...stationGroundShapes(model, isOnCamera(camera)),
]

// STANDING

// NOTE: how much of a zombie shows: all of it, but in the cellar's dark.
const WHOLE = (_zombie: Zombie): number => 1

// NOTE: a zombie's shapes at its share of the dark's fade, as one group
// only while it fades.
const fadedBy =
  (fadeOf: (zombie: Zombie) => number) =>
  (
    zombie: Zombie,
    shapes: ReadonlyArray<Canvas.Shape>,
  ): ReadonlyArray<Canvas.Shape> => {
    const opacity = fadeOf(zombie)
    return opacity >= 1 ? shapes : [group({ shapes, opacity })]
  }

const standingDrawables = (
  model: Model,
  look: RattlesLook,
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
  fadeOf: (zombie: Zombie) => number = WHOLE,
): ReadonlyArray<Drawable> => {
  const fade = fadedBy(fadeOf)
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
    ...tallCoverDrawables(
      level,
      [
        focusOf(model).player,
        ...Array.map(mates, mate => focusOf(mate.model).player),
      ],
      zombies,
    ),
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
    ...Array.flatMap(model.traps, trapGlowDrawables(level, model.elapsedMs)),
    ...ghostDrawables(model),
    ...Array.map(model.pickups, (pickup): Drawable => ({
      footY: pickupFootY(pickup),
      rank: 'Pickup',
      shapes: pickupShapes(pickup),
    })),
    ...Array.map(zombies, (zombie): Drawable => ({
      footY: zombieFootY(zombie),
      rank: 'Zombie',
      shapes: fade(
        zombie,
        isChomp
          ? chompShapes(model, zombie, drawZombie(zombie))
          : drawZombie(zombie),
      ),
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
    ...(isLeadArmed(model) ? [playerFlashDrawable(focusOf(model).player)] : []),
    ...mateDrawables(mates),
    ...fridgeDrawables(model),
    ...ovenWindowDrawables(model),
    ...wetFloorSignDrawables(model),
    ...pantryDrawables(model),
    ...questKeyDrawables(model),
    ...caseDrawables(model),
    ...crateDrawables(model),
    ...fallenChandelierDrawables(model),
    ...findDrawables(model),
    ...dareDrawables(model),
    ...hubTouchDrawables(model),
    ...kitchenGearDrawables(model),
    ...backDoorDrawables(model),
  ]
}

// OVERHEAD

// NOTE: a zombie still in a doorway behind the wall's face is covered by the
// lintel, so its bar would float over the wall. It shows once it steps in.
const isClearOfWall =
  (level: Level) =>
  (zombie: Zombie): boolean =>
    !isBehindWall(level)(zombie.x, zombieFootY(zombie))

const overheadShapes = (
  model: Model,
  camera: Camera,
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Canvas.Shape> => [
  ...hungChandelierShapes(model),
  ...ovenFlameShapes(model),
  ...Array.flatMap(model.traps, trapOverheadShapes(levelOf(model))),
  ...Array.flatMap(
    Array.filter(zombies, isClearOfWall(levelOf(model))),
    zombieHealthBarShapes,
  ),
  ...bossOverheadShapes(model),
  ...(isGoodieBeckoning(model)
    ? Array.flatMap(model.pickups, goodieArrowShapes)
    : []),
  ...mendRingsOf(model),
  ...stationOverheadShapes(model, isOnCamera(camera)),
  ...Option.match(maybeQuestMark(model), {
    onNone: () => [],
    onSome: door => doorArrowShapes(door, model.elapsedMs),
  }),
  ...questLockShapes(model),
  ...Array.map(model.cosmetics.popups, popupShape(camera)),
  ...(isLeadArmed(model)
    ? reloadBarShapes(focusOf(model).player, hatRiseOf(model.appearance))
    : []),
  ...fridgeOverheadShapes(model),
  ...dareOverheadShapes(model),
  ...findOverheadShapes(model),
  ...frontDoorShapes(model),
  ...mateOverheadShapes(model, mates),
  ...coopNameShapes(model),
  ...padlockShapes(model),
]

// WORLD

// NOTE: the title screen's house: the hearth, Rattles dozing on his trunk,
// and the chandelier, by the screen's own clock.
const titleStrataOf = (model: Model): WorldStrata => ({
  ground: RATTLES_GROUND_SHAPES,
  standing: [
    ...hearthFireDrawables(levelOf(model), model.screenMs),
    {
      footY: RATTLES_FOOT_Y,
      rank: 'Prop',
      shapes: rattlesShapes('Dozing', model.screenMs),
    },
  ],
  overhead: hungChandelierShapes(model),
})

// NOTE: a playing world's strata. In the cellar's dark a zombie shows only
// close to the viewing player, fading in over the last tile, with its shadow
// and bar (src/render/cellarDark.ts); the 3D renderer darkens the cellar
// itself.
const playStrataOf = (model: Model, camera: Camera): WorldStrata => {
  const look = rattlesLook(model)
  const onCamera = shownZombies(model, camera)
  const mates = mateModelsOf(model)
  return Option.match(cellarDarkOf(model), {
    onNone: () => ({
      ground: groundShapes(model, camera, onCamera, mates),
      standing: [
        ...standingDrawables(model, look, onCamera, mates),
        ...stationDrawables(model, isOnCamera(camera)),
        ...hearthFireDrawables(levelOf(model), model.elapsedMs),
      ],
      overhead: overheadShapes(model, camera, onCamera, mates),
    }),
    onSome: dark => {
      const seen = Array.filter(onCamera, zombie => dark.fadeOf(zombie) > 0)
      const whole = Array.filter(seen, zombie => dark.fadeOf(zombie) >= 1)
      const fading = Array.filter(seen, zombie => dark.fadeOf(zombie) < 1)
      const fade = fadedBy(dark.fadeOf)
      return {
        ground: [
          ...groundShapes(model, camera, whole, mates),
          ...Array.flatMap(fading, zombie =>
            fade(zombie, [
              ...zombieGroundShapes([zombie], model.elapsedMs),
              ...Array.filterMap([zombie], zombieShadow),
            ]),
          ),
        ],
        standing: [
          ...standingDrawables(model, look, seen, mates, dark.fadeOf),
          ...stationDrawables(model, isOnCamera(camera)),
          ...hearthFireDrawables(levelOf(model), model.elapsedMs),
        ],
        overhead: [
          ...overheadShapes(model, camera, whole, mates),
          ...Array.flatMap(
            Array.filter(fading, zombie =>
              isClearOfWall(levelOf(model))(zombie),
            ),
            (zombie: Zombie) => fade(zombie, zombieHealthBarShapes(zombie)),
          ),
        ],
      }
    },
  })
}

// NOTE: the world's three strata kept apart, for the 3D renderer
// (src/render/iso/scene.ts): what lies on the floor, what stands up at its
// feet, and what floats over both.
export const worldStrataOf: {
  (camera: Camera): (model: Model) => WorldStrata
  (model: Model, camera: Camera): WorldStrata
} = Function.dual(2, (model: Model, camera: Camera): WorldStrata =>
  Phase.isAnyOf(['Ready'])(model.phase)
    ? titleStrataOf(model)
    : playStrataOf(model, camera),
)

// NOTE: the strata as one flat list in draw order, moved by the shake: what
// a frame shows, as plain data for the tests and the tools (the sprite atlas,
// the audit harness) that read the world's shapes.
export const worldLayerShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> => {
    const { ground, standing, overhead } = worldStrataOf(model, camera)
    return [
      group({
        translate: worldOffset(model, camera),
        shapes: [...ground, ...depthSortedShapes(standing), ...overhead],
      }),
    ]
  },
)
