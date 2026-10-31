// NOTE: the audit harness's page: it boots the game's own init, update,
// and view at a scene chosen by query string (config.ts), and swaps
// scenes in place (`window.__loadScene`). The scene's Model is built in
// scenario.ts and room.ts, the update around the game's in sceneUpdate.ts.

// NOTE: next, so the build's prebuilt sprite atlas is in place before any
// game module builds a sprite, as in the game's own entry.
import '@game/spriteAtlasBoot'
import './harness.css'
import { Effect, Layer, Option, Record, Scope } from 'effect'
import { Block, Canvas, Dom, Program, Runtime } from 'foldkit'
import type * as Command from 'foldkit/command'
import { type Document } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import { PARLOUR } from '@game/arena'
import { LoadSave } from '@game/boot'
import { ApplicationComposition } from '@game/composition'
import { quietCoopNet } from '@game/coop/testing'
import { quietLayer as quietInstallPrompt } from '@game/install'
import { EffectsLayer } from '@game/layer'
import { sceneShapes } from '@game/layers'
import { init, update } from '@game/main'
import { Message } from '@game/message'
import { type Model } from '@game/model'
import { screenOf } from '@game/screen'
import { STALL_BOX } from '@game/shop'
import { layer as PlayerStoreLayer } from '@game/store'
import { subscriptions } from '@game/subscriptions'
import { managedResources } from '@game/update/sound'
import { view } from '@game/view'

import { cardShapes } from './cards'
import { type HarnessConfig, decodeHarnessConfig } from './config'
import * as Director from './director'
import { type ViewHtml, lookSheetView } from './lookSheet'
import { settle } from './readiness'
import { scenarioModel } from './scenario'
import {
  type HarnessReturn,
  gameUpdate,
  keepScene,
  logMessage,
  sceneOf,
} from './sceneUpdate'
import { type HarnessPage, settingsOf } from './settings'

const readConfig = () => {
  try {
    return decodeHarnessConfig(location.search)
  } catch (error) {
    const root = document.getElementById('root')
    if (root !== null) {
      root.textContent = `Bad harness query: ${String(error)}`
      root.className = 'harness-error'
    }
    throw error
  }
}

// NOTE: the page's state across scenes (settings.ts). `window.__loadScene`
// swaps in another scene without reloading the page, so the scene's
// settings live here, not in constants.
const page: HarnessPage = {
  settings: settingsOf(readConfig()),
  framesRun: 0,
  sceneNumber: 0,
  maybeCarriedModel: Option.none(),
}

window.__shapeCounts = []

const countShapes = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  shapes.reduce(
    (n, s) => n + 1 + (s._tag === 'Group' ? countShapes(s.shapes) : 0),
    0,
  )
window.__countShapes = () => countShapes(sceneShapes(window.__model))

window.__timings = { update: [], view: [] }
window.__messages = []

// THE READY SIGNAL

// NOTE: `window.__harnessReady` (and `data-harness-ready` on the root
// element, with the scene's number) is set once the scene has rendered with
// every image decoded, once the boot has read the save (a save read later
// could change the scene), and, with `freeze`, once the frozen frame is
// reached.
// Scripts wait for it instead of sleeping. Loading another scene clears it.
const clearReady = () => {
  window.__harnessReady = false
  delete document.documentElement.dataset['harnessReady']
}
const markReadyWhenSettled = (number: number) => {
  clearReady()
  void settle(
    () =>
      window.__model.saveStatus !== 'Unread' &&
      (!Number.isFinite(page.settings.freezeAfter) ||
        page.framesRun >= page.settings.freezeAfter),
  ).then(() => {
    if (number === page.sceneNumber) {
      window.__harnessReady = true
      document.documentElement.dataset['harnessReady'] = String(number)
    }
  })
}

// SCENE SWITCHING

const decodeScene = (query: string): HarnessConfig | undefined => {
  try {
    return decodeHarnessConfig(query)
  } catch (error) {
    window.__sceneError = String(error)
    return undefined
  }
}

// NOTE: a fresh page's boot, minus what a page does once. The Model comes
// from the query as in init. The surface's measurement carries over, since
// the page and its size are the same. The save counts as read and empty, as
// in a fresh browser context, whatever earlier scenes wrote to storage, so
// init's Commands run again without LoadSave: the seed and the device,
// screen fit, and orientation lock checks. The load steps they finish are
// already done.
const nextSceneOf = (model: Model): HarnessReturn => {
  const scene = sceneOf(
    page.settings,
    modifyFields(scenarioModel(page.settings), {
      maybeSurface: () => model.maybeSurface,
      orientation: () => model.orientation,
      saveStatus: () => 'Read' as const,
    }),
  )
  return {
    model: scene.model,
    commands: [
      ...(init().commands ?? []).filter(
        command => command.name !== LoadSave.name,
      ),
      ...(scene.commands ?? []),
    ],
  }
}

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

// NOTE: a scene's Commands come from the game's update, so a Message one
// gives back may be a child's envelope (the Profile dialog's open, from
// `profile`). Foldkit types an init's Commands with the root's own Messages
// only, since child Messages come through Binding Steps there; the runtime
// routes an envelope from an init Command as it does one from update. A
// typed harness init needs a Foldkit hook for a Composition's init that
// takes update's Commands.
type InitCommand = Command.Command<
  Message,
  never,
  Effect.Services<Director.GameCommand['effect']>
>
const asInitCommands = (
  commands: ReadonlyArray<Director.GameCommand>,
): ReadonlyArray<InitCommand> =>
  // oxlint-disable-next-line typescript/consistent-type-assertions
  commands as ReadonlyArray<InitCommand>

const harnessInit = ApplicationComposition.makeInit(() => {
  // NOTE: the first scene boots as a page does; each later one boots from
  // the Model the last scene left (see nextSceneOf).
  const scene = Option.match(page.maybeCarriedModel, {
    onNone: () => {
      const base = init()
      const first = sceneOf(page.settings, scenarioModel(page.settings))
      return {
        model: first.model,
        commands: [...(base.commands ?? []), ...(first.commands ?? [])],
      }
    },
    onSome: nextSceneOf,
  })
  window.__isFrozen = page.framesRun >= page.settings.freezeAfter
  window.__model = scene.model
  markReadyWhenSettled(page.sceneNumber)
  return { model: scene.model, commands: asInitCommands(scene.commands ?? []) }
})

// THE DIRECTOR

// NOTE: a director step is the game's own update, with what the scene adds.
const directorStep = (model: Model, message: Message): HarnessReturn =>
  keepScene(page.settings, update(model, message), message)

const directed = (result: HarnessReturn): HarnessReturn => {
  window.__model = result.model
  window.__directedTick = Director.currentTick()
  return result
}

type DirectorRequest =
  | Readonly<{ _tag: 'Start'; plan: string }>
  | Readonly<{ _tag: 'Step'; ticks: number }>

// NOTE: the video tool's requests, waiting for the runtime to carry them in.
// The harness has no Message of its own (the root is the game's Block), so
// a request rides on the page-restore Subscription: the page raises a
// `pageshow` from the cache, and the RestoredPageFromCache it becomes runs
// the waiting requests in place of the build check it would start.
const directorRequests: Array<DirectorRequest> = []

const raiseDirectorRequest = (request: DirectorRequest) => {
  directorRequests.push(request)
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
}

const runDirectorRequests = (model: Model): HarnessReturn => {
  const requests = directorRequests.splice(0)
  return requests.reduce<HarnessReturn>(
    (current, request) => {
      const next =
        request._tag === 'Start'
          ? Director.startShot(current.model, Director.decodePlan(request.plan))
          : Director.stepShot(current.model, request.ticks, directorStep)
      return directed({
        model: next.model,
        commands: [...(current.commands ?? []), ...(next.commands ?? [])],
      })
    },
    { model },
  )
}

const harnessStep = (model: Model, message: Message): HarnessReturn =>
  message._tag === 'RestoredPageFromCache' && directorRequests.length > 0
    ? runDirectorRequests(model)
    : Director.logBetweenTicks(gameUpdate(page, model, message))

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

// NOTE: the harness's update is the game's, wrapped for the scene's
// settings (gameUpdate). A Composition's update is authored as one handler
// per local Message, so every tag gets the same wrapper. Child envelopes go
// to their Bindings as in the game.
// NOTE: the union's variant Schemas by tag, which Effect's TaggedUnion keeps
// at runtime as `cases`; Foldkit's MessageUnion type leaves the field out.
const hasCases = (
  union: object,
): union is Readonly<{ cases: Readonly<Record<Message['_tag'], unknown>> }> =>
  'cases' in union && typeof union.cases === 'object' && union.cases !== null
if (!hasCases(Message)) {
  throw new Error('the Message union has no cases')
}
const harnessUpdate = ApplicationComposition.makeUpdate(
  Record.map(Message.cases, () => harnessStep),
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
  }
  return config.director ? withDirectorCard(model, out, h) : out
})

const prepareHarness = () =>
  ApplicationComposition.prepareBlock({
    init: harnessInit,
    update: harnessUpdate,
    view: harnessView,
    subscriptions,
    managedResources,
    EffectsLayer,
  })
const HarnessBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepareHarness
> = Block.assemble(prepareHarness)

// NOTE: the services are built once for the page and shared by every
// scene, as one runtime shared them before scenes restarted it: the player
// store keeps one SQLite worker.
const harnessServices = Effect.runSync(
  Effect.flatMap(Scope.make(), scope =>
    Layer.buildWithScope(
      Layer.mergeAll(PlayerStoreLayer, quietCoopNet, quietInstallPrompt),
      scope,
    ),
  ),
)

const startScene = () =>
  Runtime.embed(
    Program.make({
      block: HarnessBlock,
      container: document.getElementById('root'),
      slow: {
        show: 'Always',
        measuredPhases: ['Update'],
        thresholdOverrides: { Update: -1 },
        onSlow: context => {
          if (context._tag === 'Update') {
            logMessage(context.message)
            window.__model = context.nextModel
          }
        },
      },
      ...(page.settings.config.nodev ? { devTools: false as const } : {}),
    }).provide(Layer.succeedContext(harnessServices)),
  )

let running = startScene()

// NOTE: a disposed runtime puts its empty container back on its own time,
// so the next scene waits for `#root` before it starts.
const containerRestored = async () => {
  for (let frame = 0; frame < 120; frame++) {
    if (document.getElementById('root') !== null) {
      return
    }
    await Effect.runPromise(
      Effect.callback<void>(resume => {
        requestAnimationFrame(() => resume(Effect.void))
      }),
    )
  }
  throw new Error('the harness container did not come back')
}

// NOTE: `window.__loadScene('wave=3&start=wave')` swaps the scene in place:
// the runtime stops, as a page leaving would, and starts again on the new
// scene's Model. It resets what a new page would: open dialogs, focus, full
// screen, and scroll. Wait for the ready signal afterwards. `nodev` belongs
// to the page, not the scene.
window.__loadScene = async (query: string) => {
  const next = decodeScene(query.replace(/^\?/, ''))
  if (next === undefined) {
    return
  }
  clearReady()
  await Effect.runPromise(releaseDialogs)
  if (document.fullscreenElement !== null) {
    await document.exitFullscreen().catch(() => undefined)
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  window.scrollTo(0, 0)
  page.maybeCarriedModel = Option.some(window.__model)
  running.dispose()
  await containerRestored()
  window.__sceneError = undefined
  page.settings = settingsOf(next)
  page.framesRun = 0
  window.__messages.length = 0
  window.__timings = { update: [], view: [] }
  page.sceneNumber++
  running = startScene()
}

window.__stall = STALL_BOX
window.__doors = PARLOUR.doors

// NOTE: for scripts after a click or a key: resolves once the page has
// rendered and every image it asked for has decoded.
window.__whenSettled = () => settle(() => true)
