import { Effect, pipe } from 'effect'

import { ApplicationDefinition } from '../definition'
import { toBrowserError } from '../describeError'
import { Message } from '../message'
import { FullscreenSetting } from '../model'
import type { UpdateStep } from './step'

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

export const SetFullscreen = ApplicationDefinition.makeCommand(
  'SetFullscreen',
  {
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
  },
)

// FULL SCREEN

export const toggleFullscreen: UpdateStep = model => ({
  model,
  commands: [
    SetFullscreen({ fullscreen: model.fullscreen === 'On' ? 'Off' : 'On' }),
  ],
})
