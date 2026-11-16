import { Array, Function, Option, Predicate, Record, Result } from 'effect'
import { Canvas } from 'foldkit'
import { type Html, createLazy } from 'foldkit/html'

import { spriteWarmUpSources } from '../art/appearance'
import { atlasRoomSources } from '../art/spriteAtlas'
import { clocheShapes } from '../features/cloche/clocheView'
import { darePointerShapes } from '../features/dare/darePointer'
import { frontDoorMarkerShapes } from '../features/dare/frontDoorView'
import { pocketCardShapes } from '../features/dare/pocketCardView'
import { lensOf } from '../features/end/endBeat'
import {
  fridgeRevealShapes,
  prizeFlightShapes,
} from '../features/fridge/fridgeRevealView'
import { fridgeOddsShapes } from '../features/fridge/fridgeView'
import { stragglerEdgeShapes } from '../features/hud/stragglerEdge'
import { wavePreviewShapes } from '../features/hud/wavePreview'
import { introShapes } from '../features/intro/introView'
import { caseCardShapes } from '../features/onboarding/caseCardView'
import {
  maybeTourMark,
  questEdgeShapes,
} from '../features/onboarding/questEdgeView'
import { coopEdgeShapes } from '../features/onlineRun/coopMarksView'
import { purchaseOverlayShapes } from '../features/shop/purchaseView'
import { thumbAreaView } from '../input/thumbArea'
import { bossBandShapes } from '../render/bossView'
import {
  type Camera,
  toScreenCamera,
  viewBoxOf,
  worldCameraFor,
  worldToView,
} from '../render/camera'
import { cineBarShapes } from '../render/cine'
import { IsoLens } from '../render/iso/diorama'
import { worldElement } from '../render/iso/element'
import type { IsoFrame } from '../render/iso/frame'
import { holdKeyOf } from '../render/iso/hold'
import { calloutShapes, levelCalloutShapes } from '../render/powerupView'
import { everyRoomImage } from '../render/room/room'
import { FLOOR_COLOR } from '../render/room/roomPalette'
import {
  type Screen,
  inLandscapeFrame,
  screenOf,
  stagePlacement,
} from '../render/screen'
import { hudShapes, hudStripShapes } from '../screens/game/hud'
import { overlayShapes } from '../screens/game/overlay'
import {
  hudAndBannerKeepoutsOf,
  pinnedKeepoutsOf,
  pocketOf,
} from '../screens/game/pocket'
import {
  shakeOffset,
  worldLayerShapes,
  worldStrataOf,
} from '../screens/game/worldView'
import { percentOf } from '../ui/menuParts'
import { levelOf } from '../world/level/arena'
import type { LevelSpec } from '../world/level/plan'
import { focusOf } from '../world/party/party'
import { isArriving } from '../world/run/arrival'
import { isRoundActive } from '../world/waves/waves'
import type { ApplicationViewBuilder } from './composition'
import { type Model, Phase, defaultAppearance } from './model'

// OVERLAY

const calloutLayerShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isRoundActive(model.phase)
    ? [
        ...Array.flatMap(model.cosmetics.callouts, calloutShapes(camera)),
        ...Array.flatMap(
          model.cosmetics.levelCallouts,
          levelCalloutShapes(camera),
        ),
      ]
    : []

// NOTE: one gold arrow at a time: the tours' (and the padlock's) first,
// else the dare's.
const pointerShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Option.isSome(maybeTourMark(model))
    ? questEdgeShapes(model, screen, camera)
    : darePointerShapes(model, screen, camera)

const roundOverlayShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...cineBarShapes({ model, world: viewBoxOf(camera) }),
  ...hudStripShapes(model, screen, camera),
  ...wavePreviewShapes(model, camera),
  ...(isRoundActive(model.phase)
    ? [
        ...fridgeRevealShapes(model, screen, camera),
        ...clocheShapes(model, camera),
        ...purchaseOverlayShapes(model, camera, hudAndBannerKeepoutsOf(model)),
        ...fridgeOddsShapes(model, camera, pinnedKeepoutsOf(model, camera)),
        ...frontDoorMarkerShapes(model, screen, camera),
        ...pointerShapes(model, screen, camera),
        ...stragglerEdgeShapes(model, screen, camera),
      ]
    : []),
  ...hudShapes(model, screen, camera),
  ...(isRoundActive(model.phase)
    ? prizeFlightShapes(model, screen, camera)
    : []),
  ...calloutLayerShapes(model, camera),
  ...(isRoundActive(model.phase) ? coopEdgeShapes(model, camera) : []),
  ...inLandscapeFrame(screen, overlayShapes(model, screen)),
  ...(Phase.isAnyOf(['Wave'])(model.phase)
    ? inLandscapeFrame(screen, bossBandShapes(model))
    : []),
  ...pocketCardShapes(model, screen, pocketOf(model)),
  ...inLandscapeFrame(screen, caseCardShapes(model)),
]

// NOTE: the intro covers the whole screen while the crew arrives, the HUD
// too (src/features/intro/introView.ts).
const overlayLayerShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isArriving(model.phase)
    ? introShapes(model, screen)
    : roundOverlayShapes(model, screen, camera)

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const screen = screenOf(model)
  const camera = worldCameraFor(model, screen)
  return [
    ...worldLayerShapes(model, camera),
    ...overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
  ]
}

// OVERLAY LAYER

type LastShapes = { current: ReadonlyArray<Canvas.Shape> }

// NOTE: createLazy compares its arguments by reference, and the HUD and
// screen overlays are rebuilt as new arrays every frame. This hands back the
// previous array while the new one is structurally equal, so the overlay
// canvas repaints only on frames where what it shows has changed.
// NOTE: shapes are plain data, so equal shapes have the same keys and equal
// values. This walks both trees and stops at the first difference; it never
// hashes, which Equal.equals does to every node of both trees every frame.
// A sprite shared by reference is equal at once.
const isSameData = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true
  }
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      Array.every(left, (item, index) => isSameData(item, right[index]))
    )
  }
  if (!Predicate.isObject(left) || !Predicate.isObject(right)) {
    return false
  }
  const keys = Record.keys(left)
  return (
    keys.length === Record.keys(right).length &&
    Array.every(
      keys,
      key => Record.has(right, key) && isSameData(left[key], right[key]),
    )
  )
}

const keepWhileEqual =
  (last: LastShapes) =>
  (shapes: ReadonlyArray<Canvas.Shape>): ReadonlyArray<Canvas.Shape> => {
    if (!isSameData(last.current, shapes)) {
      last.current = shapes
    }
    return last.current
  }

const stableOverlayShapes = keepWhileEqual({ current: [] })

const overlayLayerView = (
  width: number,
  height: number,
  shapes: ReadonlyArray<Canvas.Shape>,
  h: ApplicationViewBuilder,
): Html =>
  Canvas.view(
    {
      key: 'overlay-layer',
      width,
      height,
      shapes,
      className: 'overlay-layer-canvas',
    },
    h,
  )

const lazyOverlayLayer = createLazy()

// THE WORLD

// NOTE: an Image draws nothing until its source has loaded, so a sprite
// shown for the first time mid-fight would be missing for a frame. The
// renderer starts loading every sprite built as the game loaded, the classic
// look's frames, and every room image of the house the run stands in (every
// set of its exits, so opening a room never shows a bare floor). A
// production build's atlas names the files holding a house's room images,
// so the list is those, with no room art built: building every room image
// of every set of exits froze a phone's first frame for seconds. With no
// atlas (a dev server) they are built. The list is made once per house, and read at the
// first render rather than when this module loads, so it holds the sprites
// of modules loaded after it.
const preloads = new WeakMap<LevelSpec, ReadonlyArray<string>>()

const preloadSourcesOf = (spec: LevelSpec): ReadonlyArray<string> => {
  const known = preloads.get(spec)
  if (known !== undefined) {
    return known
  }
  const sources = Array.dedupe([
    ...Option.getOrElse(atlasRoomSources(spec.id), () =>
      Array.filterMap(everyRoomImage(spec), shape =>
        shape._tag === 'Image' ? Result.succeed(shape.src) : Result.failVoid,
      ),
    ),
    ...spriteWarmUpSources(defaultAppearance),
  ])
  preloads.set(spec, sources)
  return sources
}

const isoFrameOf = (model: Model, camera: Camera): IsoFrame => {
  const shake = shakeOffset(model)
  return {
    model,
    strata: worldStrataOf(model, camera),
    camera,
    lens: Phase.isAnyOf(['Ready'])(model.phase)
      ? IsoLens.Diorama({ clockMs: model.screenMs })
      : IsoLens.Play(),
    shake,
    preload: preloadSourcesOf(levelOf(model).spec),
    hold: holdKeyOf({ model, camera, shake }),
  }
}

const worldView = (
  model: Model,
  camera: Camera,
  h: ApplicationViewBuilder,
): Html => {
  const world = worldElement.withMessage(h)
  return world(
    [
      h.Key('world-view'),
      h.Class('world-view'),
      h.AriaHidden(true),
      // NOTE: the world pixels it shows, for the audits that measure the zoom.
      h.DataAttribute('view-width', `${camera.width}`),
      h.DataAttribute('view-height', `${camera.height}`),
      world.Frame(isoFrameOf(model, camera)),
    ],
    [],
  )
}

// LENS

const NO_LENS: Readonly<Record<string, string>> = {}

// NOTE: the end of a run's camera punch and color drain (src/features/end/endBeat.ts),
// as a CSS transform and filter on the world alone, so the card and the HUD
// on the overlay stay sharp and the frame draws nothing more.
const lensStyle = (
  model: Model,
  camera: Camera,
): Readonly<Record<string, string>> =>
  Option.match(lensOf(model), {
    onNone: () => NO_LENS,
    onSome: ({ zoom, saturation }) => ({
      transform: `scale(${zoom})`,
      transformOrigin: `${percentOf(worldToView(camera, focusOf(model).player).x, camera.width)} ${percentOf(worldToView(camera, focusOf(model).player).y, camera.height)}`,
      filter: saturation < 1 ? `saturate(${saturation})` : 'none',
    }),
  })

// STAGE

const STAGE_BACKDROP = '#140c10'

// NOTE: the stage's box on the measured surface (src/render/screen.ts), on
// whole device pixels where that keeps the art crisp; before the surface is
// measured, centered at the plain fit.
const stageBoxStyle = (
  model: Model,
  screen: Screen,
): Readonly<Record<string, string>> =>
  Option.match(model.maybeSurface, {
    onNone: () => ({
      width: `min(100cqw, 100cqh * ${screen.width} / ${screen.height})`,
      height: `min(100cqh, 100cqw * ${screen.height} / ${screen.width})`,
    }),
    onSome: surface => {
      const { scale, left, top } = stagePlacement(surface, screen)
      return {
        margin: '0',
        left: `${left}px`,
        top: `${top}px`,
        width: `${screen.width * scale}px`,
        height: `${screen.height * scale}px`,
      }
    },
  })

export const gameStageView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html => {
  const screen = screenOf(model)
  const camera = worldCameraFor(model, screen)
  const { world } = screen
  return h.div(
    [h.Class('game-frame')],
    [
      h.div(
        [
          h.Key('game-stage'),
          h.Class('game-stage'),
          h.DataAttribute('layout', screen.layout),
          h.Style({
            ...stageBoxStyle(model, screen),
            backgroundColor:
              screen.layout === 'Landscape' ? FLOOR_COLOR : STAGE_BACKDROP,
          }),
        ],
        [
          h.div(
            [
              h.Key('world-window'),
              h.Class('world-window'),
              h.Style({
                left: percentOf(world.x, screen.width),
                top: percentOf(world.y, screen.height),
                width: percentOf(world.width, screen.width),
                height: percentOf(world.height, screen.height),
                backgroundColor: FLOOR_COLOR,
              }),
            ],
            [
              h.div(
                [
                  h.Key('world-lens'),
                  h.Class('world-lens'),
                  h.Style(lensStyle(model, camera)),
                ],
                [worldView(model, camera, h)],
              ),
            ],
          ),
          thumbAreaView(screen, h),
          lazyOverlayLayer(overlayLayerView, [
            screen.width,
            screen.height,
            stableOverlayShapes(
              overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
            ),
            h,
          ]),
        ],
      ),
    ],
  )
})
