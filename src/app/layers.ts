import { Array, Function, Option, Predicate, Record, Result } from 'effect'

import { spriteWarmUpSources } from '#art/appearance.ts'
import { atlasRoomSources } from '#art/spriteAtlas.ts'
import { clocheShapes } from '#features/cloche/clocheView.ts'
import { darePointerShapes } from '#features/dare/darePointer.ts'
import { frontDoorMarkerShapes } from '#features/dare/frontDoorView.ts'
import { pocketCardShapes } from '#features/dare/pocketCardView.ts'
import { lensOf } from '#features/end/endBeat.ts'
import {
  fridgeRevealShapes,
  prizeFlightShapes,
} from '#features/fridge/fridgeRevealView.ts'
import { fridgeOddsShapes } from '#features/fridge/fridgeView.ts'
import { stragglerEdgeShapes } from '#features/hud/stragglerEdge.ts'
import { wavePreviewShapes } from '#features/hud/wavePreview.ts'
import { introShapes } from '#features/intro/introView.ts'
import { caseCardShapes } from '#features/onboarding/caseCardView.ts'
import {
  maybeTourMark,
  questEdgeShapes,
} from '#features/onboarding/questEdgeView.ts'
import { coopEdgeShapes } from '#features/onlineRun/coopMarksView.ts'
import { purchaseOverlayShapes } from '#features/shop/purchaseView.ts'
import { thumbAreaView } from '#input/thumbArea.ts'
import { bossBandShapes } from '#render/bossView.ts'
import {
  type Camera,
  toScreenCamera,
  viewBoxOf,
  worldCameraFor,
  worldToView,
} from '#render/camera.ts'
import { cineBarShapes } from '#render/cine.ts'
import type * as Draw from '#render/draw.ts'
import { IsoLens } from '#render/iso/diorama.ts'
import { worldElement } from '#render/iso/element.ts'
import type { IsoFrame } from '#render/iso/frame.ts'
import { holdKeyOf } from '#render/iso/hold.ts'
import { overlayElement } from '#render/iso/overlayElement.ts'
import { calloutShapes, levelCalloutShapes } from '#render/powerupView.ts'
import { everyRoomImage } from '#render/room/room.ts'
import { FLOOR_COLOR } from '#render/room/roomPalette.ts'
import {
  type Screen,
  inLandscapeFrame,
  screenOf,
  stagePlacement,
} from '#render/screen.ts'
import { hudShapes, hudStripShapes } from '#screens/game/hud.ts'
import { overlayShapes } from '#screens/game/overlay.ts'
import {
  hudAndBannerKeepoutsOf,
  pinnedKeepoutsOf,
  pocketOf,
} from '#screens/game/pocket.ts'
import {
  shakeOffset,
  worldLayerShapes,
  worldStrataOf,
} from '#screens/game/worldView.ts'
import { percentOf } from '#ui/menuParts.ts'
import { levelOf } from '#world/level/arena.ts'
import type { LevelSpec } from '#world/level/plan.ts'
import { focusOf } from '#world/party/party.ts'
import { isArriving } from '#world/run/arrival.ts'
import { isRoundActive } from '#world/waves/waves.ts'

import type { ApplicationHtml, ApplicationViewBuilder } from './definition.ts'
import { type Model, Phase, defaultAppearance } from './model.ts'

const calloutLayerShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Draw.Shape> =>
  isRoundActive(model.phase)
    ? [
        ...Array.flatMap(model.cosmetics.callouts, calloutShapes(camera)),
        ...Array.flatMap(
          model.cosmetics.levelCallouts,
          levelCalloutShapes(camera),
        ),
      ]
    : []

const pointerShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Draw.Shape> =>
  Option.isSome(maybeTourMark(model))
    ? questEdgeShapes(model, screen, camera)
    : darePointerShapes(model, screen, camera)

const roundOverlayShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Draw.Shape> => [
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

const overlayLayerShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Draw.Shape> =>
  isArriving(model.phase)
    ? introShapes(model, screen)
    : roundOverlayShapes(model, screen, camera)

export const sceneShapes = (model: Model): ReadonlyArray<Draw.Shape> => {
  const screen = screenOf(model)
  const camera = worldCameraFor(model, screen)
  return [
    ...worldLayerShapes(model, camera),
    ...overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
  ]
}

type LastShapes = { current: ReadonlyArray<Draw.Shape> }

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
  (shapes: ReadonlyArray<Draw.Shape>): ReadonlyArray<Draw.Shape> => {
    if (!isSameData(last.current, shapes)) {
      last.current = shapes
    }
    return last.current
  }

const stableOverlayShapes = keepWhileEqual({ current: [] })

const OVERLAY_BOX = {
  position: 'absolute',
  inset: '0',
  display: 'block',
  pointerEvents: 'none',
} as const

const overlayLayerView = (
  h: ApplicationViewBuilder,
  shapes: ReadonlyArray<Draw.Shape>,
  width: number,
  height: number,
): ApplicationHtml =>
  overlayElement(h)
    .key('overlay-layer')
    .class('overlay-layer')
    .attr('aria-hidden', 'true')
    .style(OVERLAY_BOX)
    .picture({ width, height, shapes })

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
): ApplicationHtml =>
  worldElement(h)
    .key('world-view')
    .class('world-view')
    .attr('aria-hidden', 'true')
    .attr('data-view-width', `${camera.width}`)
    .attr('data-view-height', `${camera.height}`)
    .frame(isoFrameOf(model, camera))

const NO_LENS: Readonly<Record<string, string>> = {}

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

const STAGE_BACKDROP = '#140c10'

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
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml => {
    const screen = screenOf(model)
    const camera = worldCameraFor(model, screen)
    const { world } = screen
    return h.div.class('game-frame').children(
      h.div
        .key('game-stage')
        .class('game-stage')
        .attr('data-layout', screen.layout)
        .style({
          ...stageBoxStyle(model, screen),
          backgroundColor:
            screen.layout === 'Landscape' ? FLOOR_COLOR : STAGE_BACKDROP,
        })
        .children(
          h.div
            .key('world-window')
            .class('world-window')
            .style({
              left: percentOf(world.x, screen.width),
              top: percentOf(world.y, screen.height),
              width: percentOf(world.width, screen.width),
              height: percentOf(world.height, screen.height),
              backgroundColor: FLOOR_COLOR,
            })
            .children(
              h.div
                .key('world-lens')
                .class('world-lens')
                .style(lensStyle(model, camera))
                .children(worldView(model, camera, h)),
            ),
          thumbAreaView(screen, h),
          h.lazy(
            overlayLayerView,
            stableOverlayShapes(
              overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
            ),
            screen.width,
            screen.height,
          ),
        ),
    )
  },
)
