import { Array, Effect, Match, Option, Result, Schema } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'
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

import {
  type CoopProblem,
  LobbyChange,
  type Queue,
  type Room,
  RoomRequest,
  Screen,
  coopWorld,
  isInLobby,
  maybeRoomOf,
  noPresses,
} from '../../domain/coopRoom'
import { toBrowserError } from '../../shared/describeError'
import { Calling, type SavedBoughtCosmetics } from '../../shared/playerData'
import { eventsBetween } from '../../world/net/roomWorld'
import { DIFFICULTY_ORDER } from '../../world/run/difficulty'
import { CoopMessage, CoopNotice } from './message'
import { type Model, emptyQueue } from './model'
import { CoopNet } from './net'
import {
  CALLING_KEY,
  DIFFICULTY_KEY,
  ENTER,
  ESCAPE,
  MODE_KEY,
  MODE_PICKS,
  ROOM_CODE_LENGTH,
  ROOM_PARAM,
  canPickDifficulty,
  canPickMode,
  cleanCode,
  freshRoom,
  hub,
  isHost,
  isKickedFrom,
  isPicking,
  learnLobby,
  linkOf,
  meIn,
  nextOf,
  pickedModeOf,
  pressFor,
  shotsBetween,
  startOfEvents,
  withRoom,
  withScreen,
} from './roomState'
import {
  ChangeLobby,
  type CoopResultOf,
  type LobbyCommand,
  buyHero,
  closePicker,
  closeStrayPicker,
  edits,
  focusCoop,
  lobbyMeOf,
  pickHero,
  togglePicker,
} from './steps'

// Co-op's rules, pure over its own Model (the root's `coop` field): each
// takes co-op's Model and returns a `CoopResult`, the next Model, the
// Commands to run, and a notice for the root. The root runs them as its own
// Steps (src/app/update/coop.ts, `coopHandlers`).

// COMMANDS

export class RequestRoom extends Command.Service<RequestRoom>()(
  'coop/RequestRoom',
  {
    args: {
      request: RoomRequest,
      name: Schema.String,
      look: Schema.String,
      rank: Schema.Finite,
      calling: Calling,
      introSeen: Schema.Boolean,
    },
    success: CoopMessage,
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return ({ request, name, look, rank, calling, introSeen }) =>
        net.requestRoom(request, name, look, rank, calling, introSeen).pipe(
          Effect.match({
            onSuccess: ({ code, slot }) =>
              CoopMessage.SucceededRequestRoom({ code, slot }),
            onFailure: problem => CoopMessage.FailedRequestRoom({ problem }),
          }),
        )
    }),
  )
}

export class AnswerOffer extends Command.Service<AnswerOffer>()(
  'coop/AnswerOffer',
  { args: { accept: Schema.Boolean }, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return ({ accept }) =>
        net.answerOffer(accept).pipe(Effect.as(Component.noop))
    }),
  )
}

export class CancelQuickPlay extends Command.Service<CancelQuickPlay>()(
  'coop/CancelQuickPlay',
  { args: {}, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return () => net.cancelQuickPlay.pipe(Effect.as(Component.noop))
    }),
  )
}

export class SendRoomFrames extends Command.Service<SendRoomFrames>()(
  'coop/SendRoomFrames',
  { args: { frames: Schema.Array(ClientFrame) }, success: CoopMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return ({ frames }) =>
        net
          .sendToRoom(frames)
          .pipe(
            Effect.map(bytes => CoopMessage.CompletedSendRoomFrames({ bytes })),
          )
    }),
  )
}

export class LeaveRoom extends Command.Service<LeaveRoom>()('coop/LeaveRoom', {
  args: {},
  success: CoopMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return () =>
        net.leaveRoom.pipe(Effect.as(CoopMessage.CompletedLeaveRoom()))
    }),
  )
}

// NOTE: the session could not apply a message from the room, so it asks
// for a new socket, whose link brings a fresh Snapshot.
export class ResyncRoom extends Command.Service<ResyncRoom>()(
  'coop/ResyncRoom',
  { args: {}, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return () => net.resyncRoom.pipe(Effect.as(Component.noop))
    }),
  )
}

// NOTE: the room link arrives as a dare (LORE.md, "PLAY is the dare"): the
// phone's own share sheet where there is one, else the line and the link on
// the clipboard. Either way the button shows what happened with an icon.
const DARE_LINE = 'I dare you.'

export const ShareRoomLink = Command.make(
  'ShareRoomLink',
  { args: { code: Schema.String } },
  ({ code }) =>
    Effect.gen(function* () {
      const url = linkOf(code)
      if (typeof navigator.share === 'function') {
        yield* Effect.tryPromise({
          try: () =>
            navigator.share({ title: 'Munch Manor', text: DARE_LINE, url }),
          catch: toBrowserError,
        })
        return CoopMessage.CompletedShareRoomLink({ share: 'Shared' })
      }
      yield* Effect.tryPromise({
        try: () => navigator.clipboard.writeText(`${DARE_LINE} ${url}`),
        catch: toBrowserError,
      })
      return CoopMessage.CompletedShareRoomLink({ share: 'Copied' })
    }).pipe(
      Effect.orElseSucceed(() =>
        CoopMessage.CompletedShareRoomLink({ share: 'Idle' }),
      ),
    ),
)

// NOTE: a tap on the lobby's room code puts the code on the clipboard, to
// paste in a chat. A browser with no clipboard (an insecure page) fails.
export const CopyRoomCode = Command.make(
  'CopyRoomCode',
  { args: { code: Schema.String } },
  ({ code }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(code),
      catch: toBrowserError,
    }).pipe(
      Effect.as(CoopMessage.CompletedCopyRoomCode({ copy: 'Copied' })),
      Effect.orElseSucceed(() =>
        CoopMessage.CompletedCopyRoomCode({ copy: 'Failed' }),
      ),
    ),
)

// NOTE: the room's code rides in the address, so a reload rejoins the same
// seat and the address bar is itself the invite.
export const RememberRoom = Command.make(
  'RememberRoom',
  { args: { maybeCode: Schema.Option(Schema.String) } },
  ({ maybeCode }) =>
    Effect.sync(() => {
      const url = new URL(location.href)
      Option.match(maybeCode, {
        onNone: () => url.searchParams.delete(ROOM_PARAM),
        onSome: code => url.searchParams.set(ROOM_PARAM, code),
      })
      history.replaceState(history.state, '', url)
    }).pipe(Effect.ignore, Effect.as(Component.noop)),
)

// RESULT

// NOTE: the Command services co-op's Commands need. Each `.layer` joins the
// root's CommandsLayer, which supplies CoopNet (src/app/services.ts).
type CoopServices =
  | RequestRoom
  | AnswerOffer
  | CancelQuickPlay
  | SendRoomFrames
  | LeaveRoom
  | ResyncRoom
  | ChangeLobby

export type CoopCommand =
  | LobbyCommand
  | Command.Command<CoopMessage | Component.Noop, CoopServices>

export type CoopResult = CoopResultOf<CoopCommand>

// NOTE: a rule's result with nothing to run or say.
const kept = (model: Model): CoopResult => ({ model })

const enterRoom = (model: Model, code: string, slot: number): CoopResult => ({
  model: withScreen(model, Screen.InRoom({ room: freshRoom(code, slot) })),
  commands: [
    RememberRoom.make({ maybeCode: Option.some(code) }),
    focusCoop('Ready'),
  ],
})

const ask = (model: Model, request: RoomRequest): CoopResult => ({
  model: withScreen(model, Screen.Asking({ request })),
  commands: [
    RequestRoom.make({
      request,
      name: model.name,
      look: model.look,
      rank: model.rank,
      calling: model.calling,
      introSeen: model.introSeen,
    }),
  ],
})

const leaveFor = (model: Model, problem: CoopProblem): CoopResult => ({
  model: hub(model, Option.some(problem)),
  commands: [RememberRoom.make({ maybeCode: Option.none() })],
})

const lobbyUpdated = (model: Model, room: Room, lobby: Lobby): CoopResult => {
  const learned = learnLobby(room, lobby)
  if (lobby.status === 'Closed') {
    return leaveFor(model, 'NoRoom')
  } else if (isKickedFrom(learned, lobby)) {
    return leaveFor(model, 'Kicked')
  } else {
    return {
      model: withRoom(model, {
        ...learned,
        maybeNameDraft:
          lobby.status === 'Lobby' ? learned.maybeNameDraft : Option.none(),
      }),
    }
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
): CoopResult =>
  ServerFrame.matchOrElse(
    frame,
    {
      Kicked: () => leaveFor(model, 'Kicked'),
      Welcome: welcome =>
        receiveSessionFrame(
          model,
          // NOTE: a Welcome at tick 0 is a new run in the same room. The
          // old run's presses count input ticks of the old session, so a
          // press queued behind its heldFrom would wait until the new run
          // outlasted the old (READY in the second run's break never went
          // out). The new run starts with none, as the room's own memory
          // of presses does.
          // The run's network numbers start then too.
          welcome.tick === 0
            ? {
                ...room,
                presses: noPresses,
                session: Session.startRunTally(room.session),
              }
            : room,
          frame,
          bytes,
          atMs,
        ),
      Refused: refused =>
        refused.reason === 'VersionMismatch'
          ? {
              model: hub(model, Option.some('Outdated')),
              commands: [RememberRoom.make({ maybeCode: Option.none() })],
              notice: CoopNotice.NeededNewerBuild(),
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
): CoopResult =>
  Result.match(Session.receive(coopWorld, room.session, frame, bytes, atMs), {
    onFailure: () => ({ model }),
    onSuccess: session => ({
      model: withRoom(model, {
        ...room,
        session,
        link: 'Online',
        droppedAtMs: Option.none(),
      }),
      commands:
        session.isResyncing && !room.session.isResyncing
          ? [ResyncRoom.make()]
          : [],
    }),
  })

const receiveFrame = (
  model: Model,
  room: Room,
  event: RoomEvent,
  atMs: number,
): CoopResult =>
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
      model: withRoom(model, {
        ...room,
        link: room.link === 'Lost' ? 'Lost' : 'Reconnecting',
      }),
    }),
    Ponged: ponged => ({
      model: withRoom(model, {
        ...room,
        session: Session.heardPong(room.session, ponged.sentMs, ponged.atMs),
      }),
    }),
    Stopped: ({ reason }) =>
      Match.value(reason).pipe(
        Match.when('Kicked', () => leaveFor(model, 'Kicked')),
        Match.orElse(() => kept(model)),
      ),
  })

// NOTE: the time a link went down is on the frame's clock, noted by the
// first frame that finds it down; a frame from the room clears it.
// A link down this long is Lost: the arena says so and offers the way
// out, while the tries go on. Past the room's rejoin window (the server
// frees an Away seat after 2 minutes, packages/netcode Room.ts) there is
// nothing to rejoin, so the room is left with a LOST message.
const LOST_AFTER_MS = 20_000
const GIVE_UP_AFTER_MS = 135_000

const downForMs = (room: Room, nowMs: number): number =>
  Option.match(room.droppedAtMs, {
    onNone: () => 0,
    onSome: droppedAtMs => nowMs - droppedAtMs,
  })

const isLost = (room: Room, nowMs: number): boolean =>
  room.link !== 'Online' && downForMs(room, nowMs) >= LOST_AFTER_MS

const hasGivenUp = (room: Room, nowMs: number): boolean =>
  room.link !== 'Online' && downForMs(room, nowMs) >= GIVE_UP_AFTER_MS

// NOTE: one frame of the room: the parent's controls go in as this frame's
// input with the held press, the session sends what it owes, and the World
// to draw and the events it reached come out. The parent reads `maybeWorld`
// and `frameEvents` after it (src/app/update/coopPlay.ts). While the parent holds its
// picture still for hit-stop, the events wait in the session for it.
// NOTE: this client's controls for one room frame, the time on the frame's
// clock, and whether the root holds its picture still for hit-stop.
export type RoomFrame = Readonly<{
  controls: PlayerInput
  nowMs: number
  isPictureHeld: boolean
}>

export const tickRoom =
  ({ controls, nowMs, isPictureHeld }: RoomFrame) =>
  (model: Model): CoopResult =>
    inRoom(model, room => {
      if (hasGivenUp(room, nowMs)) {
        return leaveFor(model, 'Dropped')
      }
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
        link: isLost(room, nowMs) ? 'Lost' : room.link,
        droppedAtMs:
          room.link === 'Online'
            ? Option.none()
            : Option.orElseSome(room.droppedAtMs, () => nowMs),
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
        ? {
            model: next,
            commands: [SendRoomFrames.make({ frames: ticked.outgoing })],
          }
        : { model: next }
    })

const toggleReady = (model: Model, room: Room): CoopResult =>
  Option.match(meIn(room), {
    onNone: () => ({ model }),
    onSome: me =>
      Option.exists(room.maybeLobby, lobby => lobby.status === 'Lobby')
        ? {
            model,
            commands: [
              ChangeLobby.make({
                change: LobbyChange.ChangedReady({
                  ready: !me.ready,
                  pingMs: Math.round(room.session.rttMs),
                }),
              }),
            ],
          }
        : { model },
  })

const leave = (model: Model, room: Room): CoopResult =>
  room.departure === 'Leaving'
    ? { model }
    : {
        model: withRoom(model, { ...room, departure: 'Leaving' }),
        commands: [LeaveRoom.make()],
      }

const close = (model: Model): CoopResult => ({
  model: withScreen(model, Screen.Closed()),
  notice: CoopNotice.ClosedCoop(),
})

const pick = (
  model: Model,
  room: Room,
  mode: PickedMode,
  difficulty: RoomDifficulty,
): CoopResult =>
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
              ChangeLobby.make({
                change: LobbyChange.ChangedPicks({ mode, difficulty }),
              }),
            ],
          }
        : { model },
  })

const pickFromKey = (model: Model, room: Room, code: string): CoopResult =>
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

const keyOnScreen = (model: Model, code: string): CoopResult =>
  Screen.match(model.screen, {
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
          commands: [CancelQuickPlay.make()],
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
      } else if (Option.isSome(room.maybeNameDraft)) {
        return code === ESCAPE ? edits.stopNaming(model, room) : kept(model)
      } else if (code === ENTER) {
        return toggleReady(model, room)
      } else {
        return pickFromKey(model, room, code)
      }
    },
  })

const answer = (model: Model, queue: Queue, accept: boolean): CoopResult => ({
  model: withScreen(
    model,
    Screen.Queue({
      queue: { ...queue, answer: accept ? 'Accepted' : 'Waiting' },
    }),
  ),
  commands: [AnswerOffer.make({ accept })],
})

const heardInQueue = (
  model: Model,
  queue: Queue,
  event: QuickPlayEvent,
): CoopResult =>
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
const pressKey =
  (code: string) =>
  (model: Model): CoopResult =>
    keyOnScreen(model, code)

// OPEN

// NOTE: opening co-op lands on the hub, or straight in a room's join when a
// `?room=` link brought the player here.
// NOTE: who joins from this device, handed by the root as co-op opens.
export type Joiner = Readonly<{
  name: string
  maybeCode: Option.Option<string>
  look: string
  rank: number
  calling: Calling
  bought: SavedBoughtCosmetics
  bones: number
  rngState: number
  introSeen: boolean
}>

export const open =
  (joiner: Joiner) =>
  (model: Model): CoopResult => {
    const named = UiStruct.evolve(model, {
      name: () => joiner.name,
      look: () => joiner.look,
      rank: () => joiner.rank,
      calling: () => joiner.calling,
      rngState: () => joiner.rngState,
      introSeen: () => joiner.introSeen,
      bought: () => joiner.bought,
      bones: () => joiner.bones,
    })
    return Option.match(joiner.maybeCode, {
      onNone: () => ({
        model: hub(named, Option.none()),
        commands: [focusCoop('QuickPlay')],
      }),
      onSome: code => ask(named, RoomRequest.Join({ code })),
    })
  }

export const isOpen = (model: Model): boolean =>
  !Screen.isAnyOf(['Closed'])(model.screen)

// UPDATE

const inRoom = (
  model: Model,
  toReturn: (room: Room) => CoopResult,
): CoopResult =>
  Option.match(maybeRoomOf(model), {
    onNone: () => ({ model }),
    onSome: toReturn,
  })

// NOTE: READY and LEAVE by button here, or by the root's end card
// (src/app/update/coop.ts, toggleCoopReady and leaveCoopRoom).
export const toggleReadyInRoom = (model: Model): CoopResult =>
  inRoom(model, room => toggleReady(model, room))

export const leaveRoom = (model: Model): CoopResult =>
  inRoom(model, room => leave(model, room))

const inQueue = (
  model: Model,
  toReturn: (queue: Queue) => CoopResult,
): CoopResult =>
  Screen.matchOrElse(
    model.screen,
    { Queue: ({ queue }) => toReturn(queue) },
    () => ({ model }),
  )

const submitCode = (model: Model, typed: string): CoopResult =>
  Option.match(normalizeRoomCode(typed), {
    onNone: () => ({
      model: withScreen(
        model,
        Screen.Code({ typed, maybeProblem: Option.some('NotACode') }),
      ),
    }),
    onSome: code => ask(model, RoomRequest.Join({ code })),
  })

const failedRequest = (model: Model, problem: CoopProblem): CoopResult =>
  Screen.matchOrElse(
    model.screen,
    {
      Asking: ({ request }) =>
        RoomRequest.match(request, {
          Create: () => ({ model: hub(model, Option.some(problem)) }),
          Join: ({ code }) => ({
            model: withScreen(
              model,
              Screen.Code({ typed: code, maybeProblem: Option.some(problem) }),
            ),
            commands: [RememberRoom.make({ maybeCode: Option.none() })],
          }),
        }),
    },
    () => ({ model }),
  )

// NOTE: the Messages co-op's rules handle, every one but the room's frame
// clock (the root's TickedRoomFrame, src/app/update/coop.ts).
const updateMessage = (model: Model, message: CoopMessage): CoopResult =>
  CoopMessage.match(message, {
    ClickedCoopQuickPlayButton: () => ({
      model: withScreen(model, Screen.Queue({ queue: emptyQueue })),
    }),

    ClickedCoopCodeButton: () => ({
      model: withScreen(
        model,
        Screen.Code({ typed: '', maybeProblem: Option.none() }),
      ),
      commands: [focusCoop('Code')],
    }),

    ClickedCoopCreateButton: () => ask(model, RoomRequest.Create()),

    ClickedCoopBackButton: () => ({
      model: hub(model, Option.none()),
      commands: [focusCoop('QuickPlay')],
    }),

    ClickedCoopCloseButton: () => close(model),

    UpdatedCoopCode: ({ value }) => {
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

    SubmittedCoopCode: () =>
      Screen.matchOrElse(
        model.screen,
        { Code: ({ typed }) => submitCode(model, typed) },
        () => kept(model),
      ),

    SucceededRequestRoom: ({ code, slot }) =>
      Screen.matchOrElse(
        model.screen,
        { Asking: () => enterRoom(model, code, slot) },
        () => kept(model),
      ),

    FailedRequestRoom: ({ problem }) => failedRequest(model, problem),

    ReceivedQuickPlayEvent: ({ event }) =>
      inQueue(model, queue => heardInQueue(model, queue, event)),

    ClickedCoopAcceptOfferButton: () =>
      inQueue(model, queue => answer(model, queue, true)),

    ClickedCoopKeepWaitingButton: () =>
      inQueue(model, queue => answer(model, queue, false)),

    ClickedCoopCancelQueueButton: () => ({
      model: hub(model, Option.none()),
      commands: [CancelQuickPlay.make()],
    }),

    ReceivedLobbyEvent: ({ event }) =>
      inRoom(model, room =>
        Match.value(event).pipe(
          Match.tag('Updated', ({ lobby }) => lobbyUpdated(model, room, lobby)),
          Match.orElse(() => kept(model)),
        ),
      ),

    ReceivedRoomEvent: ({ event, atMs }) =>
      inRoom(model, room => receiveFrame(model, room, event, atMs)),

    CompletedSendRoomFrames: ({ bytes }) =>
      inRoom(model, room => ({
        model: withRoom(model, {
          ...room,
          session: Array.reduce(bytes, room.session, (session, sent) =>
            Session.countSent(session, sent),
          ),
        }),
      })),

    ClickedCoopReadyButton: () => toggleReadyInRoom(model),

    ClickedCoopKickButton: ({ playerId }) =>
      inRoom(model, room =>
        isHost(room)
          ? {
              model,
              commands: [
                ChangeLobby.make({
                  change: LobbyChange.KickedPlayer({ playerId }),
                }),
              ],
            }
          : kept(model),
      ),

    ClickedCoopModePick: ({ mode }) =>
      inRoom(model, room =>
        Option.match(room.maybeLobby, {
          onNone: () => kept(model),
          onSome: lobby => pick(model, room, mode, lobby.difficulty),
        }),
      ),

    ClickedCoopDifficultyPick: ({ difficulty }) =>
      inRoom(model, room =>
        Option.match(room.maybeLobby, {
          onNone: () => kept(model),
          onSome: lobby => pick(model, room, pickedModeOf(lobby), difficulty),
        }),
      ),

    ClickedCoopModifierPick: ({ modifier }) =>
      inRoom(model, room => edits.pickModifier(model, room, modifier)),
    ClickedCoopEasyBreakPick: () =>
      inRoom(model, room => edits.pickEasyBreak(model, room)),
    ClickedCoopDareMarkPick: ({ mark }) =>
      inRoom(model, room => edits.pickDareMark(model, room, mark)),

    // NOTE: the pill opens the hero picker, and closes it again.
    ClickedCoopCallingPill: () => togglePicker(model),

    ClickedCoopPickNudge: ({ reason }) =>
      inRoom(model, room => edits.nudge(model, room, reason)),

    ClickedCoopNameButton: () =>
      inRoom(model, room => edits.startNaming(model, room)),

    UpdatedCoopNameDraft: ({ value }) =>
      inRoom(model, room => edits.typeName(model, room, value)),

    SubmittedCoopName: () => inRoom(model, room => edits.keepName(model, room)),

    ClickedCoopNameDice: () =>
      inRoom(model, room => edits.rollNameDraft(model, room)),

    ClickedCoopNameCancel: () =>
      inRoom(model, room => edits.stopNaming(model, room)),

    ClickedCoopLeaveButton: () => leaveRoom(model),

    CompletedLeaveRoom: () => ({
      model: hub(model, Option.none()),
      commands: [
        RememberRoom.make({ maybeCode: Option.none() }),
        focusCoop('QuickPlay'),
      ],
    }),

    ClickedCoopShareButton: () =>
      inRoom(model, room => ({
        model,
        commands: [ShareRoomLink.make({ code: room.code })],
      })),

    CompletedShareRoomLink: ({ share }) =>
      inRoom(model, room => ({
        model: withRoom(model, { ...room, share }),
      })),

    ClickedCoopRoomCode: () =>
      inRoom(model, room => ({
        model,
        commands: [CopyRoomCode.make({ code: room.code })],
      })),

    CompletedCopyRoomCode: ({ copy }) =>
      inRoom(model, room => ({
        model:
          copy === 'Copied'
            ? withRoom(model, { ...room, codeCopies: room.codeCopies + 1 })
            : model,
      })),

    // NOTE: the hero picker's events (src/features/heroes/block.ts): a card,
    // BUY, and its close button or keys.
    PickedCoopHero: ({ calling }) => pickHero(calling)(model),

    RequestedBuyCoopHero: ({ calling }) => buyHero(calling)(model),

    RequestedCloseCoopHeroPicker: () => closePicker(model),
  })

// NOTE: a rule that drops the room tells the root, unless it already says
// something (NeededNewerBuild drops the room too), and an open hero picker
// closes once the room leaves its lobby (closeStrayPicker).
const settled =
  (rule: (model: Model) => CoopResult) =>
  (model: Model): CoopResult => {
    const result = rule(model)
    const notice =
      result.notice === undefined &&
      Option.isSome(maybeRoomOf(model)) &&
      Option.isNone(maybeRoomOf(result.model))
        ? CoopNotice.LeftRoom()
        : result.notice
    return {
      model: closeStrayPicker(result.model),
      ...(result.commands === undefined ? {} : { commands: result.commands }),
      ...(notice === undefined ? {} : { notice }),
    }
  }

// NOTE: one of co-op's Messages, as the root's handler runs it.
export const updateCoop =
  (message: CoopMessage) =>
  (model: Model): CoopResult =>
    settled(current => updateMessage(current, message))(model)

// THE ROOT'S REQUESTS

// NOTE: what the rest of the root asks of co-op (src/app/update/coop.ts):
// a key, the room's frame, a press, the frame's tracers, READY, LEAVE, and
// a hero bought. A request runs as it is: one that drops the room says
// nothing more, as the root asked for it (only a Message's rule tells of a
// dropped room, `settled`), and an open hero picker closes once the room
// leaves its lobby.
export const asRequest =
  (rule: (model: Model) => CoopResult) =>
  (model: Model): CoopResult => {
    const result = rule(model)
    return { ...result, model: closeStrayPicker(result.model) }
  }

const isNaming = (model: Model): boolean =>
  Option.exists(maybeRoomOf(model), room => Option.isSome(room.maybeNameDraft))

// NOTE: in the room's lobby, with no name being typed, the hero picker takes
// the keys while it is open (its own Subscription closes it on Escape and
// Y, and the rest wait: Enter belongs to the card in focus), and Y opens it.
// Every other key is the screen's.
export const pressKeyWithPicker =
  (code: string) =>
  (model: Model): CoopResult => {
    const isPickingHero = Option.isSome(lobbyMeOf(model)) && !isNaming(model)
    if (isPickingHero && model.heroPick.isOpen) {
      return kept(model)
    } else if (isPickingHero && code === CALLING_KEY) {
      return togglePicker(model)
    } else {
      return pressKey(code)(model)
    }
  }
