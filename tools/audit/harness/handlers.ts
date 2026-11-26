// NOTE: the scene's hand on what reaches the game's update. The harness
// runs the game's own update; what a scene changes about the world outside
// it (frozen or fixed frames, a seed it keeps, a screen fit or rotation it
// claims, a gift that never reloads, the director's requests and sound log)
// it changes here: the Commands the game issues that only read the browser
// are swapped for the scene's own as they are issued, the Commands that are
// services get the scene's Layer, and the Subscriptions the game asks for
// are swapped by name. Each is chosen once per scene, from the scene's
// settings; a scene that does not ask keeps the game's own.

import { Array, Effect, Layer, Option, Queue, Result, Stream } from 'effect'

import { Command, Component, Subscription } from '@effect/ui'
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
import type { subscriptions, update } from '@game/app/pureApp'
import { WaitForUnwrap } from '@game/app/update/home'
import { CueMusic } from '@game/app/update/music'
import { PlaySound } from '@game/app/update/sound'
import { FetchBuild } from '@game/app/update/version'
import { ScreenFit } from '@game/platform/deviceSchema'
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
// not, as the scene asked for them, and only once: the Subscription keeps
// its key for the whole scene, and its Stream ends once they are out.
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
// lands on, and two builds freeze on the same picture. It runs while the
// game asks for its frame.
const frozenFrames = (page: HarnessPage) =>
  animationFrames(() => {
    if (
      page.framesSent >= page.settings.freezeAfter ||
      Option.isNone(window.__model.maybeSurface)
    ) {
      return Option.none()
    }
    page.framesSent++
    return Option.some(fixedFrame())
  })

// NOTE: `sync` keeps the sync state the scene set: only a synced save gets
// through.
const syncedSaves = Stream.unwrap(
  Effect.gen(function* () {
    const store = yield* PlayerStore
    return Stream.filterMap(store.events, event =>
      event._tag === 'SyncedSave'
        ? Result.succeed(Message.UpdatedSyncedSave({ save: event.save }))
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

// THE COMMANDS

// NOTE: one Command the game's update gives back.
export type GameCommand = ReturnType<typeof update>['commands'][number]

// NOTE: the scene's own answers to the Commands that read the browser,
// issued in their place: a seed that never comes (a frozen scene keeps its
// own), a gift that never reloads, and the screen fit, rotation lock, and
// update marker the scene claims.
const HoldSeed = Command.make('HoldSeed', { args: {} }, () => Effect.never)

const HoldUnwrap = Command.make('HoldUnwrap', { args: {} }, () => Effect.never)

const ClaimScreenFit = Command.make(
  'ClaimScreenFit',
  { args: { screenFit: ScreenFit } },
  ({ screenFit }) =>
    Effect.succeed(Message.CompletedDetectScreenFit({ screenFit })),
)

const ClaimOrientationLock = Command.make(
  'ClaimOrientationLock',
  { args: {} },
  () =>
    Effect.succeed(
      Message.CompletedDetectOrientationLock({ orientationLock: 'Supported' }),
    ),
)

const ClaimUpdateMarker = Command.make('ClaimUpdateMarker', { args: {} }, () =>
  Effect.succeed(
    Message.CompletedReadUpdateMarker({
      maybeBuild: Option.some(RUNNING_BUILD),
    }),
  ),
)

// NOTE: what each swapped Command becomes in this scene, by its name: a seed
// the scene froze is kept, the gift never reloads the harness (it stays
// mid-unwrap, as `unwrap` shows it), `fit` and `rotate` claim the screen fit
// and rotation lock, and `greet` reads as the page just reloaded onto this
// build.
const swapsOf = (page: HarnessPage): ReadonlyMap<string, () => GameCommand> => {
  const { config, freezeAfter } = page.settings
  const fit = config.fit
  return new Map<string, () => GameCommand>([
    ...(Number.isFinite(freezeAfter)
      ? [[Command.nameOf(GenerateSeed), () => HoldSeed.make()] as const]
      : []),
    [Command.nameOf(WaitForUnwrap), () => HoldUnwrap.make()],
    ...(fit === undefined
      ? []
      : [
          [
            Command.nameOf(DetectScreenFit),
            () =>
              ClaimScreenFit.make({
                screenFit: fit === 'home' ? 'HomeScreen' : 'Fullscreen',
              }),
          ] as const,
        ]),
    ...(config.rotate
      ? [
          [
            Command.nameOf(DetectOrientationLock),
            () => ClaimOrientationLock.make(),
          ] as const,
        ]
      : []),
    ...(config.greet
      ? [
          [
            Command.nameOf(ReadUpdateMarker),
            () => ClaimUpdateMarker.make(),
          ] as const,
        ]
      : []),
  ])
}

// NOTE: the scene's Commands in place of the game's, as they are issued.
export const sceneCommands = (
  page: HarnessPage,
): ((commands: ReadonlyArray<GameCommand>) => ReadonlyArray<GameCommand>) => {
  const swaps = swapsOf(page)
  return commands =>
    Array.map(commands, command =>
      Option.match(Option.fromUndefinedOr(swaps.get(command.name)), {
        onNone: () => command,
        onSome: swap => swap(),
      }),
    )
}

// NOTE: a director shot logs its sounds and music by tick instead of playing
// them, with no build check to bring a gift in mid-shot. Merged after the
// game's own Command Layers, so these win.
export const sceneCommandLayer = (page: HarnessPage) =>
  page.settings.config.director
    ? Layer.mergeAll(
        FetchBuild.toLayer(() => Effect.never),
        PlaySound.toLayer(({ sound, variation }) =>
          Effect.sync(() => {
            Director.logSound(sound, variation)
            return Component.noop
          }),
        ),
        CueMusic.toLayer(cue =>
          Effect.sync(() => {
            Director.logMusic(cue)
            return Component.noop
          }),
        ),
      )
    : Layer.empty

// THE SUBSCRIPTIONS

type GameSubscription = ReturnType<typeof subscriptions>[number]

// NOTE: the Subscriptions a scene answers itself, by the game's name for
// each: the frame clock (frozen, `tick`'s fixed frames, or none for the
// director, which steps the game itself), the sync state with `sync`,
// Chrome's install offer kept off with `install`, and with `director` the
// room's own frame (a shot steps the room itself) and the director's
// requests in place of the page's restores. Each swapped list is kept by
// the game's, which keeps its own lists by their gates, so a frame builds
// no list.
export const sceneSubscriptions = ({
  page,
  wake,
}: Readonly<{ page: HarnessPage; wake: DirectorWake }>): ((
  list: ReadonlyArray<GameSubscription>,
) => ReadonlyArray<GameSubscription>) => {
  const { config, freezeAfter } = page.settings
  const ticks = config.tick
  const dropped = new Set<string>([
    ...(config.director || ticks !== undefined ? ['Frame'] : []),
    ...(config.director ? ['RoomFrame'] : []),
    ...(config.install ? ['InstallOffers'] : []),
  ])
  const frozen = Subscription.make('Frame', 'Frozen', () => frozenFrames(page))
  const synced = Subscription.make('PlayerSync', syncedSaves)
  const wakes = Subscription.make('PageRestores', 'Director', () =>
    directorWakes(wake),
  )
  const added: ReadonlyArray<GameSubscription> =
    ticks === undefined || config.director
      ? []
      : [Subscription.make('HarnessTicks', tickFrames(page, ticks))]
  const swapped = (
    entry: GameSubscription,
  ): Result.Result<GameSubscription, GameSubscription> =>
    dropped.has(entry.name)
      ? Result.fail(entry)
      : entry.name === 'Frame' && Number.isFinite(freezeAfter)
        ? Result.succeed(frozen)
        : entry.name === 'PlayerSync' && config.sync !== undefined
          ? Result.succeed(synced)
          : entry.name === 'PageRestores' && config.director
            ? Result.succeed(wakes)
            : Result.succeed(entry)
  const kept = new WeakMap<
    ReadonlyArray<GameSubscription>,
    ReadonlyArray<GameSubscription>
  >()
  return list =>
    Option.getOrElse(Option.fromUndefinedOr(kept.get(list)), () => {
      const built = [...Array.filterMap(list, swapped), ...added]
      kept.set(list, built)
      return built
    })
}
