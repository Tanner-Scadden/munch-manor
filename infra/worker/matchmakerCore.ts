import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as Semaphore from 'effect/Semaphore'

import { Matchmaking, type RoomRefusal, type RoomTicket } from '@munch/netcode'

export interface Made {
  readonly code: string
  readonly tickets: ReadonlyArray<{
    readonly socket: string
    readonly ticket: Result.Result<RoomTicket, RoomRefusal>
  }>
}

export interface MatchmakerIo {
  readonly load: Effect.Effect<Matchmaking.Matchmaker>
  readonly save: (matchmaker: Matchmaking.Matchmaker) => Effect.Effect<void>
  readonly send: (
    socket: string,
    message: Matchmaking.QuickServer,
  ) => Effect.Effect<void>
  readonly close: (socket: string) => Effect.Effect<void>
  readonly seat: (
    player: Matchmaking.Queued,
    code: string,
  ) => Effect.Effect<Result.Result<RoomTicket, RoomRefusal>>
  readonly makeRoom: (
    players: ReadonlyArray<Matchmaking.Queued>,
  ) => Effect.Effect<Result.Result<Made, RoomRefusal>>
  readonly wakeAt: (atMs: number) => Effect.Effect<void>
}

type Event = (
  matchmaker: Matchmaking.Matchmaker,
  nowMs: number,
) => Matchmaking.Stepped

export interface MatchmakerHost {
  readonly run: (event: Event) => Effect.Effect<void>
}

const matched = (io: MatchmakerIo, socket: string, ticket: RoomTicket) =>
  Effect.andThen(
    io.send(
      socket,
      Matchmaking.QuickServer.cases.Matched.make({
        code: ticket.code,
        slot: ticket.slot,
      }),
    ),
    io.close(socket),
  )

const refused = (io: MatchmakerIo, socket: string, refusal: RoomRefusal) =>
  Effect.andThen(
    io.send(
      socket,
      Matchmaking.QuickServer.cases.Refused.make({ reason: refusal._tag }),
    ),
    io.close(socket),
  )

const carryOut = (
  io: MatchmakerIo,
  stepped: Matchmaking.Stepped,
  nowMs: number,
): Effect.Effect<Matchmaking.Matchmaker> =>
  Effect.reduce(
    stepped.actions,
    () => stepped.matchmaker,
    (matchmaker, action) =>
      Match.valueTags(action, {
        Send: ({ socket, message }) =>
          Effect.as(io.send(socket, message), matchmaker),
        WakeAt: ({ atMs }) => Effect.as(io.wakeAt(atMs), matchmaker),
        Seat: ({ player, code }) =>
          seatPlayer(io, matchmaker, player, code, nowMs),
        MakeRoom: ({ players }) => makeRoomFor(io, matchmaker, players, nowMs),
      }),
  )

const seatPlayer = (
  io: MatchmakerIo,
  matchmaker: Matchmaking.Matchmaker,
  player: Matchmaking.Queued,
  code: string,
  nowMs: number,
): Effect.Effect<Matchmaking.Matchmaker> =>
  Effect.gen(function* () {
    const seated = yield* io.seat(player, code)
    if (Result.isSuccess(seated)) {
      yield* matched(io, player.socket, seated.success)
      return matchmaker
    }
    return yield* carryOut(
      io,
      Matchmaking.seatFailed(matchmaker, player, code, nowMs),
      nowMs,
    )
  })

const makeRoomFor = (
  io: MatchmakerIo,
  matchmaker: Matchmaking.Matchmaker,
  players: ReadonlyArray<Matchmaking.Queued>,
  nowMs: number,
): Effect.Effect<Matchmaking.Matchmaker> =>
  Effect.gen(function* () {
    const made = yield* io.makeRoom(players)
    if (Result.isFailure(made)) {
      yield* Effect.forEach(
        players,
        player => refused(io, player.socket, made.failure),
        { discard: true },
      )
      return matchmaker
    }
    yield* Effect.forEach(
      made.success.tickets,
      ({ socket, ticket }) =>
        Result.match(ticket, {
          onSuccess: held => matched(io, socket, held),
          onFailure: refusal => refused(io, socket, refusal),
        }),
      { discard: true },
    )
    const seatedCount = Array.filter(made.success.tickets, ({ ticket }) =>
      Result.isSuccess(ticket),
    ).length
    return yield* carryOut(
      io,
      Matchmaking.roomMade(matchmaker, made.success.code, seatedCount, nowMs),
      nowMs,
    )
  })

export const makeMatchmakerHost = (
  io: MatchmakerIo,
): Effect.Effect<MatchmakerHost> =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    const run = (event: Event) =>
      lock.withPermit(
        Effect.gen(function* () {
          const nowMs = yield* Clock.currentTimeMillis
          const before = yield* io.load
          const after = yield* carryOut(io, event(before, nowMs), nowMs)
          yield* io.save(after)
        }),
      )
    return { run }
  })
