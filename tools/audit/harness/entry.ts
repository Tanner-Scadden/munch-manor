// NOTE: the audit harness's page: it boots the game's own init, update,
// and view at a scene chosen by query string (config.ts), and swaps
// scenes in place (`window.__loadScene`). The scene's Model is built in
// scenario.ts and room.ts, the update around the game's in sceneUpdate.ts.

// NOTE: next, so the build's prebuilt sprite atlas is in place before any
// game module builds a sprite, as in the game's own entry.
import '@game/art/spriteAtlasBoot'
import './harness.css'
import {
  Array,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
  Scope,
  String,
} from 'effect'
import { Canvas, Dom, Program, Runtime } from 'foldkit'
import { type Document } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import { Dialog, Tabs } from '@foldkit/ui'
import { ProfileDialogBinding } from '@game/app/bindings'
import { LoadSave, bootCommands } from '@game/app/boot'
import { ApplicationComposition } from '@game/app/composition'
import { ApplicationBlock, makeNoopStep } from '@game/app/definition'
import { EffectsLayer } from '@game/app/layer'
import { sceneShapes } from '@game/app/layers'
import { update } from '@game/app/main'
import type { Message } from '@game/app/message'
import { type Model, initialModel as gameInitialModel } from '@game/app/model'
import { update as pureUpdate } from '@game/app/pureApp'
import { subscriptions } from '@game/app/subscriptions'
import { managedResources } from '@game/app/update/sound'
import { modelStep } from '@game/app/update/step'
import { view } from '@game/app/view'
import { CoopLayer } from '@game/features/coop'
import { quietCoopNet } from '@game/features/coop/testing'
import { ProfileLayer } from '@game/features/profile/layer'
import { quietLayer as quietInstallPrompt } from '@game/platform/install'
import { layer as PlayerStoreLayer } from '@game/platform/store'
import { screenOf } from '@game/render/screen'
import { PARLOUR } from '@game/world/level/arena'
import { STALL_BOX } from '@game/world/shop/shop'

import { cardShapes } from './cards'
import { type HarnessConfig, decodeHarnessConfig } from './config'
import * as Director from './director'
import { type DirectorWake, sceneHandlers } from './handlers'
import { liveCoopNet } from './liveNet'
import { LIVE_CROWD, LIVE_SEATS } from './liveRoom'
import { type ViewHtml, lookSheetView } from './lookSheet'
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

// NOTE: the page's state across scenes (settings.ts). `window.__loadScene`
// swaps in another scene without reloading the page, so the scene's
// settings live here, not in constants.
const page: HarnessPage = {
  settings: settingsOf(readConfig()),
  framesSent: 0,
  framesRun: 0,
  sceneNumber: 0,
  maybeCarriedModel: Option.none(),
}

window.__shapeCounts = []

const countShapes = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  Array.reduce(
    shapes,
    0,
    (n, s) => n + 1 + (s._tag === 'Group' ? countShapes(s.shapes) : 0),
  )
window.__countShapes = () => countShapes(sceneShapes(window.__model))

window.__timings = emptyTimings()
window.__messages = []

// THE READY SIGNAL

// NOTE: `window.__harnessReady` (and `data-harness-ready` on the root
// element, with the scene's number) is set once the scene has rendered with
// every image decoded, once the boot has read the save (a save read later
// could change the scene), and, with `freeze`, once the frozen frame is
// reached.
// Scripts wait for it instead of sleeping. Loading another scene clears it.
// NOTE: the frames a scene plays before it holds: `tick`'s, or `freeze`'s.
const framesWanted = ({ config, freezeAfter }: SceneSettings): number =>
  config.tick ?? (Number.isFinite(freezeAfter) ? freezeAfter : 0)

const clearReady = () => {
  window.__harnessReady = false
  delete document.documentElement.dataset['harnessReady']
}
const markReadyWhenSettled = (number: number) => {
  clearReady()
  Effect.runFork(
    settle(
      () =>
        window.__model.saveStatus !== 'Unread' &&
        page.framesRun >= framesWanted(page.settings),
    ).pipe(
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

// SCENE SWITCHING

const decodeScene = (query: string): HarnessConfig | undefined =>
  Result.match(decodeHarnessConfig(query), {
    onSuccess: config => config,
    onFailure: error => {
      window.__sceneError = globalThis.String(error)
      return undefined
    },
  })

// NOTE: a fresh page's boot, minus what a page does once. The Model comes
// from the query as in init. The surface's measurement carries over, since
// the page and its size are the same. The save counts as read and empty, as
// in a fresh browser context, whatever earlier scenes wrote to storage, so
// init's Commands run again without LoadSave: the seed and the device,
// screen fit, and orientation lock checks. The load steps they finish are
// already done.
const nextSceneOf = (model: Model): Scene =>
  sceneOf(
    page.settings,
    modifyFields(scenarioModel(page.settings), {
      maybeSurface: () => model.maybeSurface,
      orientation: () => model.orientation,
      saveStatus: () => 'Read' as const,
    }),
  )

// NOTE: an open dialog holds page state outside the Model: the inert,
// hidden background, the focus trap, and the scroll lock. A dialog closed by
// swapping the Model never runs its CloseDialog Command, so this releases
// what every dialog holds, as that Command does, before the next scene.
const releaseDialogs = Effect.suspend(() =>
  Effect.forEach(
    globalThis.Array.from(document.querySelectorAll('dialog[id]')),
    dialog =>
      Dom.releaseDialogResources(dialog.id).pipe(
        Effect.flatMap(isReleased =>
          isReleased ? Dom.unlockScroll : Effect.void,
        ),
      ),
    { discard: true },
  ),
)

// NOTE: the scene's init is the game's boot with the scene's Model: its
// Commands (without LoadSave after the first scene), then the scene's Model
// in place of the fresh one, and the Profile's Dialog opened through its
// Binding when the scene asks for it.
const harnessInit = ApplicationComposition.makeInit(() => {
  // NOTE: the first scene boots as a page does; each later one boots from
  // the Model the last scene left (see nextSceneOf).
  const isFirst = Option.isNone(page.maybeCarriedModel)
  const scene = Option.match(page.maybeCarriedModel, {
    onNone: () => sceneOf(page.settings, scenarioModel(page.settings)),
    onSome: nextSceneOf,
  })
  window.__isFrozen = page.framesRun >= page.settings.freezeAfter
  window.__model = scene.model
  markReadyWhenSettled(page.sceneNumber)
  return {
    model: gameInitialModel,
    commands: Array.filter(
      bootCommands(),
      command => isFirst || command.name !== LoadSave.name,
    ),
    steps: [
      modelStep(() => scene.model),
      scene.isProfileOpen ? ProfileDialogBinding.requestOpen() : makeNoopStep(),
      modelStep(model => {
        window.__model = model
        return model
      }),
    ],
  }
})

// THE DIRECTOR

// NOTE: a director step is the game's own update, with what the scene adds.
// A shot plays on the game's pure update (src/app/pureApp.ts), so the sounds and
// music each tick asks for are logged by tick, and the runtime takes the
// Model it reaches. The other Commands a shot's ticks give do not run.
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

// NOTE: the video tool's requests, waiting for the runtime to carry them in.
// The harness has no Message of its own (the root is the game's Block), so
// a request rides on the page-restore Subscription: with `director` it is
// the harness's (handlers.ts), and the RestoredPageFromCache it raises runs
// the waiting requests.
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

// NOTE: the video tool's controls (tools/video, with `director` in the
// query). `start` takes the shot's script as JSON, `step(n)` plays n fixed
// ticks; each sets `window.__directedTick` once the Model holds them, and
// `audio()` is the sound and music log so far.
window.__director = {
  start: (plan: string) => {
    window.__directedTick = undefined
    raiseDirectorRequest({ _tag: 'Start', plan })
  },
  step: (ticks: number) => raiseDirectorRequest({ _tag: 'Step', ticks }),
  audio: () => Director.audioLog(),
  seats: () => Director.seatsOnScreen(window.__model),
}

// NOTE: the harness's update is the game's, then the director's requests,
// then what the scene keeps (keepScene) after every dispatch, its children's
// envelopes included.
const ranDirector = ApplicationComposition.makeUpdate.on([
  'RestoredPageFromCache',
])(model => ({
  model: directorRequests.length > 0 ? runDirectorRequests(model) : model,
}))

const keptScene = ApplicationComposition.makeUpdate.each((model, message) => {
  if (message._tag === 'TickedFrame') {
    page.framesRun++
  }
  window.__isFrozen = page.framesRun >= page.settings.freezeAfter
  const kept = keepScene(page.settings, model, message)
  window.__model = kept
  return { model: kept }
})

const harnessUpdate = ApplicationComposition.makeUpdate.compose(
  update,
  ranDirector,
  keptScene,
)

// NOTE: a director shot's card (cards.ts) on a canvas the screen's size in
// game pixels, over the game. The wrapper has no box of its own, so the
// game's root lays out as it always does.
const withDirectorCard = (
  model: Model,
  document: Document,
  h: ViewHtml,
): Document => {
  const screen = screenOf(model)
  return {
    ...document,
    body: h.div(
      [h.Class('director-stage')],
      [
        document.body,
        ...Option.match(Director.cardNow(), {
          onNone: () => [],
          onSome: ({ card, age }) => [
            Canvas.view(
              {
                width: screen.width,
                height: screen.height,
                shapes: cardShapes(card, screen, age),
                className: 'director-card',
                key: 'director-card',
              },
              h,
            ),
          ],
        }),
      ],
    ),
  }
}

const harnessView = ApplicationComposition.makeView((model, h): Document => {
  const { config, instrument } = page.settings
  if (config.looksheet) {
    return lookSheetView(h)
  }
  const t0 = performance.now()
  const out = view(model, h)
  if (instrument) {
    window.__timings.view.push(performance.now() - t0)
    window.__timings.viewFrames.push(animationFrameTime())
  }
  return config.director ? withDirectorCard(model, out, h) : out
})

// NOTE: the game's own Block, completed with the harness's init, update,
// and view around the game's, the game's children, and the game's handlers
// with the scene's in front (handlers.ts).
const harnessLayer = ApplicationBlock.makeLayer({
  init: harnessInit,
  update: harnessUpdate,
  view: harnessView,
  subscriptions,
  managedResources,
  EffectsLayer: Layer.mergeAll(
    EffectsLayer,
    sceneHandlers({ page, wake: directorWake }),
  ),
}).pipe(
  Layer.provide(
    Layer.mergeAll(Dialog.layer, Tabs.layer, ProfileLayer, CoopLayer),
  ),
)

// NOTE: the services are built once for the page and shared by every
// scene, as one runtime shared them before scenes restarted it: the player
// store keeps one SQLite worker.
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
      ),
      scope,
    ),
  ),
)

// NOTE: `instrument` records each frame's update time: TickedFrame, or in
// an online run the room's TickedRoomFrame, which is the one that changes
// the Model there.
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

const startScene = () =>
  Runtime.embed(
    Program.make({
      block: ApplicationBlock,
      layer: harnessLayer,
      container: document.getElementById('root'),
      slow: {
        show: 'Always',
        measuredPhases: ['Update'],
        thresholdOverrides: { Update: -1 },
        onSlow: context => {
          if (context._tag === 'Update') {
            logMessage(context.message)
            window.__model = context.nextModel
            recordUpdate(context)
          }
        },
      },
      ...(page.settings.config.nodev ? { devTools: false as const } : {}),
    }).provide(Layer.succeedContext(harnessServices)),
  )

let running = startScene()

// NOTE: the harness's empty container never came back after a scene.
class ContainerMissing extends Schema.TaggedError<
  ContainerMissing,
  { readonly brand: unique symbol }
>()('ContainerMissing', { message: Schema.String }) {}

const CONTAINER_FRAMES = 120

// NOTE: a disposed runtime puts its empty container back on its own time,
// so the next scene waits for `#root` before it starts.
const containerRestored = Effect.gen(function* () {
  for (let frame = 0; frame < CONTAINER_FRAMES; frame++) {
    if (document.getElementById('root') !== null) {
      return
    }
    yield* nextFrame
  }
  return yield* ContainerMissing.make({
    message: 'the harness container did not come back',
  })
})

// NOTE: `window.__loadScene('wave=3&start=wave')` swaps the scene in place:
// the runtime stops, as a page leaving would, and starts again on the new
// scene's Model. It resets what a new page would: open dialogs, focus, full
// screen, and scroll. Wait for the ready signal afterwards. `nodev` belongs
// to the page, not the scene.
const loadScene = (query: string) =>
  Effect.gen(function* () {
    const next = decodeScene(String.replace(/^\?/, '')(query))
    if (next === undefined) {
      return
    }
    clearReady()
    yield* releaseDialogs
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
    yield* Effect.promise(() => running.dispose())
    yield* containerRestored
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

window.__stall = STALL_BOX
window.__doors = PARLOUR.doors

// NOTE: for scripts after a click or a key: resolves once the page has
// rendered and every image it asked for has decoded.
window.__whenSettled = () => Effect.runPromise(settle(() => true))
