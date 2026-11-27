import { Array, Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import { group } from '#art/sprite.ts'
import { hatRiseOf } from '#art/sprites/hatArt.ts'
import { caseDrawables } from '#features/cases/caseView.ts'
import { crateDrawables, mendRingsOf } from '#features/crates/crateView.ts'
import {
  dareDrawables,
  dareGroundShapes,
  dareOverheadShapes,
} from '#features/dare/views/dareView.ts'
import {
  findDrawables,
  findOverheadShapes,
} from '#features/dare/views/findView.ts'
import { frontDoorShapes } from '#features/dare/views/frontDoorView.ts'
import { hubTouchDrawables } from '#features/dining/hubTouchView.ts'
import {
  chompShapes,
  fallenOf,
  isChomping,
  toppleShapes,
} from '#features/end/views/endView.ts'
import {
  fridgeDrawables,
  fridgeOverheadShapes,
  lidShadowShapes,
} from '#features/fridge/fridgeView.ts'
import { pantryDrawables } from '#features/kitchen/pantryView.ts'
import { maybeQuestMark } from '#features/onboarding/firstBreakQuest.ts'
import { isGoodieBeckoning } from '#features/onboarding/onboarding.ts'
import { questKeyDrawables } from '#features/onboarding/views/questKeyView.ts'
import { questLockShapes } from '#features/onboarding/views/questLockView.ts'
import { coopNameShapes } from '#features/onlineRun/coopMarksView.ts'
import {
  RATTLES_FOOT_Y,
  RATTLES_GROUND_SHAPES,
  type RattlesLook,
  rattlesShapes,
} from '#features/rattles/rattlesSpot.ts'
import {
  stationDrawables,
  stationGroundShapes,
  stationOverheadShapes,
} from '#features/stations/stationView.ts'
import {
  bossGroundShapes,
  bossOverheadShapes,
} from '#render/bodies/bossView.ts'
import { cellarDarkOf } from '#render/bodies/cellarDark.ts'
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
} from '#render/bodies/partyView.ts'
import {
  playerFlashDrawable,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from '#render/bodies/playerView.ts'
import {
  zombieFootY,
  zombieGroundShapes,
  zombieShadow,
} from '#render/bodies/zombieGroundView.ts'
import {
  zombieHealthBarShapes,
  zombieShapes,
} from '#render/bodies/zombieView.ts'
import {
  type Camera,
  type ViewMargin,
  isInView,
  sceneOffset,
} from '#render/camera/camera.ts'
import { type Drawable, depthSortedShapes } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import {
  bulletShapes,
  doorRattleShapes,
  gibShadow,
  popupShape,
} from '#render/effects/effectsView.ts'
import {
  auraShapes,
  burpRingShapes,
  doorArrowShapes,
  goodieArrowShapes,
  pickupFootY,
  pickupShapes,
} from '#render/effects/powerupView.ts'
import { aimSightShapes } from '#render/effects/sightView.ts'
import {
  ghostDrawables,
  ghostShapes,
  trapFootY,
  trapGlowDrawables,
  trapOverheadShapes,
  trapShadow,
  trapShapes,
} from '#render/effects/trapView.ts'
import type { WorldStrata } from '#render/iso/frame.ts'
import { backDoorDrawables } from '#render/room/backDoorView.ts'
import { isBehindWall } from '#render/room/doorways.ts'
import {
  kitchenGearDrawables,
  kitchenGearGroundShapes,
} from '#render/room/kitchenGearView.ts'
import { kitchenLeakShapes } from '#render/room/kitchenLeak.ts'
import {
  ovenFlameShapes,
  ovenGlowShapes,
  ovenWindowDrawables,
  padlockShapes,
  wetFloorSignDrawables,
} from '#render/room/kitchenView.ts'
import {
  fallenChandelierDrawables,
  hearthFireDrawables,
  hungChandelierShapes,
} from '#render/room/room.ts'
import { tallCoverDrawables } from '#render/room/tallCover.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { isInsideRoomAt } from '#world/level/tileQueries.ts'
import { focusOf } from '#world/party/party.ts'
import { type Vector, type Zombie } from '#world/schema/entitySchema.ts'
import { Phase } from '#world/schema/worldSchema.ts'
import { ZERO_VECTOR } from '#world/step/geometry.ts'
import { isRoundActive } from '#world/waves/waves.ts'

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

const rattlesLook = (model: Model): RattlesLook =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? 'Awake' : 'Dozing'

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

const groundShapes = (
  model: Model,
  camera: Camera,
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Draw.Shape> => [
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

const WHOLE = (_zombie: Zombie): number => 1

const fadedBy =
  (fadeOf: (zombie: Zombie) => number) =>
  (
    zombie: Zombie,
    shapes: ReadonlyArray<Draw.Shape>,
  ): ReadonlyArray<Draw.Shape> => {
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
    ...kitchenGearDrawables(model),
    ...backDoorDrawables(model),
  ]
}

const isClearOfWall =
  (level: Level) =>
  (zombie: Zombie): boolean =>
    !isBehindWall(level)(zombie.x, zombieFootY(zombie))

const overheadShapes = (
  model: Model,
  camera: Camera,
  zombies: ReadonlyArray<Zombie>,
  mates: ReadonlyArray<MateModel>,
): ReadonlyArray<Draw.Shape> => [
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
        ...hubTouchDrawables(model, isOnCamera(camera)),
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
          ...hubTouchDrawables(model, isOnCamera(camera)),
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

export const worldStrataOf: {
  (camera: Camera): (model: Model) => WorldStrata
  (model: Model, camera: Camera): WorldStrata
} = Function.dual(2, (model: Model, camera: Camera): WorldStrata =>
  Phase.isAnyOf(['Ready'])(model.phase)
    ? titleStrataOf(model)
    : playStrataOf(model, camera),
)

export const worldLayerShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> => {
    const { ground, standing, overhead } = worldStrataOf(model, camera)
    return [
      group({
        translate: worldOffset(model, camera),
        shapes: [...ground, ...depthSortedShapes(standing), ...overhead],
      }),
    ]
  },
)
