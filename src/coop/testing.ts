import { Array, Effect, Layer, Option, Ref, Stream } from 'effect'

import {
  type ClientFrame,
  type Lobby,
  type LobbyMember,
  NEUTRAL_INPUT,
  type RoomStatus,
  Session,
} from '@munch/netcode'

import type { CoopProblem, LobbyChange, RoomRequest, RoomTicket } from './model'
import { CoopNet } from './net'
import { type RoomSession, type WorldState, coopWorld } from './seam'

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
          requestRoom: (request, name, look, rank) =>
            Effect.andThen(
              record({ _tag: 'RequestRoom', request, name, look, rank }),
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

export const memberOf = (
  slot: number,
  name: string,
  ready = false,
  look = '',
  canNightmare = false,
  rank = 1,
): LobbyMember => ({
  playerId: `player-${slot}`,
  name,
  look,
  rank,
  canNightmare,
  slot,
  ready,
  pingMs: 0,
  joinedMs: slot,
})

export const lobbyOf = (
  members: ReadonlyArray<LobbyMember>,
  status: RoomStatus = 'Lobby',
  host = 'player-0',
): Lobby => ({
  code: CODE,
  host,
  status,
  visibility: 'Private',
  mode: 'Campaign',
  difficulty: 'Normal',
  canKeepGoing: false,
  round: 1,
  createdMs: 0,
  updatedMs: 0,
  result: Option.none(),
  members,
})

const STAGED_TICKS = 50

// NOTE: a stand-in world a few seconds into a run, players spread out.
export const stagedWorld = (slots: ReadonlyArray<number>): WorldState =>
  Array.reduce(Array.range(1, STAGED_TICKS), coopWorld.start(slots, 7), world =>
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
  )

export const playingSession = (
  world: WorldState,
  slot: number,
): RoomSession => ({
  ...Session.makeSession(0),
  phase: { _tag: 'Playing' },
  slot: Option.some(slot),
  frames: [{ tick: world.tick, world, atMs: 0 }],
})
