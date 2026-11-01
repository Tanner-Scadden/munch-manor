import { Array, Effect, Option, Order, Schema, String, pipe } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type ApplyContext,
  CODE_ALPHABET,
  type DeviceActor,
  MutationRejected,
  type Row,
  defineMutation,
  defineScope,
  parseScopeId,
  scopeId,
} from '@munch/sync-engine'

import { ClosedReason } from './Protocol'

// NOTE: a co-op room's lobby and record, the `room:<code>` sync scope
// (MULTIPLAYER.md, "How it fits the sync engine"). Members read it and
// write their own READY; when everyone is READY the run starts, in the same
// mutation, and after a run everyone presses READY again to keep going
// (decision 12). The host, the room's creator, may kick and may end a run
// early. The room itself (the GameRoom Durable Object) creates it, seats
// joiners while it is in its lobby (no late join, decision 11), and
// records each run's result. A room is Private (joined by code or link) or
// Public (made by QUICK PLAY, which fills its free seats). The realtime
// game is not here: it is the binary channel in Protocol.ts, in the same
// Durable Object.
//
// Every mutation a player writes names the player it acts for in `by`, and
// `authorize` checks that is the sender, so the apply can check the rest
// (is `by` the host, is the room in the lobby) against the rows alone and
// replay the same on every side.

export const ROOM_SCOPE_KIND = 'room'
export const ROOM_CODE_LENGTH = 5
export const MAX_PLAYERS = 4

// CODES

// NOTE: five symbols from the pairing alphabet (no 0, O, 1, or I), about
// 33 million codes. A byte maps to a symbol with `& 31` without bias.
export const RoomCode = Schema.String.check(
  Schema.isPattern(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/),
)
export type RoomCode = typeof RoomCode.Type

const isRoomCode = Schema.is(RoomCode)

export const roomCodeFromBytes = (bytes: Uint8Array): string =>
  pipe(
    globalThis.Array.from(bytes),
    Array.take(ROOM_CODE_LENGTH),
    Array.map(byte => CODE_ALPHABET.charAt(byte & 31)),
    Array.join(''),
  )

export const makeRoomCode: Effect.Effect<string> = Effect.sync(() =>
  roomCodeFromBytes(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))),
)

// NOTE: what a player types or a link carries: any case, spaces and dashes
// ignored.
export const normalizeRoomCode = (input: string): Option.Option<RoomCode> => {
  const cleaned = pipe(
    input,
    String.toUpperCase,
    String.replaceAll(/[\s-]/g, ''),
  )
  return isRoomCode(cleaned) ? Option.some(cleaned) : Option.none()
}

export const roomScopeId = (code: string): string =>
  scopeId(ROOM_SCOPE_KIND, code)

export const roomCodeOfScope = (scope: string): Option.Option<RoomCode> =>
  pipe(
    parseScopeId(scope),
    Option.filter(address => address.kind === ROOM_SCOPE_KIND),
    Option.flatMap(address => normalizeRoomCode(address.key)),
    Option.filter(code => code === scope.slice(ROOM_SCOPE_KIND.length + 1)),
  )

// NAMES

// NOTE: a player's display name: up to 12 characters, not unique, shown in
// lobbies, the Quick Play queue, and above teammates. Whatever a client
// sends is cleaned the same way on every side: control characters out,
// spaces trimmed and collapsed, cut to 12 characters (code points, so an
// emoji is not split). An empty name becomes "Player N" by seat.
export const MAX_NAME_LENGTH = 12
export const MAX_NAME_INPUT = 64

const CONTROL =
  // NOTE: matching control characters is the point: they are cleaned out.
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g

export const defaultName = (slot: number): string => `Player ${slot + 1}`

export const cleanName = (raw: string): string =>
  globalThis.Array.from(raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trim()

export const displayName = (raw: string, slot: number): string => {
  const cleaned = cleanName(raw)
  return cleaned === '' ? defaultName(slot) : cleaned
}

export const NameInput = Schema.String.check(Schema.isMaxLength(MAX_NAME_INPUT))

// LOOKS

// NOTE: a player's look as the game writes it (src/playerData.ts,
// lookCodeOf): a few words joined by dots, such as
// `Female.Ponytail.Ginger.Tan.Teal`. The scope keeps it as text and knows
// nothing of what the words mean; anything else becomes '', which the game
// draws as the seat's own look. The Worker checks the words before it
// seats anyone.
export const MAX_LOOK_INPUT = 64
const LOOK_PATTERN = /^[A-Za-z]{1,12}(\.[A-Za-z]{1,12}){0,7}$/

export const LookInput = Schema.String.check(Schema.isMaxLength(MAX_LOOK_INPUT))

export const cleanLook = (raw: string): string =>
  raw.length <= MAX_LOOK_INPUT && LOOK_PATTERN.test(raw) ? raw : ''

// RANKS

// NOTE: a player's rank as the game works it out from their points
// (src/rank.ts): a whole number from 1. The scope keeps what the client
// says and cannot check it, so it clamps nonsense: a missing, fractional,
// or non-finite number reads as 1, and nothing goes above MAX_RANK_INPUT.
// It is for show beside a name: QUICK PLAY never groups by it.
export const MAX_RANK_INPUT = 999

export const RankInput = Schema.Number

export const cleanRank = (raw: number): number =>
  Number.isFinite(raw)
    ? Math.min(MAX_RANK_INPUT, Math.max(1, Math.floor(raw)))
    : 1

// ROWS

export const RoomStatus = Schema.Literals(['Lobby', 'Playing', 'Closed'])
export type RoomStatus = typeof RoomStatus.Type

export const RoomVisibility = Schema.Literals(['Private', 'Public'])
export type RoomVisibility = typeof RoomVisibility.Type

// NOTE: what the room plays next, picked by the host in the lobby: the
// campaign or endless, or KeepGoing, which carries a won campaign's run on
// into endless (GAME_DESIGN.md, "Keep going"). KeepGoing is offered only
// while the room keeps that run: from a won campaign until the crew
// changes. StandIn is the dev page's stand-in world. A new room plays a
// Normal campaign.
export const RoomMode = Schema.Literals([
  'StandIn',
  'Campaign',
  'Endless',
  'KeepGoing',
])
export type RoomMode = typeof RoomMode.Type

export const PickedMode = Schema.Literals(['Campaign', 'Endless', 'KeepGoing'])
export type PickedMode = typeof PickedMode.Type

export const RoomDifficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type RoomDifficulty = typeof RoomDifficulty.Type

export const DEFAULT_MODE: PickedMode = 'Campaign'
export const DEFAULT_DIFFICULTY: RoomDifficulty = 'Normal'

export const RoomScore = Schema.Struct({
  playerId: Schema.String,
  slot: Schema.Number,
  score: Schema.Number,
})
export type RoomScore = typeof RoomScore.Type

export const RoomResult = Schema.Struct({
  round: Schema.Number,
  reason: ClosedReason,
  ticks: Schema.Number,
  scores: Schema.Array(RoomScore),
})
export type RoomResult = typeof RoomResult.Type

const RoomResultJson = Schema.fromJsonString(RoomResult)

export const RoomRow = Schema.Struct({
  code: Schema.String,
  host: Schema.String,
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  difficulty: RoomDifficulty,
  kept: Schema.Number,
  round: Schema.Number,
  created_ms: Schema.Number,
  updated_ms: Schema.Number,
  result: Schema.NullOr(RoomResultJson),
})
export type RoomRow = typeof RoomRow.Type

export const MemberRow = Schema.Struct({
  player_id: Schema.String,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Number,
  nightmare: Schema.Number,
  slot: Schema.Number,
  ready: Schema.Number,
  ping_ms: Schema.Number,
  joined_ms: Schema.Number,
})
export type MemberRow = typeof MemberRow.Type

const decodeRoomRows = Schema.decodeUnknownEffect(Schema.Array(RoomRow))
const decodeMemberRows = Schema.decodeUnknownEffect(Schema.Array(MemberRow))
const encodeResult = Schema.encodeSync(RoomResultJson)

// LOBBY

// NOTE: `canNightmare` is whether the player had unlocked Nightmare when the
// room seated them, as the room read it from their own scope on the server.
export const LobbyMember = Schema.Struct({
  playerId: Schema.String,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Number,
  canNightmare: Schema.Boolean,
  slot: Schema.Number,
  ready: Schema.Boolean,
  // NOTE: the round trip the player last measured, sent with their READY
  // (so it costs no message of its own); 0 until then.
  pingMs: Schema.Number,
  joinedMs: Schema.Number,
})
export type LobbyMember = typeof LobbyMember.Type

export const Lobby = Schema.Struct({
  code: Schema.String,
  host: Schema.String,
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  difficulty: RoomDifficulty,
  canKeepGoing: Schema.Boolean,
  round: Schema.Number,
  createdMs: Schema.Number,
  updatedMs: Schema.Number,
  result: Schema.Option(RoomResult),
  members: Schema.Array(LobbyMember),
})
export type Lobby = typeof Lobby.Type

const bySlot = Order.mapInput(
  Order.Number,
  (member: LobbyMember) => member.slot,
)

export const lobbyOfRows = (
  room: RoomRow,
  members: ReadonlyArray<MemberRow>,
): Lobby => ({
  code: room.code,
  host: room.host,
  status: room.status,
  visibility: room.visibility,
  mode: room.mode,
  difficulty: room.difficulty,
  canKeepGoing: room.kept !== 0,
  round: room.round,
  createdMs: room.created_ms,
  updatedMs: room.updated_ms,
  result: Option.fromNullishOr(room.result),
  members: pipe(
    members,
    Array.map(member => ({
      playerId: member.player_id,
      name: member.name,
      look: member.look,
      rank: member.rank,
      canNightmare: member.nightmare !== 0,
      slot: member.slot,
      ready: member.ready !== 0,
      pingMs: member.ping_ms,
      joinedMs: member.joined_ms,
    })),
    Array.sort(bySlot),
  ),
})

const decodeSnapshotRoom = Schema.decodeUnknownOption(Schema.Array(RoomRow))
const decodeSnapshotMembers = Schema.decodeUnknownOption(
  Schema.Array(MemberRow),
)

// NOTE: the lobby from a scope Snapshot's tables, for a client that follows
// the scope without a local database (the dev page).
export const lobbyOfSnapshot = (
  tables: Readonly<Record<string, ReadonlyArray<Row>>>,
): Option.Option<Lobby> =>
  Option.flatMap(decodeSnapshotRoom(tables['room'] ?? []), rooms =>
    Option.flatMap(Array.head(rooms), room =>
      Option.map(decodeSnapshotMembers(tables['members'] ?? []), members =>
        lobbyOfRows(room, members),
      ),
    ),
  )

export const readLobby = (
  context: ApplyContext,
): Effect.Effect<
  Option.Option<Lobby>,
  SqlError.SqlError | MutationRejected,
  SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rooms = yield* rejectBadRows(
      decodeRoomRows(
        yield* sql`SELECT code, host, status, visibility, mode, difficulty, kept, round, created_ms, updated_ms, result
          FROM ${context.table('room')} WHERE id = 1`,
      ),
    )
    const members = yield* rejectBadRows(
      decodeMemberRows(
        yield* sql`SELECT player_id, name, look, rank, nightmare, slot, ready, ping_ms, joined_ms
          FROM ${context.table('members')}`,
      ),
    )
    return Option.map(Array.head(rooms), room => lobbyOfRows(room, members))
  })

const rejectBadRows = <A>(effect: Effect.Effect<A, Schema.SchemaError>) =>
  Effect.mapError(
    effect,
    error => new MutationRejected({ reason: error.message }),
  )

// RULES

export const freeSlot = (lobby: Lobby): Option.Option<number> =>
  Array.findFirst(
    Array.range(0, MAX_PLAYERS - 1),
    slot => !Array.some(lobby.members, member => member.slot === slot),
  )

export const isMember = (lobby: Lobby, playerId: string): boolean =>
  Array.some(lobby.members, member => member.playerId === playerId)

export const everyoneReady = (lobby: Lobby): boolean =>
  Array.isReadonlyArrayNonEmpty(lobby.members) &&
  Array.every(lobby.members, member => member.ready)

// NOTE: only a room in its lobby seats players: no late join.
export const canJoin = (lobby: Lobby): boolean =>
  lobby.status === 'Lobby' && lobby.members.length < MAX_PLAYERS

// NOTE: what a public room tells QUICK PLAY: open while it seats players.
export const isOpenToQuickPlay = (lobby: Lobby): boolean =>
  lobby.visibility === 'Public' && canJoin(lobby)

const reject = (reason: string) => Effect.fail(new MutationRejected({ reason }))

const requireLobby = (context: ApplyContext) =>
  Effect.flatMap(
    readLobby(context),
    Option.match({
      onNone: () => reject('No such room'),
      onSome: lobby => Effect.succeed(lobby),
    }),
  )

// NOTE: Nightmare is the host's to pick only when the room found it
// unlocked in their own scope.
export const canHostPickNightmare = (lobby: Lobby): boolean =>
  Array.some(
    lobby.members,
    member => member.playerId === lobby.host && member.canNightmare,
  )

const requireHost = (lobby: Lobby, by: string) =>
  lobby.host === by ? Effect.void : reject('Only the host may do that')

const requireMember = (lobby: Lobby, playerId: string) =>
  isMember(lobby, playerId) ? Effect.void : reject('Not in this room')

const touch = (
  context: ApplyContext,
  columns: Record<string, string | number>,
) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    sql =>
      sql`UPDATE ${context.table('room')}
      SET ${sql.update({ ...columns, updated_ms: context.timestampMs })}
      WHERE id = 1`,
  )

const isSender = (args: { readonly by: string }, actor: DeviceActor) =>
  args.by === actor.playerId

const ByArgs = Schema.Struct({ by: Schema.String })

const clearReady = (context: ApplyContext) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    sql => sql`UPDATE ${context.table('members')} SET ready = 0`,
  )

// NOTE: a kept run plays on only with the crew that won it, so a change of
// crew lets it go: a KeepGoing pick becomes Endless, and everyone READY
// says yes again to the new pick.
const forgetKept = (context: ApplyContext, lobby: Lobby) =>
  lobby.canKeepGoing
    ? Effect.andThen(
        lobby.mode === 'KeepGoing' ? clearReady(context) : Effect.void,
        touch(context, {
          kept: 0,
          mode: lobby.mode === 'KeepGoing' ? 'Endless' : lobby.mode,
        }),
      )
    : touch(context, {})

// NOTE: what a run's result leaves for the next one. A won campaign keeps
// its run and offers to keep going; any other end lets a kept run go.
const picksAfter = (
  lobby: Lobby,
  result: RoomResult,
): Record<string, string | number> =>
  result.reason === 'Won' && lobby.mode === 'Campaign'
    ? { kept: 1, mode: 'KeepGoing' }
    : { kept: 0, mode: lobby.mode === 'KeepGoing' ? 'Endless' : lobby.mode }

// MUTATIONS

export const CreatedRoom = defineMutation({
  name: 'CreatedRoom',
  version: 4,
  args: Schema.Struct({
    code: RoomCode,
    host: Schema.String,
    hostName: NameInput,
    hostLook: LookInput,
    hostRank: RankInput,
    hostNightmare: Schema.Boolean,
    mode: RoomMode,
    visibility: RoomVisibility,
  }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: (
    {
      code,
      host,
      hostName,
      hostLook,
      hostRank,
      hostNightmare,
      mode,
      visibility,
    },
    context,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (Option.isSome(yield* readLobby(context))) {
        return yield* reject('This room already exists')
      }
      yield* sql`INSERT INTO ${context.table('room')} ${sql.insert({
        id: 1,
        code,
        host,
        status: 'Lobby',
        visibility,
        mode,
        difficulty: DEFAULT_DIFFICULTY,
        kept: 0,
        round: 0,
        created_ms: context.timestampMs,
        updated_ms: context.timestampMs,
        result: null,
      })}`
      yield* sql`INSERT INTO ${context.table('members')} ${sql.insert({
        player_id: host,
        name: displayName(hostName, 0),
        look: cleanLook(hostLook),
        rank: cleanRank(hostRank),
        nightmare: hostNightmare ? 1 : 0,
        slot: 0,
        ready: 0,
        joined_ms: context.timestampMs,
      })}`
    }),
})

export const JoinedRoom = defineMutation({
  name: 'JoinedRoom',
  version: 4,
  args: Schema.Struct({
    playerId: Schema.String,
    name: NameInput,
    look: LookInput,
    rank: RankInput,
    nightmare: Schema.Boolean,
  }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ playerId, name, look, rank, nightmare }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      if (isMember(lobby, playerId)) {
        return yield* reject('Already in this room')
      }
      if (!canJoin(lobby)) {
        return yield* reject(
          lobby.members.length >= MAX_PLAYERS ? 'The room is full' : 'Started',
        )
      }
      const slot = yield* Option.match(freeSlot(lobby), {
        onNone: () => reject('The room is full'),
        onSome: free => Effect.succeed(free),
      })
      yield* sql`INSERT INTO ${context.table('members')} ${sql.insert({
        player_id: playerId,
        name: displayName(name, slot),
        look: cleanLook(look),
        rank: cleanRank(rank),
        nightmare: nightmare ? 1 : 0,
        slot,
        ready: 0,
        joined_ms: context.timestampMs,
      })}`
      yield* forgetKept(context, lobby)
    }),
})

export const ChangedReady = defineMutation({
  name: 'ChangedReady',
  version: 2,
  args: Schema.Struct({
    by: Schema.String,
    ready: Schema.Boolean,
    pingMs: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60_000 })),
    ),
  }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, ready, pingMs }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireMember(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      yield* sql`UPDATE ${context.table('members')}
        SET ready = ${ready ? 1 : 0}, ping_ms = ${pingMs ?? 0}
        WHERE player_id = ${by}`
      const after = Array.map(lobby.members, member =>
        member.playerId === by ? { ...member, ready } : member,
      )
      if (everyoneReady({ ...lobby, members: after })) {
        if (lobby.difficulty === 'Nightmare' && !canHostPickNightmare(lobby)) {
          return yield* reject('Nightmare is locked')
        }
        yield* sql`UPDATE ${context.table('members')} SET ready = 0`
        return yield* touch(context, {
          status: 'Playing',
          round: lobby.round + 1,
        })
      }
      return yield* touch(context, {})
    }),
})

// NOTE: the host picks what the room plays next while it is in its lobby.
// A change takes back everyone's READY, so nobody starts a run they did not
// say yes to; picking what is already picked changes nothing.
export const ChangedPicks = defineMutation({
  name: 'ChangedPicks',
  version: 1,
  args: Schema.Struct({
    by: Schema.String,
    mode: PickedMode,
    difficulty: RoomDifficulty,
  }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, mode, difficulty }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      if (mode === 'KeepGoing' && !lobby.canKeepGoing) {
        return yield* reject('No run to keep going')
      }
      if (difficulty === 'Nightmare' && !canHostPickNightmare(lobby)) {
        return yield* reject('Nightmare is locked')
      }
      if (mode === lobby.mode && difficulty === lobby.difficulty) {
        return
      }
      yield* clearReady(context)
      yield* touch(context, { mode, difficulty })
    }),
})

export const EndedGame = defineMutation({
  name: 'EndedGame',
  version: 1,
  args: ByArgs,
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      if (lobby.status !== 'Playing') {
        return yield* reject('No game is running')
      }
      yield* touch(context, {})
    }),
})

// NOTE: written by the room when a run ends, however it ended. The room is
// back in its lobby, where everyone presses READY to keep going.
export const RecordedRoomResult = defineMutation({
  name: 'RecordedRoomResult',
  version: 1,
  args: Schema.Struct({ result: RoomResult }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ result }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      if (lobby.status !== 'Playing') {
        return yield* reject('No game to record')
      }
      yield* touch(context, {
        status: 'Lobby',
        result: encodeResult(result),
        ...picksAfter(lobby, result),
      })
    }),
})

export const KickedPlayer = defineMutation({
  name: 'KickedPlayer',
  version: 1,
  args: Schema.Struct({ by: Schema.String, playerId: Schema.String }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, playerId }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      yield* requireMember(lobby, playerId)
      if (playerId === by) {
        return yield* reject('The host cannot kick themselves')
      }
      yield* sql`DELETE FROM ${context.table('members')} WHERE player_id = ${playerId}`
      yield* forgetKept(context, lobby)
    }),
})

// NOTE: a player leaving, or the room freeing a seat that was Away too
// long. A host who leaves hands the room to the lowest slot left; the last
// one out closes it.
export const LeftRoom = defineMutation({
  name: 'LeftRoom',
  version: 1,
  args: ByArgs,
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireMember(lobby, by)
      yield* sql`DELETE FROM ${context.table('members')} WHERE player_id = ${by}`
      const rest = Array.filter(lobby.members, member => member.playerId !== by)
      yield* Option.match(Array.head(rest), {
        onNone: () => touch(context, { status: 'Closed' }),
        onSome: next =>
          Effect.andThen(
            forgetKept(context, lobby),
            lobby.host === by ? handOver(context, lobby, next) : Effect.void,
          ),
      })
    }),
})

// NOTE: a new host who has not unlocked Nightmare cannot keep it picked:
// the room steps down to Hard, and everyone says READY again.
const handOver = (context: ApplyContext, lobby: Lobby, next: LobbyMember) =>
  lobby.difficulty === 'Nightmare' && !next.canNightmare
    ? Effect.andThen(
        clearReady(context),
        touch(context, { host: next.playerId, difficulty: 'Hard' }),
      )
    : touch(context, { host: next.playerId })

// SCOPE

export const RoomScope = defineScope({
  kind: ROOM_SCOPE_KIND,
  tables: ['room', 'members'],
  readers: 'Members',
  replica: 'ReadWrite',
  mutations: [
    CreatedRoom,
    JoinedRoom,
    ChangedReady,
    ChangedPicks,
    EndedGame,
    RecordedRoomResult,
    KickedPlayer,
    LeftRoom,
  ],
  migrations: {
    '0001_create': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('room'))} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          code TEXT NOT NULL,
          host TEXT NOT NULL,
          status TEXT NOT NULL,
          visibility TEXT NOT NULL,
          mode TEXT NOT NULL,
          round INTEGER NOT NULL,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL,
          result TEXT
        )`
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('members'))} (
          player_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slot INTEGER NOT NULL UNIQUE,
          ready INTEGER NOT NULL,
          joined_ms INTEGER NOT NULL
        )`
      }),
    '0002_picks': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('room'))}
          ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'Normal'`
        yield* sql`ALTER TABLE ${sql(table('room'))}
          ADD COLUMN kept INTEGER NOT NULL DEFAULT 0`
      }),
    '0003_looks': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('members'))}
          ADD COLUMN look TEXT NOT NULL DEFAULT ''`
      }),
    '0004_nightmare': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('members'))}
          ADD COLUMN nightmare INTEGER NOT NULL DEFAULT 0`
      }),
    '0005_ping': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('members'))}
          ADD COLUMN ping_ms INTEGER NOT NULL DEFAULT 0`
      }),
    '0006_ranks': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('members'))}
          ADD COLUMN rank INTEGER NOT NULL DEFAULT 1`
      }),
  },
})

// HTTP

// NOTE: the Worker's room routes. Create and join take the sync session
// token as a bearer; the socket's Hello carries it instead.
export const ROOM_PATHS = {
  create: '/room/create',
  join: '/room/join',
  socket: '/room/socket',
  quick: '/room/quick',
}

export const JoinRequest = Schema.Struct({
  code: Schema.String,
  name: NameInput,
  look: Schema.optionalKey(LookInput),
  rank: Schema.optionalKey(RankInput),
})

export const CreateRequest = Schema.Struct({
  name: NameInput,
  look: Schema.optionalKey(LookInput),
  rank: Schema.optionalKey(RankInput),
})
export type CreateRequest = typeof CreateRequest.Type
export type JoinRequest = typeof JoinRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Number })
export type RoomTicket = typeof RoomTicket.Type

export const RoomRefusal = Schema.TaggedUnion({
  NoRoom: {},
  Full: {},
  Started: {},
  Unauthorized: { reason: Schema.String },
  RateLimited: {},
  BadRequest: { reason: Schema.String },
  Unavailable: {},
})
export type RoomRefusal = typeof RoomRefusal.Type

export const roomRefusalStatus = (refusal: RoomRefusal): number =>
  RoomRefusal.match(refusal, {
    NoRoom: () => 404,
    Full: () => 409,
    Started: () => 409,
    Unauthorized: () => 401,
    RateLimited: () => 429,
    BadRequest: () => 400,
    Unavailable: () => 503,
  })
