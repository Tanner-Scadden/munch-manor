import { Array, Effect, Layer, Match, Option, Result, Schema } from 'effect'
import { Dom, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  ClientFrame,
  type Lobby,
  Matchmaking,
  type PickedMode,
  type PlayerInput,
  type RoomDifficulty,
  ServerFrame,
  Session,
  normalizeRoomCode,
} from '@munch/netcode'
import { QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import { DIFFICULTY_ORDER } from '../difficulty'
import { eventsBetween } from '../roomWorld'
import { stepWhen } from '../stepWhen'
import { CoopComposition } from './composition'
import { makeCommand } from './definition'
import { Message, OutMessage } from './message'
import {
  type CoopProblem,
  LobbyChange,
  type Model,
  type Queue,
  type Room,
  RoomRequest,
  Screen,
  emptyQueue,
} from './model'
import { CoopNet } from './net'
import {
  CODE_INPUT_ID,
  DIFFICULTY_KEY,
  ENTER,
  ESCAPE,
  MODE_KEY,
  MODE_PICKS,
  QUICK_PLAY_BUTTON_ID,
  READY_BUTTON_ID,
  ROOM_CODE_LENGTH,
  ROOM_PARAM,
  canPickDifficulty,
  canPickMode,
  cleanCode,
  freshRoom,
  hub,
  isHost,
  isInLobby,
  isKickedFrom,
  isPicking,
  keepTracers,
  learnLobby,
  linkOf,
  maybeRoomOf,
  meIn,
  nextOf,
  pickedModeOf,
  pressAction,
  pressFor,
  shotsBetween,
  startOfEvents,
  withRoom,
  withScreen,
} from './roomState'
import { coopWorld } from './seam'

// COMMAND

export const FocusCoopElement = makeCommand('FocusCoopElement', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusCoopElement],
  handler: function* () {
    return ({ id }) =>
      Dom.focus(`#${id}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusCoopElement()),
      )
  },
})

export const RequestRoom = makeCommand('RequestRoom', {
  args: { request: RoomRequest, name: Schema.String, look: Schema.String },
  messages: [Message.SucceededRequestRoom, Message.FailedRequestRoom],
  handler: function* () {
    return ({ request, name, look }) =>
      CoopNet.use(net => net.requestRoom(request, name, look)).pipe(
        Effect.map(ticket => Message.SucceededRequestRoom(ticket)),
        Effect.catch(problem =>
          Effect.succeed(Message.FailedRequestRoom({ problem })),
        ),
      )
  },
})

export const AnswerOffer = makeCommand('AnswerOffer', {
  args: { accept: Schema.Boolean },
  messages: [Message.CompletedAnswerOffer],
  handler: function* () {
    return ({ accept }) =>
      CoopNet.use(net => net.answerOffer(accept)).pipe(
        Effect.as(Message.CompletedAnswerOffer()),
      )
  },
})

export const CancelQuickPlay = makeCommand('CancelQuickPlay', {
  messages: [Message.CompletedCancelQuickPlay],
  handler: function* () {
    return () =>
      CoopNet.use(net => net.cancelQuickPlay).pipe(
        Effect.as(Message.CompletedCancelQuickPlay()),
      )
  },
})

export const ChangeLobby = makeCommand('ChangeLobby', {
  args: { change: LobbyChange },
  messages: [Message.CompletedChangeLobby, Message.FailedChangeLobby],
  handler: function* () {
    return ({ change }) =>
      CoopNet.use(net => net.changeLobby(change)).pipe(
        Effect.as(Message.CompletedChangeLobby()),
        Effect.catch(problem =>
          Effect.succeed(Message.FailedChangeLobby({ problem })),
        ),
      )
  },
})

export const SendRoomFrames = makeCommand('SendRoomFrames', {
  args: { frames: Schema.Array(ClientFrame) },
  messages: [Message.CompletedSendRoomFrames],
  handler: function* () {
    return ({ frames }) =>
      CoopNet.use(net => net.sendToRoom(frames)).pipe(
        Effect.map(bytes => Message.CompletedSendRoomFrames({ bytes })),
      )
  },
})

export const LeaveRoom = makeCommand('LeaveRoom', {
  messages: [Message.CompletedLeaveRoom],
  handler: function* () {
    return () =>
      CoopNet.use(net => net.leaveRoom).pipe(
        Effect.as(Message.CompletedLeaveRoom()),
      )
  },
})

// NOTE: the session could not apply a message from the room, so it asks
// for a new socket, whose link brings a fresh Snapshot.
export const ResyncRoom = makeCommand('ResyncRoom', {
  messages: [Message.CompletedResyncRoom],
  handler: function* () {
    return () =>
      CoopNet.use(net => net.resyncRoom).pipe(
        Effect.as(Message.CompletedResyncRoom()),
      )
  },
})

// NOTE: the phone's own share sheet where there is one, else the link on the
// clipboard. Either way the button shows what happened with an icon.
export const ShareRoomLink = makeCommand('ShareRoomLink', {
  args: { code: Schema.String },
  messages: [Message.CompletedShareRoomLink],
  handler: function* () {
    return ({ code }) =>
      Effect.gen(function* () {
        const url = linkOf(code)
        if (typeof navigator.share === 'function') {
          yield* Effect.tryPromise(() =>
            navigator.share({ title: 'Munch Manor', url }),
          )
          return Message.CompletedShareRoomLink({ share: 'Shared' })
        }
        yield* Effect.tryPromise(() => navigator.clipboard.writeText(url))
        return Message.CompletedShareRoomLink({ share: 'Copied' })
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(Message.CompletedShareRoomLink({ share: 'Idle' })),
        ),
      )
  },
})

// NOTE: the room's code rides in the address, so a reload rejoins the same
// seat and the address bar is itself the invite.
export const RememberRoom = makeCommand('RememberRoom', {
  args: { maybeCode: Schema.Option(Schema.String) },
  messages: [Message.CompletedRememberRoom],
  handler: function* () {
    return ({ maybeCode }) =>
      Effect.sync(() => {
        const url = new URL(location.href)
        Option.match(maybeCode, {
          onNone: () => url.searchParams.delete(ROOM_PARAM),
          onSome: code => url.searchParams.set(ROOM_PARAM, code),
        })
        history.replaceState(history.state, '', url)
      }).pipe(Effect.ignore, Effect.as(Message.CompletedRememberRoom()))
  },
})

// HELPERS

// NOTE: the handlers co-op's Commands need; the CoopNet service they use
// is a requirement of their Layers, supplied by the application.
// NOTE: the handlers co-op's Commands need, read off the Layer that
// supplies them (CommandsLayer below), so a new Command joins both at once.
type CoopHandlers = Layer.Success<typeof CommandsLayer>

export type UpdateReturn = Update.ReturnWithOutMessage<
  Model,
  Message,
  OutMessage,
  CoopHandlers
>

const enterRoom = (model: Model, code: string, slot: number): UpdateReturn => ({
  model: withScreen(model, Screen.InRoom({ room: freshRoom(code, slot) })),
  commands: [
    RememberRoom({ maybeCode: Option.some(code) }),
    FocusCoopElement({ id: READY_BUTTON_ID }),
  ],
})

const ask = (model: Model, request: RoomRequest): UpdateReturn => ({
  model: withScreen(model, Screen.Asking({ request })),
  commands: [RequestRoom({ request, name: model.name, look: model.look })],
})

const leaveFor = (model: Model, problem: CoopProblem): UpdateReturn => ({
  model: hub(model, Option.some(problem)),
  commands: [RememberRoom({ maybeCode: Option.none() })],
})

const lobbyUpdated = (model: Model, room: Room, lobby: Lobby): UpdateReturn => {
  const learned = learnLobby(room, lobby)
  if (lobby.status === 'Closed') {
    return leaveFor(model, 'NoRoom')
  } else if (isKickedFrom(learned, lobby)) {
    return leaveFor(model, 'Kicked')
  } else {
    return { model: withRoom(model, learned) }
  }
}

// NOTE: a Kicked frame leaves and a version refusal asks for a newer build;
// every other frame, other refusals too, goes to the Session.
const receiveServerFrame = (
  model: Model,
  room: Room,
  frame: ServerFrame,
  bytes: number,
  atMs: number,
): UpdateReturn =>
  ServerFrame.matchOrElse(
    frame,
    {
      Kicked: () => leaveFor(model, 'Kicked'),
      Refused: refused =>
        refused.reason === 'VersionMismatch'
          ? {
              model: hub(model, Option.some('Outdated')),
              commands: [RememberRoom({ maybeCode: Option.none() })],
              outMessage: OutMessage.NeededNewerBuild(),
            }
          : receiveSessionFrame(model, room, refused, bytes, atMs),
    },
    other => receiveSessionFrame(model, room, other, bytes, atMs),
  )

const receiveSessionFrame = (
  model: Model,
  room: Room,
  frame: ServerFrame,
  bytes: number,
  atMs: number,
): UpdateReturn =>
  Result.match(Session.receive(coopWorld, room.session, frame, bytes, atMs), {
    onFailure: () => ({ model }),
    onSuccess: session => ({
      model: withRoom(model, { ...room, session, link: 'Online' }),
      commands:
        session.isResyncing && !room.session.isResyncing ? [ResyncRoom()] : [],
    }),
  })

const receiveFrame = (
  model: Model,
  room: Room,
  event: RoomEvent,
  atMs: number,
): UpdateReturn =>
  RoomEvent.match(event, {
    Received: ({ frame, bytes }) =>
      receiveServerFrame(model, room, frame, bytes, atMs),
    Connecting: () => ({
      model: withRoom(model, {
        ...room,
        session: Session.reconnecting(room.session, atMs),
        link: room.link === 'Online' ? 'Reconnecting' : room.link,
      }),
    }),
    Dropped: () => ({
      model: withRoom(model, { ...room, link: 'Reconnecting' }),
    }),
    Ponged: ponged => ({
      model: withRoom(model, {
        ...room,
        session: Session.heardPong(room.session, ponged.sentMs, ponged.atMs),
      }),
    }),
    Stopped: stopped =>
      stepWhen(
        (_: Model) => stopped.reason === 'Kicked',
        current => leaveFor(current, 'Kicked'),
      )(model),
  })

// NOTE: one frame of the room: the parent's controls go in as this frame's
// input with the held press, the session sends what it owes, and the World
// to draw and the events it reached come out. The parent reads `maybeWorld`
// and `frameEvents` after it (src/coopPlay.ts). While the parent holds its
// picture still for hit-stop, the events wait in the session for it.
export const tickRoom = (
  model: Model,
  controls: PlayerInput,
  nowMs: number,
  isPictureHeld = false,
): UpdateReturn =>
  inRoom(model, room => {
    const presses = pressFor(room.presses, room.session.inputTick)
    const ticked = Session.tickInput(
      coopWorld,
      room.session,
      { ...controls, action: presses.held },
      nowMs,
    )
    const rendered = Session.render(coopWorld, ticked.session, nowMs)
    const predictedShots = shotsBetween(
      room.session.predicted,
      ticked.session.predicted,
    )
    const reached = Math.max(
      0,
      Math.min(
        Math.floor(rendered.renderTick),
        Option.match(Array.last(rendered.session.frames), {
          onNone: () => 0,
          onSome: newest => newest.tick,
        }),
      ),
    )
    const from = startOfEvents(room, rendered.session.frames)
    const next = withRoom(model, {
      ...room,
      session: rendered.session,
      maybeWorld: Option.orElse(rendered.world, () => room.maybeWorld),
      frameEvents:
        reached > from && !isPictureHeld
          ? eventsBetween(rendered.session.frames, from, reached)
          : [],
      eventsTick: isPictureHeld ? from : Math.max(from, reached),
      predictedShots,
      presses,
    })
    return Array.isReadonlyArrayNonEmpty(ticked.outgoing)
      ? { model: next, commands: [SendRoomFrames({ frames: ticked.outgoing })] }
      : { model: next }
  })

const toggleReady = (model: Model, room: Room): UpdateReturn =>
  Option.match(meIn(room), {
    onNone: () => ({ model }),
    onSome: me =>
      Option.exists(room.maybeLobby, lobby => lobby.status === 'Lobby')
        ? {
            model,
            commands: [
              ChangeLobby({
                change: LobbyChange.ChangedReady({
                  ready: !me.ready,
                  pingMs: Math.round(room.session.rttMs),
                }),
              }),
            ],
          }
        : { model },
  })

const leave = (model: Model, room: Room): UpdateReturn =>
  room.departure === 'Leaving'
    ? { model }
    : {
        model: withRoom(model, { ...room, departure: 'Leaving' }),
        commands: [LeaveRoom()],
      }

const close = (model: Model): UpdateReturn => ({
  model: withScreen(model, Screen.Closed()),
  outMessage: OutMessage.ClosedCoop(),
})

const pick = (
  model: Model,
  room: Room,
  mode: PickedMode,
  difficulty: RoomDifficulty,
): UpdateReturn =>
  Option.match(room.maybeLobby, {
    onNone: () => ({ model }),
    onSome: lobby =>
      isPicking(room) &&
      canPickMode(lobby, mode) &&
      canPickDifficulty(lobby, difficulty) &&
      (mode !== pickedModeOf(lobby) || difficulty !== lobby.difficulty)
        ? {
            model,
            commands: [
              ChangeLobby({
                change: LobbyChange.ChangedPicks({ mode, difficulty }),
              }),
            ],
          }
        : { model },
  })

const pickFromKey = (model: Model, room: Room, code: string): UpdateReturn =>
  Option.match(room.maybeLobby, {
    onNone: () => ({ model }),
    onSome: lobby => {
      if (code === MODE_KEY) {
        return pick(
          model,
          room,
          nextOf(MODE_PICKS, pickedModeOf(lobby), mode =>
            canPickMode(lobby, mode),
          ),
          lobby.difficulty,
        )
      } else if (code === DIFFICULTY_KEY) {
        return pick(
          model,
          room,
          pickedModeOf(lobby),
          nextOf(DIFFICULTY_ORDER, lobby.difficulty, difficulty =>
            canPickDifficulty(lobby, difficulty),
          ),
        )
      } else {
        return { model }
      }
    },
  })

const keyOnScreen = (model: Model, code: string): UpdateReturn =>
  Screen.match<UpdateReturn>(model.screen, {
    Closed: () => ({ model }),
    Hub: () => {
      if (code === ESCAPE) {
        return close(model)
      } else if (code === ENTER) {
        return {
          model: withScreen(model, Screen.Queue({ queue: emptyQueue })),
        }
      } else {
        return { model }
      }
    },
    Code: () =>
      code === ESCAPE ? { model: hub(model, Option.none()) } : { model },
    Asking: () => ({ model }),
    Queue: ({ queue }) => {
      if (code === ESCAPE) {
        return {
          model: hub(model, Option.none()),
          commands: [CancelQuickPlay()],
        }
      } else if (code === ENTER && queue.offerPlayers > 0) {
        return answer(model, queue, true)
      } else {
        return { model }
      }
    },
    InRoom: ({ room }) => {
      if (!isInLobby(room)) {
        return { model }
      } else if (code === ENTER) {
        return toggleReady(model, room)
      } else {
        return pickFromKey(model, room, code)
      }
    },
  })

const answer = (model: Model, queue: Queue, accept: boolean): UpdateReturn => ({
  model: withScreen(
    model,
    Screen.Queue({
      queue: { ...queue, answer: accept ? 'Accepted' : 'Waiting' },
    }),
  ),
  commands: [AnswerOffer({ accept })],
})

const heardInQueue = (
  model: Model,
  queue: Queue,
  event: QuickPlayEvent,
): UpdateReturn =>
  QuickPlayEvent.match(event, {
    Dropped: () => ({ model: hub(model, Option.some('Dropped')) }),
    Connecting: () => ({ model }),
    Heard: ({ message }) =>
      Matchmaking.QuickServer.match(message, {
        Matched: matched => enterRoom(model, matched.code, matched.slot),
        Refused: () => ({ model: hub(model, Option.some('Busy')) }),
        Waiting: waiting => ({
          model: withScreen(
            model,
            Screen.Queue({
              queue: {
                names: waiting.names,
                waiting: waiting.waiting,
                position: waiting.position,
                groupSize: waiting.groupSize,
                offerPlayers: waiting.offerPlayers,
                accepted: waiting.accepted,
                answer: waiting.offerPlayers > 0 ? queue.answer : 'Unanswered',
              },
            }),
          ),
        }),
      }),
  })

// KEYS

// NOTE: the parent hands co-op every key while it is open, so the home
// menu's keys stay out of the way.
export const pressKey = (model: Model, code: string): UpdateReturn =>
  keyOnScreen(model, code)

const releaseKey = (model: Model, _code: string): UpdateReturn => ({
  model,
})

// OPEN

// NOTE: opening co-op lands on the hub, or straight in a room's join when a
// `?room=` link brought the player here.
export const open = (
  model: Model,
  name: string,
  maybeCode: Option.Option<string>,
  look = '',
): UpdateReturn => {
  const named = modifyFields(model, {
    name: () => name,
    look: () => look,
  })
  return Option.match(maybeCode, {
    onNone: () => ({
      model: hub(named, Option.none()),
      commands: [FocusCoopElement({ id: QUICK_PLAY_BUTTON_ID })],
    }),
    onSome: code => ask(named, RoomRequest.Join({ code })),
  })
}

export const isOpen = (model: Model): boolean =>
  !Screen.isAnyOf(['Closed'])(model.screen)

// UPDATE

const inRoom = (
  model: Model,
  toReturn: (room: Room) => UpdateReturn,
): UpdateReturn =>
  Option.match(maybeRoomOf(model), {
    onNone: () => ({ model }),
    onSome: toReturn,
  })

const inQueue = (
  model: Model,
  toReturn: (queue: Queue) => UpdateReturn,
): UpdateReturn =>
  Screen.matchOrElse(
    model.screen,
    { Queue: ({ queue }) => toReturn(queue) },
    () => ({ model }),
  )

const submitCode = (model: Model, typed: string): UpdateReturn =>
  Option.match(normalizeRoomCode(typed), {
    onNone: () => ({
      model: withScreen(
        model,
        Screen.Code({ typed, maybeProblem: Option.some('NotACode') }),
      ),
    }),
    onSome: code => ask(model, RoomRequest.Join({ code })),
  })

const failedRequest = (model: Model, problem: CoopProblem): UpdateReturn =>
  Screen.matchOrElse(
    model.screen,
    {
      Asking: ({ request }) =>
        RoomRequest.match<UpdateReturn>(request, {
          Create: () => ({ model: hub(model, Option.some(problem)) }),
          Join: ({ code }) => ({
            model: withScreen(
              model,
              Screen.Code({ typed: code, maybeProblem: Option.some(problem) }),
            ),
            commands: [RememberRoom({ maybeCode: Option.none() })],
          }),
        }),
    },
    () => ({ model }),
  )

const updateMessage = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedQuickPlayButton: () => ({
      model: withScreen(model, Screen.Queue({ queue: emptyQueue })),
    }),

    ClickedCodeButton: () => ({
      model: withScreen(
        model,
        Screen.Code({ typed: '', maybeProblem: Option.none() }),
      ),
      commands: [FocusCoopElement({ id: CODE_INPUT_ID })],
    }),

    ClickedCreateButton: () => ask(model, RoomRequest.Create()),

    ClickedBackButton: () => ({
      model: hub(model, Option.none()),
      commands: [FocusCoopElement({ id: QUICK_PLAY_BUTTON_ID })],
    }),

    ClickedCloseButton: () => close(model),

    UpdatedCode: ({ value }) => {
      const typed = cleanCode(value)
      return typed.length === ROOM_CODE_LENGTH
        ? submitCode(model, typed)
        : {
            model: withScreen(
              model,
              Screen.Code({ typed, maybeProblem: Option.none() }),
            ),
          }
    },

    SubmittedCode: () =>
      Screen.matchOrElse(
        model.screen,
        { Code: ({ typed }) => submitCode(model, typed) },
        () => ({ model }),
      ),

    SucceededRequestRoom: ({ code, slot }) =>
      Screen.matchOrElse(
        model.screen,
        { Asking: () => enterRoom(model, code, slot) },
        () => ({ model }),
      ),

    FailedRequestRoom: ({ problem }) => failedRequest(model, problem),

    ReceivedQuickPlayEvent: ({ event }) =>
      inQueue(model, queue => heardInQueue(model, queue, event)),

    ClickedAcceptOfferButton: () =>
      inQueue(model, queue => answer(model, queue, true)),

    ClickedKeepWaitingButton: () =>
      inQueue(model, queue => answer(model, queue, false)),

    ClickedCancelQueueButton: () => ({
      model: hub(model, Option.none()),
      commands: [CancelQuickPlay()],
    }),

    CompletedAnswerOffer: () => ({ model }),

    CompletedCancelQuickPlay: () => ({ model }),

    ReceivedLobbyEvent: ({ event }) =>
      inRoom(model, room =>
        Match.value(event).pipe(
          Match.tag('Updated', ({ lobby }) => lobbyUpdated(model, room, lobby)),
          Match.orElse(() => ({ model })),
        ),
      ),

    ReceivedRoomEvent: ({ event, atMs }) =>
      inRoom(model, room => receiveFrame(model, room, event, atMs)),

    CompletedSendRoomFrames: ({ bytes }) =>
      inRoom(model, room => ({
        model: withRoom(model, {
          ...room,
          session: Array.reduce(bytes, room.session, Session.countSent),
        }),
      })),

    ClickedReadyButton: () => inRoom(model, room => toggleReady(model, room)),

    ClickedKickButton: ({ playerId }) =>
      inRoom(model, room =>
        isHost(room)
          ? {
              model,
              commands: [
                ChangeLobby({ change: LobbyChange.KickedPlayer({ playerId }) }),
              ],
            }
          : { model },
      ),

    ClickedModePick: ({ mode }) =>
      inRoom(model, room =>
        Option.match(room.maybeLobby, {
          onNone: () => ({ model }),
          onSome: lobby => pick(model, room, mode, lobby.difficulty),
        }),
      ),

    ClickedDifficultyPick: ({ difficulty }) =>
      inRoom(model, room =>
        Option.match(room.maybeLobby, {
          onNone: () => ({ model }),
          onSome: lobby => pick(model, room, pickedModeOf(lobby), difficulty),
        }),
      ),

    CompletedChangeLobby: () => ({ model }),

    FailedChangeLobby: () => ({ model }),

    ClickedLeaveButton: () => inRoom(model, room => leave(model, room)),

    CompletedResyncRoom: () => ({ model }),

    CompletedLeaveRoom: () => ({
      model: hub(model, Option.none()),
      commands: [
        RememberRoom({ maybeCode: Option.none() }),
        FocusCoopElement({ id: QUICK_PLAY_BUTTON_ID }),
      ],
    }),

    ClickedShareButton: () =>
      inRoom(model, room => ({
        model,
        commands: [ShareRoomLink({ code: room.code })],
      })),

    CompletedShareRoomLink: ({ share }) =>
      inRoom(model, room => ({
        model: withRoom(model, { ...room, share }),
      })),

    CompletedRememberRoom: () => ({ model }),

    CompletedFocusCoopElement: () => ({ model }),

    RequestedOpen: ({ name, maybeCode, look }) =>
      open(model, name, maybeCode, look),

    RequestedPressKey: ({ code }) => pressKey(model, code),

    RequestedReleaseKey: ({ code }) => releaseKey(model, code),

    RequestedTickRoom: ({ controls, nowMs, isPictureHeld }) =>
      tickRoom(model, controls, nowMs, isPictureHeld),

    RequestedPressAction: ({ action }) => ({
      model: pressAction(model, action),
    }),

    RequestedKeepTracers: ({ tracers, fired, looked, confirmed }) => ({
      model: keepTracers(model, tracers, fired, looked, confirmed),
    }),
  })

// NOTE: a delivered Message that drops the room tells the parent, unless it
// already says something (NeededNewerBuild drops the room too).
const delivered = (model: Model, message: Message): UpdateReturn => {
  const result = updateMessage(model, message)
  return result.outMessage === undefined &&
    Option.isSome(maybeRoomOf(model)) &&
    Option.isNone(maybeRoomOf(result.model))
    ? { ...result, outMessage: OutMessage.LeftRoom() }
    : result
}

// NOTE: the parent's requests (the Block's operations) run as they are.
const requested = (model: Model, message: Message): UpdateReturn =>
  updateMessage(model, message)

export const update = CoopComposition.makeUpdate({
  ClickedQuickPlayButton: delivered,
  ClickedCodeButton: delivered,
  ClickedCreateButton: delivered,
  ClickedBackButton: delivered,
  ClickedCloseButton: delivered,
  UpdatedCode: delivered,
  SubmittedCode: delivered,
  SucceededRequestRoom: delivered,
  FailedRequestRoom: delivered,
  ReceivedQuickPlayEvent: delivered,
  ClickedAcceptOfferButton: delivered,
  ClickedKeepWaitingButton: delivered,
  ClickedCancelQueueButton: delivered,
  CompletedAnswerOffer: delivered,
  CompletedCancelQuickPlay: delivered,
  ReceivedLobbyEvent: delivered,
  ReceivedRoomEvent: delivered,
  CompletedSendRoomFrames: delivered,
  ClickedReadyButton: delivered,
  ClickedKickButton: delivered,
  ClickedModePick: delivered,
  ClickedDifficultyPick: delivered,
  CompletedChangeLobby: delivered,
  FailedChangeLobby: delivered,
  ClickedLeaveButton: delivered,
  CompletedLeaveRoom: delivered,
  CompletedResyncRoom: delivered,
  ClickedShareButton: delivered,
  CompletedShareRoomLink: delivered,
  CompletedRememberRoom: delivered,
  CompletedFocusCoopElement: delivered,
  RequestedOpen: requested,
  RequestedPressKey: requested,
  RequestedReleaseKey: requested,
  RequestedTickRoom: requested,
  RequestedPressAction: requested,
  RequestedKeepTracers: requested,
})

// HANDLERS

export const CommandsLayer = Layer.mergeAll(
  FocusCoopElement.layer,
  RequestRoom.layer,
  AnswerOffer.layer,
  CancelQuickPlay.layer,
  ChangeLobby.layer,
  SendRoomFrames.layer,
  LeaveRoom.layer,
  ShareRoomLink.layer,
  RememberRoom.layer,
  ResyncRoom.layer,
)
