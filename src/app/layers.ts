import { Array, Equal, Function, Option, Result } from 'effect'
import { Canvas } from 'foldkit'
import { type Html, createLazy } from 'foldkit/html'

import { spriteWarmUpSources } from '../art/appearance'
import { group } from '../art/sprite'
import { clocheShapes } from '../features/cloche/clocheView'
import { lensOf } from '../features/end/endBeat'
import {
  fridgeRevealShapes,
  prizeFlightShapes,
} from '../features/fridge/fridgeRevealView'
import { wavePreviewShapes } from '../features/hud/wavePreview'
import { coopEdgeShapes } from '../features/onlineRun/coopMarksView'
import { purchaseOverlayShapes } from '../features/shop/purchaseView'
import { thumbAreaView } from '../input/thumbArea'
import { bossBandShapes } from '../render/bossView'
import { type Camera, toScreenCamera, worldCameraFor } from '../render/camera'
import { decalShapes } from '../render/effectsView'
import { calloutShapes, levelCalloutShapes } from '../render/powerupView'
import type { Decal } from '../render/renderSchema'
import { everyRoomImage, roomShapes } from '../render/room/room'
import { FLOOR_COLOR } from '../render/room/roomPalette'
import { type Screen, inLandscapeFrame, screenOf } from '../render/screen'
import { hudShapes, hudStripShapes } from '../screens/game/hud'
import { overlayShapes } from '../screens/game/overlay'
import { worldLayerShapes, worldOffset } from '../screens/game/worldView'
import { percentOf } from '../ui/menuParts'
import { type Level, levelOf } from '../world/level/arena'
import type { LevelSpec } from '../world/level/plan'
import { focusOf } from '../world/party/party'
import { isRoundActive } from '../world/waves/waves'
import type { ApplicationViewBuilder } from './composition'
import { type Model, Phase, type Vector, defaultAppearance } from './model'

// OVERLAY

const calloutLayerShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isRoundActive(model.phase)
    ? [
        ...Array.flatMap(model.callouts, calloutShapes(camera)),
        ...Array.flatMap(model.levelCallouts, levelCalloutShapes(camera)),
      ]
    : []

const overlayLayerShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...hudStripShapes(model, screen, camera),
  ...wavePreviewShapes(model, camera),
  ...(isRoundActive(model.phase)
    ? [
        ...fridgeRevealShapes(model, screen, camera),
        ...clocheShapes(model, camera),
        ...purchaseOverlayShapes(model, camera),
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
]

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const screen = screenOf(model)
  const camera = worldCameraFor(model, screen)
  return [
    ...worldLayerShapes(model, camera),
    ...overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
  ]
}

// FLOOR LAYERS

const NO_DECALS: ReadonlyArray<Decal> = []

// NOTE: a floor canvas covers the whole map, whose first row can sit above
// the parlour's top wall and whose first column west of it, so its shapes
// are moved by the map's left and top.
const layerCanvasView = (
  key: string,
  level: Level,
  shapes: ReadonlyArray<Canvas.Shape>,
  h: ApplicationViewBuilder,
): Html =>
  Canvas.view(
    {
      key,
      width: level.width,
      height: level.height,
      shapes:
        level.top === 0 && level.left === 0
          ? shapes
          : [
              group({
                translate: { x: -level.left, y: -level.top },
                shapes,
              }),
            ],
      className: 'floor-layer-canvas',
    },
    h,
  )

const roomLayerView = (level: Level, h: ApplicationViewBuilder): Html =>
  layerCanvasView('room-layer', level, roomShapes(level), h)

const decalLayerView = (
  level: Level,
  decals: ReadonlyArray<Decal>,
  h: ApplicationViewBuilder,
): Html => layerCanvasView('decal-layer', level, decalShapes(decals), h)

const lazyRoomLayer = createLazy()
const lazyDecalLayer = createLazy()

const layerDecals = (model: Model): ReadonlyArray<Decal> =>
  Phase.isAnyOf(['Ready'])(model.phase) ? NO_DECALS : model.decals

// NOTE: the room and the decals change far less often than the frame, so
// they live on their own canvases under the scene canvas, and the lazy views
// hand back the same VNode while their arguments hold, so Canvas skips their
// repaint. These canvases are the size of the whole level, not the view. The
// camera and the screen shake move them with a CSS transform of the same
// whole pixels the scene canvas translates by, and the stage behind them is
// the floor color, so the strip a shake uncovers matches the floor. Both lazy
// views are keyed on the Level, which is a new record whenever an exit opens,
// so the room and its decal canvas redraw then and only then.
//
// Every cached VNode is keyed, and so are its siblings. A lazy view hands
// snabbdom the very VNode it patched last frame, and paired by position in
// an unkeyed list it can be rebuilt into a new element while the old one
// stays in the page (the duplicate shop dialog, see `dialogShell`).
// src/app/__tests__/cachedNodes.scene.test.ts holds every cached VNode to a key.
const floorLayersView = (
  model: Model,
  camera: Camera,
  offset: Vector,
  h: ApplicationViewBuilder,
): Html => {
  const level = levelOf(model)
  return h.div(
    [
      h.Class('floor-layers'),
      h.AriaHidden(true),
      h.Style({
        width: percentOf(level.width, camera.width),
        height: percentOf(level.height, camera.height),
        transform: `translate(${percentOf(offset.x + level.left, level.width)}, ${percentOf(offset.y + level.top, level.height)})`,
      }),
    ],
    [
      lazyRoomLayer(roomLayerView, [level, h]),
      lazyDecalLayer(decalLayerView, [level, layerDecals(model), h]),
    ],
  )
}

// OVERLAY LAYER

type LastShapes = { current: ReadonlyArray<Canvas.Shape> }

// NOTE: createLazy compares its arguments by reference, and the HUD and
// screen overlays are rebuilt as new arrays every frame. This hands back the
// previous array while the new one is structurally equal, so the overlay
// canvas repaints only on frames where what it shows has changed.
const keepWhileEqual =
  (last: LastShapes) =>
  (shapes: ReadonlyArray<Canvas.Shape>): ReadonlyArray<Canvas.Shape> => {
    if (!Equal.equals(last.current, shapes)) {
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

// SPRITE WARM-UP

const WARM_UP_CHUNK = 64

// NOTE: an Image shape draws nothing until the browser has decoded its
// source, so a sprite drawn for the first time mid-fight would be missing
// for a frame. The first render draws every sprite built as the game loaded,
// and the classic look's frames, once on hidden canvases. Each canvas repaints
// as its images load, so they are split into small chunks to keep those
// repaints cheap. The lazy view hands back the same VNodes after that, so
// they cost nothing per frame. The list is read at the first render, not when
// this module loads, so it includes the sprites of modules loaded after it.
export const WARM_UP_CLASS = 'sprite-warm-up'

// NOTE: the room images of the house the run stands in, every set of its
// exits, so opening a room never shows a bare floor for a frame. The warm-up
// draws again when a run rolls another house, never mid-run.
const roomSources = (spec: LevelSpec): ReadonlyArray<string> =>
  Array.filterMap(everyRoomImage(spec), shape =>
    shape._tag === 'Image' ? Result.succeed(shape.src) : Result.failVoid,
  )

const warmUpView = (h: ApplicationViewBuilder, spec: LevelSpec): Html =>
  h.div(
    [h.Key(WARM_UP_CLASS), h.AriaHidden(true), h.Style({ display: 'none' })],
    Array.map(
      Array.chunksOf(
        [...roomSources(spec), ...spriteWarmUpSources(defaultAppearance)],
        WARM_UP_CHUNK,
      ),
      sources =>
        Canvas.view(
          {
            width: 1,
            height: 1,
            className: WARM_UP_CLASS,
            shapes: Array.map(sources, src =>
              Canvas.Image({ src, x: 0, y: 0, width: 1, height: 1 }),
            ),
          },
          h,
        ),
    ),
  )

const lazyWarmUp = createLazy()

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
      transformOrigin: `${percentOf(focusOf(model).player.x - camera.x, camera.width)} ${percentOf(focusOf(model).player.y - camera.y, camera.height)}`,
      filter: saturation < 1 ? `saturate(${saturation})` : 'none',
    }),
  })

// STAGE

const STAGE_BACKDROP = '#140c10'

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
            width: `min(100cqw, 100cqh * ${screen.width} / ${screen.height})`,
            height: `min(100cqh, 100cqw * ${screen.height} / ${screen.width})`,
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
                [
                  floorLayersView(model, camera, worldOffset(model, camera), h),
                  Canvas.view(
                    {
                      width: camera.width,
                      height: camera.height,
                      shapes: worldLayerShapes(model, camera),
                      className: 'game-canvas',
                    },
                    h,
                  ),
                ],
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
      lazyWarmUp(warmUpView, [h, levelOf(model).spec]),
    ],
  )
})
