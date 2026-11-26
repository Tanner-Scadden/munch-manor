import { Effect, Option, Schema, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import { rumbleOf } from '../../input/rumble'
import { toBrowserError } from '../../shared/describeError'
import { focusOf } from '../../world/party/party'
import type { GameEvent } from '../../world/schema/worldSchema'
import type { Model } from '../model'
import type { UpdateStep } from './step'

const playRumble = ({
  index,
  strong,
  weak,
  durationMs,
}: Readonly<{
  index: number
  strong: number
  weak: number
  durationMs: number
}>) =>
  Effect.tryPromise({
    try: () => {
      const maybeActuator =
        navigator.getGamepads()[index]?.vibrationActuator ?? null
      return maybeActuator === null
        ? Promise.resolve()
        : maybeActuator
            .playEffect('dual-rumble', {
              duration: durationMs,
              strongMagnitude: strong,
              weakMagnitude: weak,
            })
            .then(() => undefined)
    },
    catch: toBrowserError,
  })

export const Rumble = Command.make(
  'Rumble',
  {
    args: {
      index: Schema.Finite,
      strong: Schema.Finite,
      weak: Schema.Finite,
      durationMs: Schema.Finite,
    },
  },
  args => pipe(playRumble(args), Effect.ignore, Effect.as(Component.noop)),
)

const rumblingPad = (model: Model): Option.Option<number> =>
  model.settings.rumbleSetting === 'On' && model.lastDevice === 'Gamepad'
    ? Option.map(model.input.maybeGamepad, pad => pad.index)
    : Option.none()

export const rumbleFor =
  (events: ReadonlyArray<GameEvent>): UpdateStep =>
  $ =>
    pipe(
      rumblingPad($.model),
      Option.flatMap(index =>
        Option.map(rumbleOf(focusOf($.model).player, events), cue =>
          Rumble.make({ index, ...cue }),
        ),
      ),
      Option.match({
        onNone: () => $.model,
        onSome: command => $.run(command),
      }),
    )
