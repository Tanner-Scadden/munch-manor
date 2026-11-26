import '@game/art/atlas/spriteAtlasBoot'
import './harness.css'
import {
  Array,
  Effect,
  Fiber,
  Layer,
  Option,
  Result,
  Scope,
  String,
} from 'effect'

import { Command, Component, Head, UiStruct } from '@effect/ui'
import { BrowserHost } from '@effect/ui/html'
import { ApplicationNoDeps } from '@game/app/block'
import { LoadSave, bootCommands } from '@game/app/boot'
import {
  ApplicationDef,
  type ApplicationHtml,
  type ApplicationViewBuilder,
} from '@game/app/component'
import { CommandsLayer } from '@game/app/commands'
import { sceneShapes } from '@game/app/views/layers'
import type { Message } from '@game/app/message'
import type { Model } from '@game/app/model'
import { update as pureUpdate, subscriptions } from '@game/app/pureApp'
import type { App$ } from '@game/app/update/step'
import { view } from '@game/app/view'
import { audioEngineLayer } from '@game/audio/audio'
import { quietCoopNet } from '@game/features/coop/services/testing'
import { quietLayer as quietInstallPrompt } from '@game/platform/install'
import { layer as PlayerStoreLayer } from '@game/platform/save/store'
import { worldCameraFor } from '@game/render/camera/camera'
import { defineWorldElement, snapshotWorld } from '@game/render/iso/element'
import {
  defineOverlayElement,
  overlayElement,
} from '@game/render/iso/overlayElement'
import { definePlinthElement } from '@game/render/iso/plinth/plinthElement'
import { screenOf } from '@game/render/camera/screen'
import { GAME_TITLE } from '@game/shared/constants'
import { RATTLES_BOX, START_LEVEL } from '@game/world/level/arena'

import type * as Draw from '../../../src/render/draw'
import { BRIDGE_KEY, type StudioBridge } from '../../studio/bridge.ts'
import { tuneTables } from '../../studio/lab.ts'
import { cardShapes } from './cards'
import { type HarnessConfig, decodeHarnessConfig } from './config'
import * as Director from './director'
import {
  type DirectorWake,
  sceneCommandLayer,
  sceneCommands,
  sceneSubscriptions,
} from './handlers'
import { liveCoopNet } from './liveNet'
import { LIVE_CROWD, LIVE_SEATS } from './liveRoom'
import { lookSheetView } from './lookSheet'
import { nextFrame, settle } from './readiness'
import { scenarioModel } from './scenario'
import { type Scene, keepScene, logMessage, sceneOf } from './sceneUpdate'
import {
  type HarnessPage,
  type SceneSettings,
  animationFrameTime,
  emptyTimings,
  settingsOf,
} from './settings'

const readConfig = (): HarnessConfig =>
  Result.getOrElse(decodeHarnessConfig(location.search), error => {
    const root = document.getElementById('root')
    if (root !== null) {
      root.textContent = `Bad harness query: ${globalThis.String(error)}`
      root.className = 'harness-error'
    }
    throw error
  })

const page: HarnessPage = {
  settings: settingsOf(readConfig()),
  framesSent: 0,
  framesRun: 0,
  sceneNumber: 0,
  maybeCarriedModel: Option.none(),
}

window.__shapeCounts = []

const countShapes = (shapes: ReadonlyArray<Draw.Shape>): number =>
  Array.reduce(
    shapes,
    0,
    (n, s) => n + 1 + (s._tag === 'Group' ? countShapes(s.shapes) : 0),
  )
window.__countShapes = () => countShapes(sceneShapes(window.__model))

window.__timings = emptyTimings()
window.__messages = []

const framesWanted = ({ config, freezeAfter }: SceneSettings): number =>
  config.tick ?? (Number.isFinite(freezeAfter) ? freezeAfter : 0)

const clearReady = () => {
  window.__harnessReady = false
  delete document.documentElement.dataset['harnessReady']
}
const tapLookSection = (maybeSection: Option.Option<string>) =>
  Option.match(maybeSection, {
    onNone: () => Effect.void,
    onSome: section =>
      Effect.andThen(
        Effect.sync(() => {
          const tab = document.querySelector(
            `.look-section[data-section="${section}"]`,
          )
          if (tab instanceof HTMLElement) {
            tab.click()
          }
        }),
        settle(() => true),
      ),
  })

const markReadyWhenSettled = (
  number: number,
  maybeLookSection: Option.Option<string>,
) => {
  clearReady()
  Effect.runFork(
    settle(
      () =>
        window.__model.saving.saveStatus !== 'Unread' &&
        page.framesRun >= framesWanted(page.settings),
    ).pipe(
      Effect.andThen(tapLookSection(maybeLookSection)),
      Effect.andThen(
        Effect.sync(() => {
          if (number === page.sceneNumber) {
            window.__harnessReady = true
            document.documentElement.dataset['harnessReady'] =
              globalThis.String(number)
          }
        }),
      ),
    ),
  )
}

const decodeScene = (query: string): HarnessConfig | undefined =>
  Result.match(decodeHarnessConfig(query), {
    onSuccess: config => config,
    onFailure: error => {
      window.__sceneError = globalThis.String(error)
      return undefined
    },
  })

const nextSceneOf = (model: Model): Scene =>
  sceneOf(
    page.settings,
    UiStruct.evolve(scenarioModel(page.settings), {
      maybeSurface: () => model.maybeSurface,
      orientation: () => model.orientation,
      saving: UiStruct.evolve({ saveStatus: () => 'Read' as const }),
    }),
  )

const directorStep = (model: Model, message: Message): Director.Return => {
  const result = pureUpdate(model, message)
  return { ...result, model: keepScene(page.settings, result.model, message) }
}

const directed = (model: Model): Model => {
  window.__model = model
  window.__directedTick = Director.currentTick()
  return model
}

type DirectorRequest =
  | Readonly<{ _tag: 'Start'; plan: string }>
  | Readonly<{ _tag: 'Step'; ticks: number }>

const directorRequests: Array<DirectorRequest> = []
const directorWake: DirectorWake = { raise: () => false }

const raiseDirectorRequest = (request: DirectorRequest) => {
  directorRequests.push(request)
  directorWake.raise()
}

const runDirectorRequests = (model: Model): Model =>
  Array.reduce(directorRequests.splice(0), model, (current, request) =>
    directed(
      request._tag === 'Start'
        ? Director.startShot(current, Director.decodePlan(request.plan)).model
        : Director.stepShot(current, request.ticks, directorStep).model,
    ),
  )

window.__director = {
  start: (plan: string) => {
    window.__directedTick = undefined
    raiseDirectorRequest({ _tag: 'Start', plan })
  },
  step: (ticks: number) => raiseDirectorRequest({ _tag: 'Step', ticks }),
  audio: () => Director.audioLog(),
  seats: () => Director.seatsOnScreen(window.__model),
}

const withDirectorCard = (
  model: Model,
  body: ApplicationHtml,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const screen = screenOf(model)
  return h.div.class('director-stage').children(
    body,
    ...Option.match(Director.cardNow(), {
      onNone: () => [],
      onSome: ({ card, age }) => [
        overlayElement(h)
          .key('director-card')
          .class('director-card')
          .attr('aria-hidden', 'true')
          .picture({
            width: screen.width,
            height: screen.height,
            shapes: cardShapes(card, screen, age),
          }),
      ],
    }),
  )
}

const harnessView = (
  h: ApplicationViewBuilder,
  model: Model,
): ApplicationHtml => {
  const { config, instrument } = page.settings
  if (config.looksheet) {
    return lookSheetView(h)
  }
  const t0 = performance.now()
  const out = view(h, model)
  if (instrument) {
    window.__timings.view.push(performance.now() - t0)
    window.__timings.viewFrames.push(animationFrameTime())
  }
  return config.director ? withDirectorCard(model, out, h) : out
}

const harnessServices = Effect.runSync(
  Effect.flatMap(Scope.make(), scope =>
    Layer.buildWithScope(
      Layer.mergeAll(
        PlayerStoreLayer,
        page.settings.config.coop === 'live'
          ? liveCoopNet(
              page.settings.config.seats ?? LIVE_SEATS,
              page.settings.config.crowd ?? LIVE_CROWD,
            )
          : quietCoopNet,
        quietInstallPrompt,
        audioEngineLayer,
      ),
      scope,
    ),
  ),
)

const recordUpdate = ({
  message,
  previousModel,
  nextModel,
  durationMs,
}: Readonly<{
  message: Readonly<{ _tag: string }>
  previousModel: Model
  nextModel: Model
  durationMs: number
}>) => {
  if (
    page.settings.instrument &&
    (message._tag === 'TickedFrame' || message._tag === 'TickedRoomFrame') &&
    nextModel !== previousModel
  ) {
    window.__timings.update.push(durationMs)
    window.__timings.tickFrames.push(animationFrameTime())
  }
}

const sceneRoot = (scene: Scene, isFirst: boolean) => {
  const swapCommands = sceneCommands(page)
  const swapSubscriptions = sceneSubscriptions({ page, wake: directorWake })
  const bootOf = Array.filter(
    bootCommands(),
    command => isFirst || command.name !== Command.nameOf(LoadSave),
  )
  const harnessUpdate = ($: App$, message: Message) => {
    const t0 = performance.now()
    const next = ApplicationNoDeps.update($.model, message, {})
    const durationMs = performance.now() - t0
    logMessage(message)
    if (message._tag === 'TickedFrame') {
      page.framesRun++
    }
    window.__isFrozen = page.framesRun >= page.settings.freezeAfter
    const directedModel =
      message._tag === 'RestoredPageFromCache' && directorRequests.length > 0
        ? runDirectorRequests(next.model)
        : next.model
    const kept = keepScene(page.settings, directedModel, message)
    window.__model = kept
    recordUpdate({
      message,
      previousModel: $.model,
      nextModel: kept,
      durationMs,
    })
    return $.set(kept).run(...swapCommands(next.commands))
  }
  const root = ApplicationDef.make({
    init: $ => $.set(scene.model).run(...swapCommands(bootOf)),
    update: harnessUpdate,
    subscriptions: ({ model }) => swapSubscriptions(subscriptions({ model })),
    view: harnessView,
    head: () => [
      Head.title(page.settings.config.looksheet ? 'Looks' : GAME_TITLE),
    ],
  })
  return root.pipe(
    Component.provide(
      Layer.provideMerge(
        Layer.mergeAll(CommandsLayer, sceneCommandLayer(page)),
        Layer.succeedContext(harnessServices),
      ),
    ),
  )
}

const container = document.getElementById('root')

const missingContainer = (): never => {
  throw new globalThis.Error('the harness page has no #root')
}

const startScene = () => {
  document.documentElement.toggleAttribute(
    'data-nohud',
    page.settings.config.nohud,
  )
  const isFirst = Option.isNone(page.maybeCarriedModel)
  const scene = Option.match(page.maybeCarriedModel, {
    onNone: () => sceneOf(page.settings, scenarioModel(page.settings)),
    onSome: nextSceneOf,
  })
  window.__isFrozen = page.framesRun >= page.settings.freezeAfter
  window.__model = scene.model
  markReadyWhenSettled(page.sceneNumber, scene.maybeLookSection)
  return Layer.launch(
    BrowserHost.mount(
      sceneRoot(scene, isFirst),
      {},
      container ?? missingContainer(),
    ),
  ).pipe(Effect.runFork)
}

defineWorldElement()
defineOverlayElement()
definePlinthElement()

let running = startScene()

const loadScene = (query: string) =>
  Effect.gen(function* () {
    const next = decodeScene(String.replace(/^\?/, '')(query))
    if (next === undefined) {
      return
    }
    clearReady()
    if (document.fullscreenElement !== null) {
      yield* Effect.promise(() =>
        document.exitFullscreen().catch(() => undefined),
      )
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    window.scrollTo(0, 0)
    page.maybeCarriedModel = Option.some(window.__model)
    yield* Fiber.interrupt(running)
    yield* nextFrame
    window.__sceneError = undefined
    page.settings = settingsOf(next)
    page.framesSent = 0
    page.framesRun = 0
    window.__messages.length = 0
    window.__timings = emptyTimings()
    page.sceneNumber++
    running = startScene()
  })

window.__loadScene = query => Effect.runPromise(loadScene(query))

const studioBridge: StudioBridge = {
  view: () => {
    const box = document.querySelector('.world-view')?.getBoundingClientRect()
    if (box === undefined) {
      return undefined
    }
    const camera = worldCameraFor(window.__model, screenOf(window.__model))
    return {
      cameraX: camera.x,
      cameraY: camera.y,
      viewWidth: camera.width,
      viewHeight: camera.height,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    }
  },
  snapshot: () => Option.getOrUndefined(snapshotWorld()),
  tune: tables => {
    tuneTables(tables)
    snapshotWorld()
  },
}
Reflect.set(window, BRIDGE_KEY, studioBridge)

window.__stall = RATTLES_BOX
window.__doors = START_LEVEL.doors

window.__whenSettled = () => Effect.runPromise(settle(() => true))
