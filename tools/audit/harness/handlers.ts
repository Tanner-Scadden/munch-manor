// NOTE: the scene's hand on what reaches the game's update. The harness
// runs the game's own update; what a scene changes about the world outside
// it (frozen or fixed frames, a seed it keeps, a screen fit or rotation it
// claims, a gift that never reloads, the director's requests and sound log)
// it changes here, as handler Layers over the game's own. Each is chosen
// once per scene, when its runtime builds the Layer, from the scene's
// settings; a scene that does not ask keeps the game's handler.

import { Effect, Layer, Option, Queue, Result, Stream } from 'effect'

import {
  DetectOrientationLock,
  DetectScreenFit,
  GenerateSeed,
  ReadUpdateMarker,
} from '@game/app/boot'
import {
  Message,
  type RestoredPageFromCache,
  type TickedFrame,
} from '@game/app/message'
import { subscriptions } from '@game/app/subscriptions'
import { WaitForUnwrap } from '@game/app/update/home'
import { CueMusic } from '@game/app/update/music'
import { PlaySound } from '@game/app/update/sound'
import { FetchBuild } from '@game/app/update/version'
import { PlayerStore } from '@game/platform/store'
import { RUNNING_BUILD } from '@game/platform/version'

import * as Director from './director'
import { type HarnessPage } from './settings'

const FIXED_FRAME_MS = 1000 / 60

const fixedFrame = (): TickedFrame =>
  Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })

// NOTE: a call on every animation frame while the Stream runs.
const animationFrames = (onFrame: () => Option.Option<TickedFrame>) =>
  Stream.callback<TickedFrame>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const state = { frameId: 0 }
        const tick = () => {
          Option.map(onFrame(), frame => Queue.offerUnsafe(queue, frame))
          state.frameId = requestAnimationFrame(tick)
        }
        state.frameId = requestAnimationFrame(tick)
        return state
      }),
      state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

// NOTE: `tick=N` plays N frames of a fixed 1/60 second at once, as soon as
// the scene is in, and holds the picture there. The game is deterministic,
// so this is the picture `freeze=N` waits N real frames for. The Commands
// those frames give, such as opening the shop's dialog, run as they would
// frame by frame. The frames go out whether the game's frame is active or
// not, as the scene asked for them, and only once: the Subscription restarts
// when the game's activity changes.
const tickFrames = (page: HarnessPage, ticks: number) =>
  Stream.suspend(() => {
    const count = Math.max(0, ticks - page.framesSent)
    page.framesSent += count
    return Stream.fromIterable(
      globalThis.Array.from({ length: count }, fixedFrame),
    )
  })

// NOTE: `freeze=N` runs exactly N frames of a fixed 1/60 second and then
// holds the picture. It counts frames only once the surface is measured, so
// how long the first render takes cannot change which frame the measurement
// lands on, and two builds freeze on the same picture.
const frozenFrames = (page: HarnessPage, isActive: boolean) =>
  isActive
    ? animationFrames(() => {
        if (
          page.framesSent >= page.settings.freezeAfter ||
          Option.isNone(window.__model.maybeSurface)
        ) {
          return Option.none()
        }
        page.framesSent++
        return Option.some(fixedFrame())
      })
    : Stream.empty

// NOTE: the frame clock: the game's own unless the scene is frozen, plays
// `tick` frames, or is the director's (which steps the game itself).
const frameLayer = (page: HarnessPage) => {
  const { config, freezeAfter } = page.settings
  const ticks = config.tick
  if (config.director) {
    return subscriptions.frame.toLayer(Effect.succeed(() => Stream.empty))
  } else if (ticks !== undefined) {
    return subscriptions.frame.toLayer(
      Effect.succeed(() => tickFrames(page, ticks)),
    )
  } else if (Number.isFinite(freezeAfter)) {
    return subscriptions.frame.toLayer(
      Effect.succeed(({ isActive }) => frozenFrames(page, isActive)),
    )
  } else {
    return subscriptions.frame.layer
  }
}

// NOTE: `sync` keeps the sync state the scene set: only a synced save gets
// through.
const syncLayer = (page: HarnessPage) =>
  page.settings.config.sync === undefined
    ? subscriptions.playerSync.layer
    : subscriptions.playerSync.toLayer(
        Effect.gen(function* () {
          const store = yield* PlayerStore
          return () =>
            Stream.filterMap(store.events, event =>
              event._tag === 'SyncedSave'
                ? Result.succeed(
                    Message.UpdatedSyncedSave({ save: event.save }),
                  )
                : Result.fail(event),
            )
        }),
      )

// NOTE: the director's requests come in as RestoredPageFromCache, from
// `wake`, in place of the page's own `pageshow` (see entry.ts).
const directorWakes = (wake: DirectorWake) =>
  Stream.callback<RestoredPageFromCache>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        wake.raise = () =>
          Queue.offerUnsafe(queue, Message.RestoredPageFromCache())
      }),
      () =>
        Effect.sync(() => {
          wake.raise = () => false
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

export type DirectorWake = { raise: () => boolean }

// NOTE: the Commands a scene answers itself. A seed the scene froze is kept,
// the gift never reloads the harness (it stays mid-unwrap, as `unwrap` shows
// it), `fit` and `rotate` claim the screen fit and rotation lock, `greet`
// reads as the page just reloaded onto this build, and a director shot logs
// its sounds and music by tick instead of playing them, with no build check
// to bring a gift in mid-shot.
const commandLayers = (page: HarnessPage) => {
  const { config, freezeAfter } = page.settings
  const fit = config.fit
  return Layer.mergeAll(
    Number.isFinite(freezeAfter)
      ? GenerateSeed.toLayer(Effect.succeed(() => Effect.never))
      : GenerateSeed.layer,
    WaitForUnwrap.toLayer(Effect.succeed(() => Effect.never)),
    fit === undefined
      ? DetectScreenFit.layer
      : DetectScreenFit.toLayer(
          Effect.succeed(() =>
            Effect.succeed(
              Message.CompletedDetectScreenFit({
                screenFit: fit === 'home' ? 'HomeScreen' : 'Fullscreen',
              }),
            ),
          ),
        ),
    config.rotate
      ? DetectOrientationLock.toLayer(
          Effect.succeed(() =>
            Effect.succeed(
              Message.CompletedDetectOrientationLock({
                orientationLock: 'Supported',
              }),
            ),
          ),
        )
      : DetectOrientationLock.layer,
    config.greet
      ? ReadUpdateMarker.toLayer(
          Effect.succeed(() =>
            Effect.succeed(
              Message.CompletedReadUpdateMarker({
                maybeBuild: Option.some(RUNNING_BUILD),
              }),
            ),
          ),
        )
      : ReadUpdateMarker.layer,
    config.director
      ? FetchBuild.toLayer(Effect.succeed(() => Effect.never))
      : FetchBuild.layer,
    config.director
      ? PlaySound.toLayer(
          Effect.succeed(({ sound, variation }) =>
            Effect.sync(() => {
              Director.logSound(sound, variation)
              return Message.CompletedPlaySound({ sound, outcome: 'Played' })
            }),
          ),
        )
      : PlaySound.layer,
    config.director
      ? CueMusic.toLayer(
          Effect.succeed(cue =>
            Effect.sync(() => {
              Director.logMusic(cue)
              return Message.CompletedCueMusic({ mood: cue.mood })
            }),
          ),
        )
      : CueMusic.layer,
  )
}

// NOTE: the Subscriptions a scene answers itself: the frame clock, the sync
// state with `sync`, Chrome's install offer kept on with `install`, and with
// `director` the room's own frame (a shot steps the room itself) and the
// director's requests.
const subscriptionLayers = (page: HarnessPage, wake: DirectorWake) => {
  const { config } = page.settings
  return Layer.mergeAll(
    frameLayer(page),
    syncLayer(page),
    config.install
      ? subscriptions.installOffers.toLayer(Effect.succeed(() => Stream.empty))
      : subscriptions.installOffers.layer,
    config.director
      ? subscriptions.roomFrame.toLayer(Effect.succeed(() => Stream.empty))
      : subscriptions.roomFrame.layer,
    config.director
      ? subscriptions.pageRestores.toLayer(
          Effect.succeed(() => directorWakes(wake)),
        )
      : subscriptions.pageRestores.layer,
  )
}

// NOTE: built with each scene's runtime, after its settings are in place,
// and merged after the game's own handlers, so these win.
export const sceneHandlers = ({
  page,
  wake,
}: Readonly<{ page: HarnessPage; wake: DirectorWake }>) =>
  Layer.unwrap(
    Effect.sync(() =>
      Layer.mergeAll(commandLayers(page), subscriptionLayers(page, wake)),
    ),
  )
