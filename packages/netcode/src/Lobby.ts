import {
  Array,
  Effect,
  Function,
  Option,
  Order,
  Schema,
  String,
  pipe,
} from 'effect'
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

export const ROOM_SCOPE_KIND = 'room'
export const ROOM_CODE_LENGTH = 5
export const MAX_PLAYERS = 4

export const RoomCode = Schema.String.check(
  Schema.isPattern(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/),
)
export type RoomCode = typeof RoomCode.Type

const isRoomCode = Schema.is(RoomCode)

export const roomCodeFromBytes = (bytes: Uint8Array): string =>
  pipe(
    globalThis.Array.from(bytes),
    Array.take(ROOM_CODE_LENGTH),
    Array.map(byte =>
      Option.getOrElse(String.charAt(CODE_ALPHABET, byte & 31), () => ''),
    ),
    Array.join(''),
  )

export const makeRoomCode: Effect.Effect<string> = Effect.sync(() =>
  roomCodeFromBytes(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))),
)

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
    Option.filter(
      code => code === String.slice(ROOM_SCOPE_KIND.length + 1)(scope),
    ),
  )

export const MAX_NAME_LENGTH = 12
export const MAX_NAME_INPUT = 64

const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export const defaultName = (slot: number): string => `Player ${slot + 1}`

export const cleanName = (raw: string): string =>
  String.trim(
    Array.join(
      globalThis.Array.from(
        String.trim(
          String.replace(/\s+/g, ' ')(String.replace(CONTROL, '')(raw)),
        ),
      ).slice(0, MAX_NAME_LENGTH),
      '',
    ),
  )

export const displayName: {
  (slot: number): (raw: string) => string
  (raw: string, slot: number): string
} = Function.dual(2, (raw: string, slot: number): string => {
  const cleaned = cleanName(raw)
  return cleaned === '' ? defaultName(slot) : cleaned
})

export const NameInput = Schema.String.check(Schema.isMaxLength(MAX_NAME_INPUT))

export const MAX_LOOK_INPUT = 64
const LOOK_PATTERN = /^[A-Za-z]{1,12}(\.[A-Za-z]{1,12}){0,8}$/

export const LookInput = Schema.String.check(Schema.isMaxLength(MAX_LOOK_INPUT))

export const cleanLook = (raw: string): string =>
  raw.length <= MAX_LOOK_INPUT && LOOK_PATTERN.test(raw) ? raw : ''

export const MAX_RANK_INPUT = 999

export const RankInput = Schema.Finite

export const cleanRank = (raw: number): number =>
  Number.isFinite(raw)
    ? Math.min(MAX_RANK_INPUT, Math.max(1, Math.floor(raw)))
    : 1

export const DEFAULT_CALLING = 'You'
export const MAX_CALLING_INPUT = 24
const CALLING_PATTERN = /^[A-Za-z]{1,24}$/

export const CallingInput = Schema.String.check(
  Schema.isMaxLength(MAX_CALLING_INPUT),
)

export const cleanCalling = (raw: string): string =>
  raw.length <= MAX_CALLING_INPUT && CALLING_PATTERN.test(raw)
    ? raw
    : DEFAULT_CALLING

export const RoomStatus = Schema.Literals(['Lobby', 'Playing', 'Closed'])
export type RoomStatus = typeof RoomStatus.Type

export const RoomVisibility = Schema.Literals(['Private', 'Public'])
export type RoomVisibility = typeof RoomVisibility.Type

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

export const MAX_MODIFIER_MASK = 15
export const ModifierMask = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_MODIFIER_MASK }),
)

export const EASY_BREAK_SECONDS = [0, 20, 30, 60] as const
export const EasyBreakSeconds = Schema.Literals(EASY_BREAK_SECONDS)

export const MAX_DARE_MARK = 8
export const DareMark = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_DARE_MARK }),
)

export const RoomScore = Schema.Struct({
  playerId: Schema.String,
  slot: Schema.Finite,
  score: Schema.Finite,
})
export type RoomScore = typeof RoomScore.Type

export const RoomResult = Schema.Struct({
  round: Schema.Finite,
  reason: ClosedReason,
  ticks: Schema.Finite,
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
  modifiers: Schema.Finite,
  easy_break_seconds: Schema.Finite,
  dare_mark: Schema.Finite,
  kept: Schema.Finite,
  round: Schema.Finite,
  created_ms: Schema.Finite,
  updated_ms: Schema.Finite,
  result: Schema.NullOr(RoomResultJson),
})
export type RoomRow = typeof RoomRow.Type

export const MemberRow = Schema.Struct({
  player_id: Schema.String,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Finite,
  calling: Schema.String,
  nightmare: Schema.Finite,
  intro: Schema.Finite,
  slot: Schema.Finite,
  ready: Schema.Finite,
  ping_ms: Schema.Finite,
  joined_ms: Schema.Finite,
})
export type MemberRow = typeof MemberRow.Type

const decodeRoomRows = Schema.decodeUnknownEffect(Schema.Array(RoomRow))
const decodeMemberRows = Schema.decodeUnknownEffect(Schema.Array(MemberRow))
const encodeResult = (result: RoomResult): Effect.Effect<string> =>
  Effect.orDie(Schema.encodeEffect(RoomResultJson)(result))

export const LobbyMember = Schema.Struct({
  playerId: Schema.String,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Finite,
  calling: Schema.String,
  canNightmare: Schema.Boolean,
  hasSeenIntro: Schema.Boolean,
  slot: Schema.Finite,
  ready: Schema.Boolean,
  pingMs: Schema.Finite,
  joinedMs: Schema.Finite,
})
export type LobbyMember = typeof LobbyMember.Type

export const Lobby = Schema.Struct({
  code: Schema.String,
  host: Schema.String,
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  difficulty: RoomDifficulty,
  modifiers: Schema.Finite,
  easyBreakSeconds: Schema.Finite,
  dareMark: Schema.Finite,
  canKeepGoing: Schema.Boolean,
  round: Schema.Finite,
  createdMs: Schema.Finite,
  updatedMs: Schema.Finite,
  result: Schema.Option(RoomResult),
  members: Schema.Array(LobbyMember),
})
export type Lobby = typeof Lobby.Type

const bySlot = Order.mapInput(
  Order.Number,
  (member: LobbyMember) => member.slot,
)

export const lobbyOfRows: {
  (members: ReadonlyArray<MemberRow>): (room: RoomRow) => Lobby
  (room: RoomRow, members: ReadonlyArray<MemberRow>): Lobby
} = Function.dual(
  2,
  (room: RoomRow, members: ReadonlyArray<MemberRow>): Lobby => ({
    code: room.code,
    host: room.host,
    status: room.status,
    visibility: room.visibility,
    mode: room.mode,
    difficulty: room.difficulty,
    modifiers: room.modifiers,
    easyBreakSeconds: room.easy_break_seconds,
    dareMark: room.dare_mark,
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
        calling: member.calling,
        canNightmare: member.nightmare !== 0,
        hasSeenIntro: member.intro !== 0,
        slot: member.slot,
        ready: member.ready !== 0,
        pingMs: member.ping_ms,
        joinedMs: member.joined_ms,
      })),
      Array.sort(bySlot),
    ),
  }),
)

const decodeSnapshotRoom = Schema.decodeUnknownOption(Schema.Array(RoomRow))
const decodeSnapshotMembers = Schema.decodeUnknownOption(
  Schema.Array(MemberRow),
)

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
    const value =
      yield* sql`SELECT code, host, status, visibility, mode, difficulty, modifiers, easy_break_seconds, dare_mark, kept, round, created_ms, updated_ms, result
          FROM ${context.table('room')} WHERE id = 1`
    const rooms = yield* rejectBadRows(decodeRoomRows(value))
    const value_1 =
      yield* sql`SELECT player_id, name, look, rank, calling, nightmare, intro, slot, ready, ping_ms, joined_ms
          FROM ${context.table('members')}`
    const members = yield* rejectBadRows(decodeMemberRows(value_1))
    return Option.map(Array.head(rooms), room => lobbyOfRows(room, members))
  })

const rejectBadRows = <A>(effect: Effect.Effect<A, Schema.SchemaError>) =>
  Effect.mapError(effect, error =>
    MutationRejected.make({ reason: error.message }),
  )

export const freeSlot = (lobby: Lobby): Option.Option<number> =>
  Array.findFirst(
    Array.range(0, MAX_PLAYERS - 1),
    slot => !Array.some(lobby.members, member => member.slot === slot),
  )

export const isMember: {
  (playerId: string): (lobby: Lobby) => boolean
  (lobby: Lobby, playerId: string): boolean
} = Function.dual(2, (lobby: Lobby, playerId: string): boolean =>
  Array.some(lobby.members, member => member.playerId === playerId),
)

export const everyoneReady = (lobby: Lobby): boolean =>
  Array.isReadonlyArrayNonEmpty(lobby.members) &&
  Array.every(lobby.members, member => member.ready)

export const canJoin = (lobby: Lobby): boolean =>
  lobby.status === 'Lobby' && lobby.members.length < MAX_PLAYERS

export const isOpenToQuickPlay = (lobby: Lobby): boolean =>
  lobby.visibility === 'Public' && canJoin(lobby)

const reject = (reason: string) =>
  Effect.fail(MutationRejected.make({ reason }))

const requireLobby = (context: ApplyContext) =>
  Effect.flatMap(
    readLobby(context),
    Option.match({
      onNone: () => reject('No such room'),
      onSome: lobby => Effect.succeed(lobby),
    }),
  )

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

const picksAfter = (lobby: Lobby): Record<string, string | number> => ({
  kept: 0,
  mode: lobby.mode === 'KeepGoing' ? 'Endless' : lobby.mode,
})

export const CreatedRoom = defineMutation({
  name: 'CreatedRoom',
  version: 6,
  args: Schema.Struct({
    code: RoomCode,
    host: Schema.String,
    hostName: NameInput,
    hostLook: LookInput,
    hostRank: RankInput,
    hostCalling: CallingInput,
    hostNightmare: Schema.Boolean,
    hostIntroSeen: Schema.Boolean,
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
      hostCalling,
      hostNightmare,
      hostIntroSeen,
      mode,
      visibility,
    },
    context,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const value_2 = yield* readLobby(context)
      if (Option.isSome(value_2)) {
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
        modifiers: 0,
        easy_break_seconds: 0,
        dare_mark: 0,
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
        calling: cleanCalling(hostCalling),
        nightmare: hostNightmare ? 1 : 0,
        intro: hostIntroSeen ? 1 : 0,
        slot: 0,
        ready: 0,
        joined_ms: context.timestampMs,
      })}`
    }),
})

export const JoinedRoom = defineMutation({
  name: 'JoinedRoom',
  version: 6,
  args: Schema.Struct({
    playerId: Schema.String,
    name: NameInput,
    look: LookInput,
    rank: RankInput,
    calling: CallingInput,
    nightmare: Schema.Boolean,
    introSeen: Schema.Boolean,
  }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: (
    { playerId, name, look, rank, calling, nightmare, introSeen },
    context,
  ) =>
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
        calling: cleanCalling(calling),
        nightmare: nightmare ? 1 : 0,
        intro: introSeen ? 1 : 0,
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
      yield* touch(
        context,
        difficulty === lobby.difficulty
          ? { mode, difficulty }
          : { mode, difficulty, dare_mark: 0 },
      )
    }),
})

export const ChangedModifiers = defineMutation({
  name: 'ChangedModifiers',
  version: 1,
  args: Schema.Struct({ by: Schema.String, modifiers: ModifierMask }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, modifiers }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      if (modifiers === lobby.modifiers) {
        return
      }
      yield* clearReady(context)
      yield* touch(context, { modifiers })
    }),
})

export const ChangedEasyBreak = defineMutation({
  name: 'ChangedEasyBreak',
  version: 1,
  args: Schema.Struct({ by: Schema.String, seconds: EasyBreakSeconds }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, seconds }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      if (seconds === lobby.easyBreakSeconds) {
        return
      }
      yield* clearReady(context)
      yield* touch(context, { easy_break_seconds: seconds })
    }),
})

export const ChangedDareMark = defineMutation({
  name: 'ChangedDareMark',
  version: 1,
  args: Schema.Struct({ by: Schema.String, mark: DareMark }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, mark }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      if (mark === lobby.dareMark) {
        return
      }
      yield* clearReady(context)
      yield* touch(context, { dare_mark: mark })
    }),
})

export const ChangedMemberCalling = defineMutation({
  name: 'ChangedMemberCalling',
  version: 1,
  args: Schema.Struct({ by: Schema.String, calling: CallingInput }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, calling }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireMember(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      const cleaned = cleanCalling(calling)
      if (
        Array.some(
          lobby.members,
          member => member.playerId === by && member.calling === cleaned,
        )
      ) {
        return
      }
      yield* sql`UPDATE ${context.table('members')}
        SET calling = ${cleaned}
        WHERE player_id = ${by}`
      yield* touch(context, {})
    }),
})

export const ChangedMemberName = defineMutation({
  name: 'ChangedMemberName',
  version: 1,
  args: Schema.Struct({ by: Schema.String, name: NameInput }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, name }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireMember(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      const me = Array.findFirst(
        lobby.members,
        member => member.playerId === by,
      )
      const cleaned = displayName(
        name,
        Option.match(me, {
          onNone: () => 0,
          onSome: member => member.slot,
        }),
      )
      if (Option.exists(me, member => member.name === cleaned)) {
        return
      }
      yield* sql`UPDATE ${context.table('members')}
        SET name = ${cleaned}
        WHERE player_id = ${by}`
      yield* touch(context, {})
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
      const encoded = yield* encodeResult(result)
      yield* touch(context, {
        status: 'Lobby',
        result: encoded,
        ...picksAfter(lobby),
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

const handOver = (context: ApplyContext, lobby: Lobby, next: LobbyMember) =>
  lobby.difficulty === 'Nightmare' && !next.canNightmare
    ? Effect.andThen(
        clearReady(context),
        touch(context, { host: next.playerId, difficulty: 'Hard' }),
      )
    : touch(context, { host: next.playerId })

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
    ChangedModifiers,
    ChangedEasyBreak,
    ChangedDareMark,
    ChangedMemberCalling,
    ChangedMemberName,
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
    '0007_callings': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('members'))}
          ADD COLUMN calling TEXT NOT NULL DEFAULT 'You'`
      }),
    '0008_modifiers': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('room'))}
          ADD COLUMN modifiers INTEGER NOT NULL DEFAULT 0`
      }),
    '0009_intro': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('members'))}
          ADD COLUMN intro INTEGER NOT NULL DEFAULT 0`
      }),
    '0010_easy_break': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('room'))}
          ADD COLUMN easy_break_seconds INTEGER NOT NULL DEFAULT 0`
      }),
    '0011_dare_mark': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('room'))}
          ADD COLUMN dare_mark INTEGER NOT NULL DEFAULT 0`
      }),
  },
})

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
  calling: Schema.optionalKey(CallingInput),
  introSeen: Schema.optionalKey(Schema.Boolean),
})

export const CreateRequest = Schema.Struct({
  name: NameInput,
  look: Schema.optionalKey(LookInput),
  rank: Schema.optionalKey(RankInput),
  calling: Schema.optionalKey(CallingInput),
  introSeen: Schema.optionalKey(Schema.Boolean),
})
export type CreateRequest = typeof CreateRequest.Type
export type JoinRequest = typeof JoinRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Finite })
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
