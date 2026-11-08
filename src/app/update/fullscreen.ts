import { Effect, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { FullscreenSetting } from '../../platform/deviceSchema'
import { toBrowserError } from '../../shared/describeError'
import { ApplicationBlock } from '../definition'
import { Message } from '../message'
import { type UpdateStep, defineHandlers } from './step'

// COMMAND

// NOTE: the rotation lock is ApplyRotation's, issued once full screen is on.
const enterFullscreen = Effect.tryPromise({
  try: () =>
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
  catch: toBrowserError,
})

const exitFullscreen = Effect.tryPromise({
  try: () =>
    document.fullscreenElement === null
      ? Promise.resolve()
      : document.exitFullscreen(),
  catch: toBrowserError,
})

export const SetFullscreen = ApplicationBlock.makeCommand('SetFullscreen', {
  args: { fullscreen: FullscreenSetting },
  messages: [Message.CompletedSetFullscreen, Message.FailedSetFullscreen],
  handler: function* () {
    return ({ fullscreen }) =>
      pipe(
        fullscreen === 'On' ? enterFullscreen : exitFullscreen,
        Effect.as(Message.CompletedSetFullscreen({ fullscreen })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSetFullscreen({ reason: String(error) }),
          ),
        ),
      )
  },
})

// FULL SCREEN

export const toggleFullscreen: UpdateStep = model => ({
  model,
  commands: [
    SetFullscreen({ fullscreen: model.fullscreen === 'On' ? 'Off' : 'On' }),
  ],
})

// NOTE: full screen, the screen's fit, and the rotation lock
// (src/platform/message.ts).
export const deviceHandlers = defineHandlers({
  ClickedFullscreenButton: model => toggleFullscreen(model),

  CompletedSetFullscreen: (model, { fullscreen }) => ({
    model: modifyFields(model, { fullscreen: () => fullscreen }),
  }),

  FailedSetFullscreen: model => ({ model }),

  ChangedFullscreen: (model, { fullscreen }) => ({
    model: modifyFields(model, { fullscreen: () => fullscreen }),
  }),

  CompletedDetectScreenFit: (model, { screenFit }) => ({
    model: modifyFields(model, { screenFit: () => screenFit }),
  }),

  CompletedDetectOrientationLock: (model, { orientationLock }) => ({
    model: modifyFields(model, { orientationLock: () => orientationLock }),
  }),

  CompletedApplyRotation: model => ({ model }),
})
