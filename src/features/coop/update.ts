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
} from '#domain/coopRoom.ts'
import { toBrowserError } from '#shared/describeError.ts'
import { Calling, type SavedBoughtCosmetics } from '#shared/playerData.ts'
import { eventsBetween } from '#world/net/roomWorld.ts'
import { DIFFICULTY_ORDER } from '#world/run/difficulty.ts'

import { CoopMessage, CoopNotice } from './message.ts'
import { type Model } from './model.ts'
import { CoopNet } from './net.ts'
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
} from './roomState.ts'
import { ScreenEvent, stepScreen } from './screenFlow.ts'
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
} from './steps.ts'

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

const kept = (model: Model): CoopResult => ({ model })

const moveScreen = (
  model: Model,
  event: ScreenEvent,
  onMoved: (moved: Model) => CoopResult = kept,
): CoopResult => {
  const after = stepScreen(model.screen, event)
  return after === model.screen
    ? kept(model)
    : onMoved(withScreen(model, after))
}

const forgetRoom = () => RememberRoom.make({ maybeCode: Option.none() })

const roomEntered =
  (code: string) =>
  (moved: Model): CoopResult => ({
    model: moved,
    commands: [
      RememberRoom.make({ maybeCode: Option.some(code) }),
      focusCoop('Ready'),
    ],
  })

const ask = (model: Model, request: RoomRequest): CoopResult =>
  moveScreen(model, ScreenEvent.AskedForRoom({ request }), moved => ({
    model: moved,
    commands: [
      RequestRoom.make({
        request,
        name: moved.name,
        look: moved.look,
        rank: moved.rank,
        calling: moved.calling,
        introSeen: moved.introSeen,
      }),
    ],
  }))

const leaveFor = (model: Model, problem: CoopProblem): CoopResult =>
  moveScreen(
    model,
    ScreenEvent.LeftRoom({ maybeProblem: Option.some(problem) }),
    moved => ({ model: moved, commands: [forgetRoom()] }),
  )

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
          ? moveScreen(
              model,
              ScreenEvent.LeftRoom({ maybeProblem: Option.some('Outdated') }),
              moved => ({
                model: moved,
                commands: [forgetRoom()],
                notice: CoopNotice.NeededNewerBuild(),
              }),
            )
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

const close = (model: Model): CoopResult =>
  moveScreen(model, ScreenEvent.ClosedCoop, moved => ({
    model: moved,
    notice: CoopNotice.ClosedCoop(),
  }))

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
  Screen.$match(model.screen, {
    Closed: () => ({ model }),
    Hub: () => {
      if (code === ESCAPE) {
        return close(model)
      } else if (code === ENTER) {
        return moveScreen(model, ScreenEvent.ChoseQuickPlay)
      } else {
        return { model }
      }
    },
    Code: () =>
      code === ESCAPE ? moveScreen(model, ScreenEvent.WentBack) : { model },
    Asking: () => ({ model }),
    Queue: ({ queue }) => {
      if (code === ESCAPE) {
        return leaveQueue(model)
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

const leaveQueue = (model: Model): CoopResult =>
  moveScreen(model, ScreenEvent.LeftQueue, moved => ({
    model: moved,
    commands: [CancelQuickPlay.make()],
  }))

const answer = (model: Model, queue: Queue, accept: boolean): CoopResult =>
  moveScreen(
    model,
    ScreenEvent.HeardQueue({
      queue: { ...queue, answer: accept ? 'Accepted' : 'Waiting' },
    }),
    moved => ({ model: moved, commands: [AnswerOffer.make({ accept })] }),
  )

const heardInQueue = (
  model: Model,
  queue: Queue,
  event: QuickPlayEvent,
): CoopResult =>
  QuickPlayEvent.match(event, {
    Dropped: () =>
      moveScreen(model, ScreenEvent.LostQueue({ problem: 'Dropped' })),
    Connecting: () => ({ model }),
    Heard: ({ message }) =>
      Matchmaking.QuickServer.match(message, {
        Matched: matched =>
          moveScreen(
            model,
            ScreenEvent.Matched({ code: matched.code, slot: matched.slot }),
            roomEntered(matched.code),
          ),
        Refused: () =>
          moveScreen(model, ScreenEvent.LostQueue({ problem: 'Busy' })),
        Waiting: waiting =>
          moveScreen(
            model,
            ScreenEvent.HeardQueue({
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
  })

const pressKey =
  (code: string) =>
  (model: Model): CoopResult =>
    keyOnScreen(model, code)

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
      onNone: () =>
        moveScreen(named, ScreenEvent.Opened, moved => ({
          model: moved,
          commands: [focusCoop('QuickPlay')],
        })),
      onSome: code => ask(named, RoomRequest.Join({ code })),
    })
  }

export const isOpen = (model: Model): boolean =>
  !Screen.$is('Closed')(model.screen)

const inRoom = (
  model: Model,
  toReturn: (room: Room) => CoopResult,
): CoopResult =>
  Option.match(maybeRoomOf(model), {
    onNone: () => ({ model }),
    onSome: toReturn,
  })

export const toggleReadyInRoom = (model: Model): CoopResult =>
  inRoom(model, room => toggleReady(model, room))

export const leaveRoom = (model: Model): CoopResult =>
  inRoom(model, room => leave(model, room))

const inQueue = (
  model: Model,
  toReturn: (queue: Queue) => CoopResult,
): CoopResult =>
  Screen.$is('Queue')(model.screen) ? toReturn(model.screen.queue) : kept(model)

const submitCode = (model: Model, typed: string): CoopResult =>
  Option.match(normalizeRoomCode(typed), {
    onNone: () => moveScreen(model, ScreenEvent.RefusedCode({ typed })),
    onSome: code => ask(model, RoomRequest.Join({ code })),
  })

const failedRequest = (model: Model, problem: CoopProblem): CoopResult =>
  moveScreen(model, ScreenEvent.FailedToGetRoom({ problem }), moved =>
    Screen.$is('Code')(moved.screen)
      ? { model: moved, commands: [forgetRoom()] }
      : { model: moved },
  )

const updateMessage = (model: Model, message: CoopMessage): CoopResult =>
  CoopMessage.match(message, {
    ClickedCoopQuickPlayButton: () =>
      moveScreen(model, ScreenEvent.ChoseQuickPlay),

    ClickedCoopCodeButton: () =>
      moveScreen(model, ScreenEvent.ChoseCode, moved => ({
        model: moved,
        commands: [focusCoop('Code')],
      })),

    ClickedCoopCreateButton: () => ask(model, RoomRequest.Create()),

    ClickedCoopBackButton: () =>
      moveScreen(model, ScreenEvent.WentBack, moved => ({
        model: moved,
        commands: [focusCoop('QuickPlay')],
      })),

    ClickedCoopCloseButton: () => close(model),

    UpdatedCoopCode: ({ value }) => {
      const typed = cleanCode(value)
      return moveScreen(model, ScreenEvent.TypedCode({ typed }), moved =>
        typed.length === ROOM_CODE_LENGTH
          ? submitCode(moved, typed)
          : kept(moved),
      )
    },

    SubmittedCoopCode: () =>
      Screen.$is('Code')(model.screen)
        ? submitCode(model, model.screen.typed)
        : kept(model),

    SucceededRequestRoom: ({ code, slot }) =>
      moveScreen(model, ScreenEvent.GotRoom({ code, slot }), roomEntered(code)),

    FailedRequestRoom: ({ problem }) => failedRequest(model, problem),

    ReceivedQuickPlayEvent: ({ event }) =>
      inQueue(model, queue => heardInQueue(model, queue, event)),

    ClickedCoopAcceptOfferButton: () =>
      inQueue(model, queue => answer(model, queue, true)),

    ClickedCoopKeepWaitingButton: () =>
      inQueue(model, queue => answer(model, queue, false)),

    ClickedCoopCancelQueueButton: () => leaveQueue(model),

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

    CompletedLeaveRoom: () =>
      moveScreen(
        model,
        ScreenEvent.LeftRoom({ maybeProblem: Option.none() }),
        moved => ({
          model: moved,
          commands: [forgetRoom(), focusCoop('QuickPlay')],
        }),
      ),

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

    PickedCoopHero: ({ calling }) => pickHero(calling)(model),

    RequestedBuyCoopHero: ({ calling }) => buyHero(calling)(model),

    RequestedCloseCoopHeroPicker: () => closePicker(model),
  })

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

export const updateCoop =
  (message: CoopMessage) =>
  (model: Model): CoopResult =>
    settled(current => updateMessage(current, message))(model)

export const asRequest =
  (rule: (model: Model) => CoopResult) =>
  (model: Model): CoopResult => {
    const result = rule(model)
    return { ...result, model: closeStrayPicker(result.model) }
  }

const isNaming = (model: Model): boolean =>
  Option.exists(maybeRoomOf(model), room => Option.isSome(room.maybeNameDraft))

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
