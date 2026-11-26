import { Effect, Function, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { VersionMessage } from '../../platform/message'
import {
  isUsingServiceWorker,
  registerServiceWorker,
  updateServiceWorker,
} from '../../platform/serviceWorker'
import {
  RUNNING_BUILD,
  fetchRemoteBuild,
  isCheckingForUpdates,
  isGreetingDue,
  maybeNewerBuild,
} from '../../platform/version'
import {
  greetUpdate,
  newsFromGreeting,
  reloadOntoNewerBuild,
  rewrapUpdateGift,
  unwrapUpdateGift,
} from './home'
import { tapSound, unlockAudio } from './sound'
import { type UpdateStep, combine, defineHandlers, modelStep } from './step'

// COMMANDS

// NOTE: the build check reads `version.json` over the network, so it is a
// service a test fakes (`FetchBuild.toLayer(...)`).
export class FetchBuild extends Command.Service<FetchBuild>()(
  'app/FetchBuild',
  {
    args: {},
    success: VersionMessage,
    // NOTE: a slow check is dropped for the newer one.
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

// NOTE: the service worker only precaches for offline play, so a failure
// changes nothing on screen: it is logged and nothing is reported.
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

// VERSION

export const checkForUpdate: UpdateStep = $ =>
  isCheckingForUpdates(RUNNING_BUILD) ? $.run(FetchBuild.make()) : $.model

// NOTE: a newer build also asks the service worker to look for it, so the
// new build installs in the background before the player taps the chip.
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

// NOTE: the service worker registers once the splash is gone, so precaching
// the game for offline play never slows the game's own first load.
export const registerServiceWorkerAfterSplash =
  (runningBuild: string): UpdateStep =>
  $ =>
    isUsingServiceWorker(runningBuild)
      ? $.run(RegisterServiceWorker.make())
      : $.model

// NOTE: the build check, the update gift, and the service worker
// (src/platform/message.ts).
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

  FailedReloadPage: modelStep(rewrapUpdateGift),
})
