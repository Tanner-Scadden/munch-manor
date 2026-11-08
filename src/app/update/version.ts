import { Effect, Function, Option, pipe } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  greetUpdate,
  newsFromGreeting,
  reloadOntoNewerBuild,
  rewrapUpdateGift,
  unwrapUpdateGift,
} from '../../features/home/update'
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
import { ApplicationBlock } from '../definition'
import { Message } from '../message'
import type { Model } from '../model'
import { tapSound, unlockAudio } from './sound'
import { type UpdateReturn, combine, defineHandlers } from './step'

// COMMAND

export const FetchBuild = ApplicationBlock.makeCommand('FetchBuild', {
  messages: [Message.CompletedFetchBuild, Message.FailedFetchBuild],
  handler: function* () {
    return () =>
      pipe(
        fetchRemoteBuild,
        Effect.map(build => Message.CompletedFetchBuild({ build })),
        Effect.catch(error =>
          Effect.succeed(Message.FailedFetchBuild({ reason: error.reason })),
        ),
      )
  },
})

export const RegisterServiceWorker = ApplicationBlock.makeCommand(
  'RegisterServiceWorker',
  {
    messages: [
      Message.CompletedRegisterServiceWorker,
      Message.FailedRegisterServiceWorker,
    ],
    handler: function* () {
      return () =>
        pipe(
          registerServiceWorker,
          Effect.as(Message.CompletedRegisterServiceWorker()),
          Effect.catch(error =>
            Effect.succeed(
              Message.FailedRegisterServiceWorker({ reason: error.reason }),
            ),
          ),
        )
    },
  },
)

export const UpdateServiceWorker = ApplicationBlock.makeCommand(
  'UpdateServiceWorker',
  {
    messages: [
      Message.CompletedUpdateServiceWorker,
      Message.FailedUpdateServiceWorker,
    ],
    handler: function* () {
      return () =>
        pipe(
          updateServiceWorker,
          Effect.as(Message.CompletedUpdateServiceWorker()),
          Effect.catch(error =>
            Effect.succeed(
              Message.FailedUpdateServiceWorker({ reason: error.reason }),
            ),
          ),
        )
    },
  },
)

// VERSION

export const checkForUpdate = (model: Model): UpdateReturn =>
  isCheckingForUpdates(RUNNING_BUILD)
    ? { model, commands: [FetchBuild()] }
    : { model }

// NOTE: a newer build also asks the service worker to look for it, so the
// new build installs in the background before the player taps the chip.
export const recordRemoteBuild: {
  (runningBuild: string, remoteBuild: string): (model: Model) => UpdateReturn
  (model: Model, runningBuild: string, remoteBuild: string): UpdateReturn
} = Function.dual(
  3,
  (model: Model, runningBuild: string, remoteBuild: string): UpdateReturn => {
    const maybeNewer = maybeNewerBuild(runningBuild, remoteBuild)
    const next = modifyFields(model, { maybeNewerBuild: () => maybeNewer })
    return Option.isSome(maybeNewer) && isUsingServiceWorker(runningBuild)
      ? { model: next, commands: [UpdateServiceWorker()] }
      : { model: next }
  },
)

// NOTE: the service worker registers once the splash is gone, so precaching
// the game for offline play never slows the game's own first load.
export const registerServiceWorkerAfterSplash: {
  (runningBuild: string): (model: Model) => UpdateReturn
  (model: Model, runningBuild: string): UpdateReturn
} = Function.dual(2, (model: Model, runningBuild: string): UpdateReturn =>
  isUsingServiceWorker(runningBuild)
    ? { model, commands: [RegisterServiceWorker()] }
    : { model },
)

// NOTE: the build check, the update gift, and the service worker
// (src/platform/message.ts).
export const versionHandlers = defineHandlers({
  TickedUpdateCheck: model => checkForUpdate(model),

  CompletedFetchBuild: (model, { build }) =>
    recordRemoteBuild(model, RUNNING_BUILD, build),

  FailedFetchBuild: model => ({ model }),

  ClickedUpdateButton: model => combine(model, [unlockAudio, unwrapUpdateGift]),

  CompletedWaitForUnwrap: model => reloadOntoNewerBuild(model),

  CompletedReadUpdateMarker: (model, { maybeBuild }) =>
    Update.combineSteps(model, [
      greetUpdate(isGreetingDue(RUNNING_BUILD, maybeBuild)),
    ]),

  ClickedUpdateGreetingNewsButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, newsFromGreeting]),

  CompletedReloadPage: model => ({ model }),

  FailedReloadPage: model => ({ model: rewrapUpdateGift(model) }),

  CompletedRegisterServiceWorker: model => ({ model }),

  FailedRegisterServiceWorker: model => ({ model }),

  CompletedUpdateServiceWorker: model => ({ model }),

  FailedUpdateServiceWorker: model => ({ model }),
})
