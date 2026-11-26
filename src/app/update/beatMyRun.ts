import { Effect, Option } from 'effect'

import { Command, Component } from '@effect/ui'

import { addressWithoutDare, readBeatLink } from '../../domain/beatLink'
import { dismissDare, offerDare, takeDare } from '../../domain/beatMyRun'
import { isBeatCardShown } from '../../screens/home/beatCard'
import { stepWhen } from '../../shared/stepWhen'
import { isOnHomeMenu } from '../menuState'
import { Message } from '../message'
import type { Model } from '../model'
import { FocusHomeButton } from './home'
import { openLobby } from './lobby'
import { tapSound, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step'

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
