// The co-op plumbing end to end, with real sockets: three players sign in
// with device keys, one creates a room and two join by code, they follow
// the lobby scope, the run starts when the last of them presses READY, all
// three play the stand-in world through the GameRoom, one drops and
// rejoins, and the host ends the run. Then four more press QUICK PLAY and
// the Matchmaker puts them in one public room. With no argument it runs the API Worker in a local workerd; with an
// origin it runs against that deploy (a preview's API Worker).
//   bun run heavy -- bun tools/mp-dev/e2e.ts
//   bun run heavy -- bun tools/mp-dev/e2e.ts https://munch-manor-api-pr-12.tanner-scadden.workers.dev
import {
  Array,
  Clock,
  Console,
  Data,
  type Duration,
  Effect,
  Exit,
  Match,
  Option,
  Ref,
  Result,
  Schedule,
  Scope,
  Stream,
} from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import {
  ChangedReady,
  EndedGame,
  type Lobby,
  MOVE_SCALE,
  NEUTRAL_INPUT,
  type PlayerInput,
  Session,
} from '@munch/netcode'
import {
  type LobbyClient,
  type RoomClient,
  connectRoom,
  createRoom,
  followLobby,
  joinRoom,
  roomSocketUrl,
  signInDevice,
  startQuickPlay,
} from '@munch/netcode/browser'
import { type Mutation, generateKey, makePlayerId } from '@munch/sync-engine'

import { playersOf } from '../../src/party'
import { type OwnSeat, ROOM_WORLD, type RoomWorld } from '../../src/roomWorld'
import { LOCAL_ORIGIN, startWorkerd } from './local'

class CheckFailed extends Data.TaggedError('CheckFailed')<{
  readonly check: string
}> {}

type Play = Session.Session<RoomWorld, OwnSeat>

interface RoomHandle {
  readonly client: RoomClient
  readonly scope: Scope.Closeable
}

interface Player {
  readonly name: string
  readonly playerId: string
  readonly token: string
  readonly lobby: Ref.Ref<Option.Option<Lobby>>
  readonly play: Ref.Ref<Play>
  readonly seen: Ref.Ref<ReadonlyArray<RoomWorld>>
  readonly room: Ref.Ref<Option.Option<RoomHandle>>
  lobbyClient: Option.Option<LobbyClient>
}

const origin = process.argv[2] ?? LOCAL_ORIGIN

const check = (name: string, holds: boolean) =>
  holds
    ? Console.log(`  ok  ${name}`)
    : Effect.fail(new CheckFailed({ check: name }))

// NOTE: polls until the condition holds, or fails the check after a while.
const eventually = (
  name: string,
  condition: Effect.Effect<boolean>,
  within: Duration.Input = '15 seconds',
) =>
  condition.pipe(
    Effect.filterOrFail(
      holds => holds,
      () => new CheckFailed({ check: name }),
    ),
    Effect.retry(Schedule.spaced('50 millis')),
    Effect.timeoutOrElse({
      duration: within,
      orElse: () => Effect.fail(new CheckFailed({ check: name })),
    }),
    Effect.andThen(Console.log(`  ok  ${name}`)),
  )

const signIn = (name: string) =>
  Effect.gen(function* () {
    const key = yield* generateKey
    const playerId = yield* makePlayerId
    const session = yield* signInDevice(origin, key, playerId)
    const nowMs = yield* Clock.currentTimeMillis
    const player: Player = {
      name,
      playerId: session.playerId,
      token: session.token,
      lobby: yield* Ref.make(Option.none<Lobby>()),
      play: yield* Ref.make(Session.makeSession<RoomWorld, OwnSeat>(nowMs)),
      seen: yield* Ref.make<ReadonlyArray<RoomWorld>>([]),
      room: yield* Ref.make(Option.none<RoomHandle>()),
      lobbyClient: Option.none(),
    }
    return player
  })

const follow = (player: Player, code: string) =>
  Effect.gen(function* () {
    const client = yield* followLobby({
      origin,
      code,
      clientId: `${player.name}-e2e`,
      token: Effect.succeed(player.token),
    })
    player.lobbyClient = Option.some(client)
    yield* Effect.forkScoped(
      Stream.runForEach(client.events, event =>
        Match.value(event).pipe(
          Match.tag('Updated', ({ lobby }) =>
            Ref.set(player.lobby, Option.some(lobby)),
          ),
          Match.tag('Rejected', ({ reason }) =>
            Console.log(`  ${player.name}: rejected ${reason}`),
          ),
          Match.orElse(() => Effect.void),
        ),
      ),
    )
  })

const writeAs = <A, I>(
  player: Player,
  mutation: Mutation<string, A, I>,
  args: NoInfer<A>,
) =>
  Option.match(player.lobbyClient, {
    onNone: () =>
      Effect.fail(
        new CheckFailed({ check: `${player.name} follows the lobby` }),
      ),
    onSome: client =>
      Effect.mapError(
        client.write(mutation, args),
        () =>
          new CheckFailed({ check: `${player.name} wrote ${mutation.name}` }),
      ),
  })

const joinGame = (player: Player, code: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const client = yield* Scope.provide(
      connectRoom({
        url: roomSocketUrl(origin, code),
        token: Effect.succeed(player.token),
      }),
      scope,
    )
    yield* Effect.forkIn(
      Stream.runForEach(client.events, event =>
        Effect.gen(function* () {
          const nowMs = yield* Clock.currentTimeMillis
          if (event._tag === 'Received') {
            const current = yield* Ref.get(player.play)
            const next = Session.receive(
              ROOM_WORLD,
              current,
              event.frame,
              event.bytes,
              event.atMs,
            )
            if (Result.isSuccess(next)) {
              yield* Ref.set(player.play, next.success)
            }
          }
          if (event._tag === 'Connecting') {
            yield* Ref.update(player.play, current =>
              Session.reconnecting(current, nowMs),
            )
          }
        }),
      ),
      scope,
    )
    yield* Ref.set(player.room, Option.some({ client, scope }))
  })

const dropGame = (player: Player) =>
  Effect.gen(function* () {
    const current = yield* Ref.get(player.room)
    yield* Ref.set(player.room, Option.none())
    yield* Option.match(current, {
      onNone: () => Effect.void,
      onSome: held => Scope.close(held.scope, Exit.void),
    })
  })

// NOTE: each player walks a square, turning every 0.8 s.
const walk = (index: number, nowMs: number): PlayerInput => {
  const legs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  const [x, y] = legs[Math.floor(nowMs / 800 + index) % 4] ?? [0, 0]
  return { ...NEUTRAL_INPUT, moveX: x * MOVE_SCALE, moveY: y * MOVE_SCALE }
}

const drive = (player: Player, index: number) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const current = yield* Ref.get(player.play)
    const ticked = Session.tickInput(
      ROOM_WORLD,
      current,
      walk(index, nowMs),
      nowMs,
    )
    const room = yield* Ref.get(player.room)
    const sent = yield* Option.match(room, {
      onNone: () => Effect.succeed([]),
      onSome: held => Effect.forEach(ticked.outgoing, held.client.send),
    })
    const counted = Array.reduce(
      Array.getSomes(sent),
      ticked.session,
      Session.countSent,
    )
    const rendered = Session.render(ROOM_WORLD, counted, nowMs)
    yield* Ref.set(player.play, rendered.session)
    yield* Option.match(rendered.world, {
      onNone: () => Effect.void,
      onSome: world =>
        Ref.update(player.seen, seen => Array.append(seen, world)),
    })
  }).pipe(Effect.repeat(Schedule.spaced('16 millis')))

const othersMoved = (player: Player, others: ReadonlyArray<number>) =>
  Effect.map(Ref.get(player.seen), seen =>
    Array.every(others, slot => {
      const xs = Array.flatMap(seen, world =>
        Array.filterMap(playersOf(world.world), seated =>
          seated.slot === slot
            ? Result.succeed(Math.round(seated.player.x))
            : Result.failVoid,
        ),
      )
      return new Set(xs).size > 15
    }),
  )

const slotOf = (player: Player) =>
  Effect.map(Ref.get(player.play), play =>
    Option.getOrElse(play.slot, () => -1),
  )

const report = (player: Player, seconds: number) =>
  Effect.gen(function* () {
    const play = yield* Ref.get(player.play)
    const stats = play.stats
    yield* Console.log(
      `  ${player.name}: slot ${Option.getOrElse(play.slot, () => -1)}, round trip ${Math.round(play.rttMs)} ms, down ${(stats.bytesIn / 1024 / seconds).toFixed(2)} KB/s over ${stats.framesIn} messages, up ${(stats.framesOut / seconds).toFixed(1)} messages/s (${stats.inputsOut} inputs), ${stats.corrections} corrections (max ${stats.maxCorrectionPx.toFixed(1)} px)`,
    )
  })

const program = Effect.gen(function* () {
  const workerd =
    origin === LOCAL_ORIGIN
      ? Option.some(yield* Effect.tap(
          Effect.andThen(
            Console.log('Starting the API Worker in workerd...'),
            startWorkerd,
          ),
          () => Effect.void,
        ))
      : Option.none()
  yield* Console.log(`Co-op end to end against ${origin}`)
  const [ana, bo, cy] = yield* Effect.all([
    signIn('ana'),
    signIn('bo'),
    signIn('cy'),
  ])
  const created = yield* createRoom(origin, ana.token, 'Ana')
  yield* Console.log(`  ok  ana created room ${created.code}`)
  const code = created.code
  const boTicket = yield* joinRoom(origin, bo.token, code, '  Bo\u0007  ')
  const cyTicket = yield* joinRoom(origin, cy.token, code.toLowerCase(), '')
  yield* check(
    'bo and cy joined in slots 1 and 2',
    boTicket.slot === 1 && cyTicket.slot === 2,
  )
  const players = [ana, bo, cy]
  yield* Effect.forEach(players, player => follow(player, code), {
    discard: true,
  })
  yield* eventually(
    'every lobby shows three members by their cleaned names',
    Effect.map(
      Effect.forEach(players, player => Ref.get(player.lobby)),
      lobbies =>
        Array.every(lobbies, lobby =>
          Option.exists(
            lobby,
            held =>
              held.members.map(member => member.name).join(',') ===
              'Ana,Bo,Player 3',
          ),
        ),
    ),
  )
  yield* Effect.forEach(players, player => joinGame(player, code), {
    discard: true,
  })
  yield* eventually(
    'every game socket waits in the lobby',
    Effect.map(
      Effect.forEach(players, player => Ref.get(player.play)),
      plays => Array.every(plays, play => play.phase._tag === 'Waiting'),
    ),
  )
  yield* writeAs(ana, ChangedReady, { by: ana.playerId, ready: true })
  yield* writeAs(bo, ChangedReady, { by: bo.playerId, ready: true })
  yield* eventually(
    'two of three READY is not a start',
    Effect.map(Ref.get(ana.lobby), lobby =>
      Option.exists(
        lobby,
        held =>
          held.status === 'Lobby' &&
          held.members.filter(member => member.ready).length === 2,
      ),
    ),
  )
  yield* writeAs(cy, ChangedReady, { by: cy.playerId, ready: true })
  yield* eventually(
    'the game starts for everyone',
    Effect.map(
      Effect.forEach(players, player => Ref.get(player.play)),
      plays =>
        Array.every(
          plays,
          play => play.phase._tag === 'Playing' && play.frames.length > 0,
        ),
    ),
  )
  const startedMs = yield* Clock.currentTimeMillis
  yield* Effect.forEach(
    players,
    (player, index) => Effect.forkScoped(drive(player, index)),
    {
      discard: true,
    },
  )
  const slots = yield* Effect.forEach(players, slotOf)
  yield* eventually(
    'each player sees the other two move',
    Effect.map(
      Effect.forEach(players, (player, index) =>
        othersMoved(
          player,
          Array.filter(slots, (_, other) => other !== index),
        ),
      ),
      Array.every(moved => moved),
    ),
  )
  yield* Effect.sleep('3 seconds')
  const seconds = ((yield* Clock.currentTimeMillis) - startedMs) / 1000
  yield* Console.log(`  after ${seconds.toFixed(1)} s of play:`)
  yield* Effect.forEach(players, player => report(player, seconds), {
    discard: true,
  })

  const boSlot = slots[1] ?? -1
  yield* dropGame(bo)
  yield* eventually(
    "bo's dropped socket shows bo Away to ana",
    Effect.map(Ref.get(ana.play), play => Array.contains(play.away, boSlot)),
    '5 seconds',
  )
  yield* joinGame(bo, code)
  yield* eventually(
    'bo rejoins from a snapshot and is back for ana',
    Effect.flatMap(Ref.get(bo.play), boPlay =>
      Effect.map(
        Ref.get(ana.play),
        anaPlay =>
          boPlay.phase._tag === 'Playing' &&
          boPlay.frames.length > 0 &&
          !Array.contains(anaPlay.away, boSlot),
      ),
    ),
  )
  // NOTE: a deploy of new Worker code restarts every Durable Object: the
  // sockets drop and the run's memory is lost. The room checkpoints the run,
  // so everyone reconnects by themselves, gets a Snapshot of the run a few
  // seconds back, and plays on.
  if (Option.isSome(workerd)) {
    yield* Effect.sleep('4 seconds')
    const newestTick = (player: Player) =>
      Effect.map(Ref.get(player.play), play =>
        Option.getOrElse(
          Option.map(Array.last(play.frames), frame => frame.tick),
          () => 0,
        ),
      )
    const before = yield* Effect.forEach(players, newestTick)
    yield* Console.log('  restarting workerd mid-run (a deploy)')
    yield* workerd.value.restart
    yield* eventually(
      'after a restart every player is back in the run',
      Effect.map(
        Effect.forEach(players, player =>
          Effect.zip(Ref.get(player.play), newestTick(player)),
        ),
        plays =>
          Array.every(
            plays,
            ([play, tick]) =>
              play.phase._tag === 'Playing' &&
              tick > 0 &&
              play.away.length === 0,
          ),
      ),
      '40 seconds',
    )
    yield* Effect.sleep('3 seconds')
    const after = yield* Effect.forEach(players, newestTick)
    yield* check(
      'the run keeps ticking after the restart',
      Array.every(after, (tick, index) => tick > (before[index] ?? 0)),
    )
  }
  yield* writeAs(ana, EndedGame, { by: ana.playerId })
  yield* eventually(
    'the host ends the game for everyone',
    Effect.map(
      Effect.forEach(players, player => Ref.get(player.play)),
      plays =>
        Array.every(
          plays,
          play =>
            play.phase._tag === 'Ended' && play.phase.reason === 'EndedByHost',
        ),
    ),
  )
  yield* eventually(
    'the lobby is back with the result and three scores',
    Effect.map(Ref.get(cy.lobby), lobby =>
      Option.exists(
        lobby,
        held =>
          held.status === 'Lobby' &&
          Option.exists(held.result, result => result.scores.length === 3),
      ),
    ),
  )

  const quickPlayers = yield* Effect.all([
    signIn('dee'),
    signIn('eve'),
    signIn('fin'),
    signIn('gus'),
  ])
  const quickCodes = yield* Ref.make<ReadonlyArray<string>>([])
  const waitingSeen = yield* Ref.make(0)
  yield* Effect.forEach(
    quickPlayers,
    player =>
      Effect.forkScoped(
        Effect.scoped(
          Effect.gen(function* () {
            const quick = yield* startQuickPlay({
              origin,
              name: player.name,
              token: Effect.succeed(player.token),
            })
            yield* Stream.runForEach(quick.events, event =>
              event._tag === 'Heard'
                ? Match.value(event.message).pipe(
                    Match.tag('Matched', ({ code: matchedCode }) =>
                      Ref.update(quickCodes, codes => [...codes, matchedCode]),
                    ),
                    Match.tag('Waiting', ({ waiting }) =>
                      Ref.update(waitingSeen, seen => Math.max(seen, waiting)),
                    ),
                    Match.orElse(() => Effect.void),
                  )
                : Effect.void,
            )
          }),
        ),
      ).pipe(Effect.andThen(Effect.sleep('150 millis'))),
    { discard: true },
  )
  yield* eventually(
    'four QUICK PLAY presses make one public room of four',
    Effect.map(
      Ref.get(quickCodes),
      codes => codes.length === 4 && new Set(codes).size === 1,
    ),
  )
  yield* check(
    'the queue screen counted up to three waiting',
    (yield* Ref.get(waitingSeen)) >= 3,
  )
  yield* Console.log('All co-op checks passed.')
})

// NOTE: sockets the browser client opened can keep Bun's loop alive after
// the scope closes, so a passing run exits on its own.
NodeRuntime.runMain(
  Effect.scoped(program).pipe(
    Effect.andThen(Effect.sync(() => process.exit(0))),
  ),
)
