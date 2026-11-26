import { Effect, Option } from 'effect'

import { Command, Component } from '@effect/ui'

import { isOnHomeMenu } from '#app/menuState.ts'
import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import { addressWithoutDare, readBeatLink } from '#domain/beatLink.ts'
import { dismissDare, offerDare, takeDare } from '#domain/beatMyRun.ts'
import { isBeatCardShown } from '#screens/home/beatCard.ts'
import { stepWhen } from '#shared/stepWhen.ts'

import { FocusHomeButton } from './home.ts'
import { openLobby } from './lobby.ts'
import { tapSound, unlockAudio } from './sound.ts'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step.ts'

export const ReadBeatLink = Command.make('ReadBeatLink', { args: {} }, () =>
  Effect.sync(() =>
    Message.CompletedReadBeatLink({
      maybeDare: readBeatLink(location.search),
    }),
  ),
)

export const askForBeatLink: UpdateStep = $ => $.run(ReadBeatLink.make())

export const ForgetBeatLink = Command.make('ForgetBeatLink', { args: {} }, () =>
  Effect.sync(() => {
    history.replaceState(history.state, '', addressWithoutDare(location.href))
  }).pipe(Effect.as(Component.noop)),
)

const isCardUp = (model: Model): boolean =>
  isBeatCardShown(model) && isOnHomeMenu(model)

const takeFromCard: UpdateStep = stepWhen(
  isCardUp,
  combine([modelStep(takeDare), openLobby]),
)

const dismissFromCard: UpdateStep = stepWhen(
  isCardUp,
  combine([
    unlockAudio,
    tapSound,
    modelStep(dismissDare),
    $ => $.run(FocusHomeButton.make({ button: 'Play' })),
  ]),
)

export const beatCardFromKey = (code: string): UpdateStep =>
  code === 'Escape' ? dismissFromCard : unchanged

export const beatMyRunHandlers = defineHandlers({
  CompletedReadBeatLink: ($, { maybeDare }) =>
    Option.match(maybeDare, {
      onNone: () => $.model,
      onSome: dare =>
        $.set(offerDare($.model, dare)).run(ForgetBeatLink.make()),
    }),

  ClickedBeatMyRunButton: takeFromCard,

  ClickedDismissBeatMyRunButton: dismissFromCard,
})
