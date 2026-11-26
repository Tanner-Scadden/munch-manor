import { Option, Schema } from 'effect'
import { Event, Machine } from 'effect-machine'

import { CoopProblem, Queue, RoomRequest, Screen } from '#domain/coopRoom.ts'
import { machineStepOf } from '#domain/machines/machineStep.ts'
import { emptyQueue } from '#features/coop/model.ts'
import { freshRoom } from '#features/coop/roomState.ts'

export const ScreenEvent = Event({
  Opened: {},
  AskedForRoom: { request: RoomRequest },
  ChoseQuickPlay: {},
  ChoseCode: {},
  TypedCode: { typed: Schema.String },
  RefusedCode: { typed: Schema.String },
  WentBack: {},
  LeftQueue: {},
  ClosedCoop: {},
  GotRoom: { code: Schema.String, slot: Schema.Finite },
  Matched: { code: Schema.String, slot: Schema.Finite },
  FailedToGetRoom: { problem: CoopProblem },
  HeardQueue: { queue: Queue },
  LostQueue: { problem: CoopProblem },
  LeftRoom: { maybeProblem: Schema.Option(CoopProblem) },
})
export type ScreenEvent = typeof ScreenEvent.Type

const hubWith = (maybeProblem: Option.Option<CoopProblem>): Screen =>
  Screen.Hub({ maybeProblem })

export const screenMachine = Machine.make({
  state: Screen,
  event: ScreenEvent,
  initial: Screen.Closed,
})
  .on(Screen.Closed, ScreenEvent.Opened, () => hubWith(Option.none()))
  .on(
    [Screen.Closed, Screen.Hub, Screen.Code],
    ScreenEvent.AskedForRoom,
    ({ event }) => Screen.Asking({ request: event.request }),
  )
  .on(Screen.Hub, ScreenEvent.ChoseQuickPlay, () =>
    Screen.Queue({ queue: emptyQueue }),
  )
  .on(Screen.Hub, ScreenEvent.ChoseCode, () =>
    Screen.Code({ typed: '', maybeProblem: Option.none() }),
  )
  .on(Screen.Code, ScreenEvent.TypedCode, ({ event }) =>
    Screen.Code({ typed: event.typed, maybeProblem: Option.none() }),
  )
  .on(Screen.Code, ScreenEvent.RefusedCode, ({ event }) =>
    Screen.Code({ typed: event.typed, maybeProblem: Option.some('NotACode') }),
  )
  .on(Screen.Code, ScreenEvent.WentBack, () => hubWith(Option.none()))
  .on(Screen.Queue, ScreenEvent.LeftQueue, () => hubWith(Option.none()))
  .on([Screen.Hub, Screen.Code], ScreenEvent.ClosedCoop, () => Screen.Closed)
  .on(Screen.Asking, ScreenEvent.GotRoom, ({ event }) =>
    Screen.InRoom({ room: freshRoom(event.code, event.slot) }),
  )
  .on(Screen.Queue, ScreenEvent.Matched, ({ event }) =>
    Screen.InRoom({ room: freshRoom(event.code, event.slot) }),
  )
  .on(
    Screen.Asking,
    ScreenEvent.FailedToGetRoom,
    function backToWhereAsked({ state, event }) {
      return RoomRequest.match(state.request, {
        Create: () => hubWith(Option.some(event.problem)),
        Join: ({ code }) =>
          Screen.Code({
            typed: code,
            maybeProblem: Option.some(event.problem),
          }),
      })
    },
  )
  .on(Screen.Queue, ScreenEvent.HeardQueue, ({ event }) =>
    Screen.Queue({ queue: event.queue }),
  )
  .on(Screen.Queue, ScreenEvent.LostQueue, ({ event }) =>
    hubWith(Option.some(event.problem)),
  )
  .on(Screen.InRoom, ScreenEvent.LeftRoom, ({ event }) =>
    hubWith(event.maybeProblem),
  )

export const stepScreen = machineStepOf(screenMachine)
