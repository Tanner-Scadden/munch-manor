import { Option, Schema, String, pipe } from 'effect'
import { Event, Machine, State } from 'effect-machine'

import { CODE_ALPHABET } from '@munch/netcode'

import { machineStepOf } from '#domain/machineStep.ts'

import { LinkProblem } from './playerSync.ts'

export const LinkFlow = State({
  Idle: {},
  Requesting: {},
  Showing: { code: Schema.String },
  Entering: { code: Schema.String },
  Redeeming: { code: Schema.String },
  Linked: {},
  Failed: { problem: LinkProblem },
})
export type LinkFlow = typeof LinkFlow.Type

export const LinkEvent = Event({
  AskedForCode: {},
  ChoseToEnterCode: {},
  TypedCode: { value: Schema.String },
  PastedCode: { text: Schema.String, typed: Schema.String },
  SubmittedCode: {},
  Cancelled: {},
  GotCode: { code: Schema.String },
  FailedToGetCode: { problem: LinkProblem },
  Redeemed: {},
  FailedToRedeem: { problem: LinkProblem },
})
export type LinkEvent = typeof LinkEvent.Type

const LINK_CODE_LENGTH = 6

const TYPED_CODE_MOST = 7

const LINK_CODE_PATTERN = new RegExp(
  `^[${CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`,
)

const normalizeCode = (input: string): Option.Option<string> =>
  Option.liftPredicate(
    pipe(input, String.toUpperCase, String.replaceAll(/[\s-]/g, '')),
    code => LINK_CODE_PATTERN.test(code),
  )

export const linkProblemText = (problem: LinkProblem): string => {
  if (problem === 'WrongCode') {
    return 'That code did not work. Check it and try again.'
  } else if (problem === 'TooManyTries') {
    return 'Too many tries. Wait a few minutes, then try again.'
  } else if (problem === 'Offline') {
    return 'Could not reach the server. Try again when you are online.'
  } else {
    return 'Linking is not available right now.'
  }
}

const IDLE_ENOUGH_TO_ASK = [
  LinkFlow.Idle,
  LinkFlow.Showing,
  LinkFlow.Entering,
  LinkFlow.Linked,
  LinkFlow.Failed,
]

export const linkMachine = Machine.make({
  state: LinkFlow,
  event: LinkEvent,
  initial: LinkFlow.Idle,
})
  .on(IDLE_ENOUGH_TO_ASK, LinkEvent.AskedForCode, () => LinkFlow.Requesting)
  .onAny(LinkEvent.ChoseToEnterCode, () => LinkFlow.Entering({ code: '' }))
  .on(
    [LinkFlow.Entering, LinkFlow.Failed],
    LinkEvent.TypedCode,
    function typeCode({ event }) {
      return LinkFlow.Entering({
        code: String.slice(0, TYPED_CODE_MOST)(String.toUpperCase(event.value)),
      })
    },
  )
  .when(
    LinkFlow.Entering,
    LinkEvent.PastedCode,
    function isPastedOverTyped({ state, event }) {
      return (
        state.code === event.typed && Option.isSome(normalizeCode(event.text))
      )
    },
    function pasteCode({ state, event }) {
      return LinkFlow.Entering({
        code: Option.getOrElse(normalizeCode(event.text), () => state.code),
      })
    },
  )
  .on(LinkFlow.Entering, LinkEvent.SubmittedCode, function redeem({ state }) {
    return LinkFlow.Redeeming({ code: state.code })
  })
  .onAny(LinkEvent.Cancelled, () => LinkFlow.Idle)
  .on(LinkFlow.Requesting, LinkEvent.GotCode, ({ event }) =>
    LinkFlow.Showing({ code: event.code }),
  )
  .on(LinkFlow.Requesting, LinkEvent.FailedToGetCode, ({ event }) =>
    LinkFlow.Failed({ problem: event.problem }),
  )
  .on(LinkFlow.Redeeming, LinkEvent.Redeemed, () => LinkFlow.Linked)
  .on(LinkFlow.Redeeming, LinkEvent.FailedToRedeem, ({ event }) =>
    LinkFlow.Failed({ problem: event.problem }),
  )

export const stepLink = machineStepOf(linkMachine)
