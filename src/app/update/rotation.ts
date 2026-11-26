import { Effect, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { toBrowserError } from '../../shared/describeError'
import { type Model, RotationSetting } from '../model'
import type { UpdateStep } from './step'

// COMMAND

const lockLandscape = Effect.tryPromise({
  try: () => screen.orientation.lock('landscape'),
  catch: toBrowserError,
})

const unlockRotation = Effect.try({
  try: () => screen.orientation.unlock(),
  catch: toBrowserError,
})

// NOTE: Landscape locks the page sideways and Auto lets it follow the phone.
// A lock rejects in a plain browser tab, outside full screen, and wherever
// it is unsupported, and that refusal is ignored: the game plays on as the
// phone is held.
export const ApplyRotation = Command.make(
  'ApplyRotation',
  { args: { rotation: RotationSetting } },
  ({ rotation }) =>
    pipe(
      rotation === 'Landscape' ? lockLandscape : unlockRotation,
      Effect.ignore,
      Effect.as(Component.noop),
    ),
)

// ROTATION

export const toggleRotation = (model: Model): Model =>
  model.orientationLock === 'Supported'
    ? UiStruct.evolve(model, {
        settings: UiStruct.evolve({
          rotationSetting: setting =>
            setting === 'Landscape' ? 'Auto' : 'Landscape',
        }),
      })
    : model

// NOTE: a lock can be dropped by the browser, so the rotation is applied
// again whenever it could have been lost or changed: once the device is
// known to lock, once the save is read, when the setting changes, when full
// screen comes on, and when the page is shown again. Only where a lock is
// supported, so a desktop or an iPhone never tries.
const shouldApplyRotation = (before: Model, after: Model): boolean =>
  after.orientationLock === 'Supported' &&
  (before.orientationLock !== after.orientationLock ||
    (before.saving.saveStatus !== after.saving.saveStatus &&
      after.saving.saveStatus === 'Read') ||
    before.settings.rotationSetting !== after.settings.rotationSetting ||
    (before.settings.fullscreen !== after.settings.fullscreen &&
      after.settings.fullscreen === 'On') ||
    (before.pageVisibility !== after.pageVisibility &&
      after.pageVisibility === 'Visible'))

export const applyRotationFrom =
  (before: Model): UpdateStep =>
  $ =>
    shouldApplyRotation(before, $.model)
      ? $.run(
          ApplyRotation.make({ rotation: $.model.settings.rotationSetting }),
        )
      : $.model
