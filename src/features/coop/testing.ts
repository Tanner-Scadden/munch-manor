import { Array, Effect, Function, Layer, Option, Ref, Stream } from 'effect'

import {
  type ClientFrame,
  type Lobby,
  type LobbyMember,
  NEUTRAL_INPUT,
  type RoomStatus,
  Session,
} from '@munch/netcode'

import {
  type CoopProblem,
  type LobbyChange,
  type RoomRequest,
  type RoomSession,
  type RoomTicket,
  type WorldState,
  coopWorld,
} from '../../domain/coopRoom'
import type { Calling } from '../../shared/playerData'
import {
  pastArrival,
  roomSettingsOf,
  roomWorldFor,
} from '../../world/net/roomWorld'
import { CoopNet } from './net'

// NOTE: co-op without a network, for tests and the audit harness. The fake
// answers each room request from `answer`, never streams anything, and
// records every Command's call, so a test can run a Command's Effect and
// read what it asked for.

export type FakeCall =
  | Readonly<{
      _tag: 'RequestRoom'
      request: RoomRequest
      name: string
      look: string
      rank: number
      calling: Calling
      introSeen: boolean
    }>
  | Readonly<{ _tag: 'AnswerOffer'; accept: boolean }>
  | Readonly<{ _tag: 'CancelQuickPlay' }>
  | Readonly<{ _tag: 'ChangeLobby'; change: LobbyChange }>
  | Readonly<{ _tag: 'SendToRoom'; frames: ReadonlyArray<ClientFrame> }>
  | Readonly<{ _tag: 'LeaveRoom' }>
  | Readonly<{ _tag: 'ResyncRoom' }>

export type FakeCoopNet = Readonly<{
  layer: Layer.Layer<CoopNet>
  calls: Effect.Effect<ReadonlyArray<FakeCall>>
}>

export const makeFakeCoopNet = (
  answer: (request: RoomRequest) => Effect.Effect<RoomTicket, CoopProblem>,
): Effect.Effect<FakeCoopNet> =>
  Effect.map(Ref.make<ReadonlyArray<FakeCall>>([]), calls => {
    const record = (call: FakeCall) => Ref.update(calls, Array.append(call))
    return {
      calls: Ref.get(calls),
      layer: Layer.succeed(
        CoopNet,
        CoopNet.of({
          requestRoom: (request, name, look, rank, calling, introSeen) =>
            Effect.andThen(
              record({
                _tag: 'RequestRoom',
                request,
                name,
                look,
                rank,
                calling,
                introSeen,
              }),
              answer(request),
            ),
          quickPlay: () => Stream.never,
          answerOffer: accept => record({ _tag: 'AnswerOffer', accept }),
          cancelQuickPlay: record({ _tag: 'CancelQuickPlay' }),
          lobby: () => Stream.never,
          changeLobby: change => record({ _tag: 'ChangeLobby', change }),
          room: () => Stream.never,
          sendToRoom: frames =>
            Effect.as(
              record({ _tag: 'SendToRoom', frames }),
              Array.map(frames, () => 8),
            ),
          leaveRoom: record({ _tag: 'LeaveRoom' }),
          resyncRoom: record({ _tag: 'ResyncRoom' }),
        }),
      ),
    }
  })

// NOTE: the harness's CoopNet: a staged screen stays as it was staged.
export const quietCoopNet: Layer.Layer<CoopNet> = Layer.succeed(
  CoopNet,
  CoopNet.of({
    requestRoom: () => Effect.never,
    quickPlay: () => Stream.never,
    answerOffer: () => Effect.void,
    cancelQuickPlay: Effect.void,
    lobby: () => Stream.never,
    changeLobby: () => Effect.void,
    room: () => Stream.never,
    sendToRoom: () => Effect.succeed([]),
    leaveRoom: Effect.void,
    resyncRoom: Effect.void,
  }),
)

// FIXTURES

export const CODE = 'MNCH7'

// NOTE: data first when the slot leads: a slot is a number, a name is not.
export const memberOf: {
  (
    name: string,
    ready?: boolean,
    look?: string,
    canNightmare?: boolean,
    rank?: number,
    calling?: string,
  ): (slot: number) => LobbyMember
  (
    slot: number,
    name: string,
    ready?: boolean,
    look?: string,
    canNightmare?: boolean,
    rank?: number,
    calling?: string,
  ): LobbyMember
} = Function.dual(
  (args: IArguments) => typeof args[0] === 'number',
  (
    slot: number,
    name: string,
    ready: boolean = false,
    look: string = '',
    canNightmare: boolean = false,
    rank: number = 1,
    calling: string = 'You',
  ): LobbyMember => ({
    playerId: `player-${slot}`,
    name,
    look,
    rank,
    calling,
    canNightmare,
    hasSeenIntro: true,
    slot,
    ready,
    pingMs: 0,
    joinedMs: slot,
  }),
)

// NOTE: data first when the members lead: they are an array, a status is not.
export const lobbyOf: {
  (
    status?: RoomStatus,
    host?: string,
  ): (members: ReadonlyArray<LobbyMember>) => Lobby
  (
    members: ReadonlyArray<LobbyMember>,
    status?: RoomStatus,
    host?: string,
  ): Lobby
} = Function.dual(
  (args: IArguments) => Array.isArray(args[0]),
  (
    members: ReadonlyArray<LobbyMember>,
    status: RoomStatus = 'Lobby',
    host: string = 'player-0',
  ): Lobby => ({
    code: CODE,
    host,
    status,
    visibility: 'Private',
    mode: 'Campaign',
    difficulty: 'Normal',
    modifiers: 0,
    easyBreakSeconds: 0,
    canKeepGoing: false,
    round: 1,
    createdMs: 0,
    updatedMs: 0,
    result: Option.none(),
    members,
  }),
)

const STAGED_TICKS = 50

// NOTE: a stand-in world a few seconds into a run, players spread out. The
// lobby's `members` give each seat its calling, as a room starts them.
type StagedMember = Readonly<{ slot: number; calling: string }>

export const stagedWorld: {
  (
    members: ReadonlyArray<StagedMember>,
  ): (slots: ReadonlyArray<number>) => WorldState
  (
    slots: ReadonlyArray<number>,
    members: ReadonlyArray<StagedMember>,
  ): WorldState
} = Function.dual(
  2,
  (
    slots: ReadonlyArray<number>,
    members: ReadonlyArray<StagedMember>,
  ): WorldState =>
    Array.reduce(
      Array.range(1, STAGED_TICKS),
      pastArrival(
        roomWorldFor(roomSettingsOf('Campaign', 'Normal', members)).start(
          slots,
          7,
        ),
      ),
      world =>
        coopWorld.step(
          world,
          Array.map(slots, slot => ({
            slot,
            input: {
              ...NEUTRAL_INPUT,
              moveX: slot % 2 === 0 ? 90 : -90,
              moveY: slot < 2 ? -60 : 60,
            },
            presence: 'Here' as const,
            viewLagTicks: 0,
            rttMs: 0,
          })),
        ),
    ),
)

export const playingSession: {
  (slot: number): (world: WorldState) => RoomSession
  (world: WorldState, slot: number): RoomSession
} = Function.dual(2, (world: WorldState, slot: number): RoomSession => ({
  ...Session.makeSession(0),
  phase: { _tag: 'Playing' },
  slot: Option.some(slot),
  frames: [{ tick: world.tick, world, atMs: 0 }],
}))
