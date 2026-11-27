import { Effect, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { type Model, RotationSetting } from '#app/model.ts'
import { toBrowserError } from '#shared/describeError.ts'

import type { UpdateStep } from './step.ts'

const lockLandscape = Effect.tryPromise({
  try: () => screen.orientation.lock('landscape'),
  catch: toBrowserError,
})

const unlockRotation = Effect.try({
  try: () => screen.orientation.unlock(),
  catch: toBrowserError,
})

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

export const toggleRotation = (model: Model): Model =>
  model.orientationLock === 'Supported'
    ? UiStruct.evolve(model, {
        settings: UiStruct.evolve({
          rotationSetting: setting =>
            setting === 'Landscape' ? 'Auto' : 'Landscape',
        }),
      })
    : model

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
