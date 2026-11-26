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
import { PlayerStore } from '@game/platform/save/store'
import { RUNNING_BUILD } from '@game/platform/version'

import * as Director from './director'
import { type HarnessPage } from './settings'

const FIXED_FRAME_MS = 1000 / 60

const fixedFrame = (): TickedFrame =>
  Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })

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

const tickFrames = (page: HarnessPage, ticks: number) =>
  Stream.suspend(() => {
    const count = Math.max(0, ticks - page.framesSent)
    page.framesSent += count
    return Stream.fromIterable(
      globalThis.Array.from({ length: count }, fixedFrame),
    )
  })

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

export type GameCommand = ReturnType<typeof update>['commands'][number]

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

type GameSubscription = ReturnType<typeof subscriptions>[number]

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
