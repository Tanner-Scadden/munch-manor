import { Effect, Function, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { VersionMessage } from '#platform/message.ts'
import {
  isUsingServiceWorker,
  registerServiceWorker,
  updateServiceWorker,
} from '#platform/serviceWorker.ts'
import {
  RUNNING_BUILD,
  fetchRemoteBuild,
  isCheckingForUpdates,
  isGreetingDue,
  maybeNewerBuild,
} from '#platform/version.ts'

import {
  greetUpdate,
  newsFromGreeting,
  reloadOntoNewerBuild,
  rewrapUpdateGift,
  unwrapUpdateGift,
} from './home.ts'
import { tapSound, unlockAudio } from './sound.ts'
import { type UpdateStep, combine, defineHandlers } from './step.ts'

export class FetchBuild extends Command.Service<FetchBuild>()(
  'app/FetchBuild',
  {
    args: {},
    success: VersionMessage,
    mode: 'switch',
  },
) {
  static readonly layer = this.toLayer(() =>
    fetchRemoteBuild.pipe(
      Effect.match({
        onSuccess: build => VersionMessage.CompletedFetchBuild({ build }),
        onFailure: error =>
          VersionMessage.FailedFetchBuild({ reason: error.reason }),
      }),
    ),
  )
}

export const RegisterServiceWorker = Command.make(
  'RegisterServiceWorker',
  { args: {} },
  () =>
    registerServiceWorker.pipe(
      Effect.catch(error =>
        Effect.logWarning('register service worker', error.reason),
      ),
      Effect.as(Component.noop),
    ),
)

export const UpdateServiceWorker = Command.make(
  'UpdateServiceWorker',
  { args: {} },
  () =>
    updateServiceWorker.pipe(
      Effect.catch(error =>
        Effect.logWarning('update service worker', error.reason),
      ),
      Effect.as(Component.noop),
    ),
)

export const checkForUpdate: UpdateStep = $ =>
  isCheckingForUpdates(RUNNING_BUILD) ? $.run(FetchBuild.make()) : $.model

export const recordRemoteBuild: {
  (remoteBuild: string): (runningBuild: string) => UpdateStep
  (runningBuild: string, remoteBuild: string): UpdateStep
} = Function.dual(
  2,
  (runningBuild: string, remoteBuild: string): UpdateStep =>
    $ => {
      const maybeNewer = maybeNewerBuild(runningBuild, remoteBuild)
      const next = $.evolve({
        release: UiStruct.evolve({ maybeNewerBuild: () => maybeNewer }),
      })
      return Option.isSome(maybeNewer) && isUsingServiceWorker(runningBuild)
        ? next.run(UpdateServiceWorker.make())
        : next
    },
)

export const registerServiceWorkerAfterSplash =
  (runningBuild: string): UpdateStep =>
  $ =>
    isUsingServiceWorker(runningBuild)
      ? $.run(RegisterServiceWorker.make())
      : $.model

export const versionHandlers = defineHandlers({
  TickedUpdateCheck: checkForUpdate,

  CompletedFetchBuild: ($, { build }) =>
    recordRemoteBuild(RUNNING_BUILD, build)($),

  FailedFetchBuild: $ => $.model,

  ClickedUpdateButton: combine([unlockAudio, unwrapUpdateGift]),

  CompletedWaitForUnwrap: reloadOntoNewerBuild,

  CompletedReadUpdateMarker: ($, { maybeBuild }) =>
    greetUpdate(isGreetingDue(RUNNING_BUILD, maybeBuild))($),

  ClickedUpdateGreetingNewsButton: combine([
    unlockAudio,
    tapSound,
    newsFromGreeting,
  ]),

  FailedReloadPage: rewrapUpdateGift,
})
