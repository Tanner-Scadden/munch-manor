import { Effect, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { FullscreenSetting } from '../../platform/deviceSchema'
import { DeviceMessage } from '../../platform/message'
import { toBrowserError } from '../../shared/describeError'
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

// NOTE: a refusal leaves the setting as it was, so it is logged and nothing
// is reported.
export const SetFullscreen = Command.make(
  'SetFullscreen',
  { args: { fullscreen: FullscreenSetting } },
  ({ fullscreen }) =>
    pipe(
      fullscreen === 'On' ? enterFullscreen : exitFullscreen,
      Effect.as<DeviceMessage | Component.Noop>(
        DeviceMessage.CompletedSetFullscreen({ fullscreen }),
      ),
      Effect.catch(error =>
        Effect.as(
          Effect.logWarning('set full screen', error.reason),
          Component.noop,
        ),
      ),
    ),
)

// FULL SCREEN

export const toggleFullscreen: UpdateStep = $ =>
  $.run(
    SetFullscreen.make({
      fullscreen: $.model.settings.fullscreen === 'On' ? 'Off' : 'On',
    }),
  )

// NOTE: full screen, the screen's fit, and the rotation lock
// (src/platform/message.ts).
export const deviceHandlers = defineHandlers({
  ClickedFullscreenButton: toggleFullscreen,

  CompletedSetFullscreen: ($, { fullscreen }) =>
    $.evolve({ settings: UiStruct.evolve({ fullscreen }) }),

  ChangedFullscreen: ($, { fullscreen }) =>
    $.evolve({ settings: UiStruct.evolve({ fullscreen }) }),

  CompletedDetectScreenFit: ($, { screenFit }) =>
    $.evolve({ settings: UiStruct.evolve({ screenFit }) }),

  CompletedDetectOrientationLock: ($, { orientationLock }) =>
    $.evolve({ orientationLock }),
})
