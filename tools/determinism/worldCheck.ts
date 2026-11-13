// The Phase 0 exit check (MULTIPLAYER.md): the World's step bundles alone,
// with no UI, art, audio, camera, input, store, or sync module in it, and
// it runs in workerd, the runtime of Durable Objects, playing bit for bit
// what Bun plays.
//
// 1. Bundles worldWorker.ts (stepWorld, the co-op room's adapter and binary
//    wire, and detMath) into out/ and fails on any forbidden module the
//    bundle pulls in, or on any runtime code of the netcode package.
// 2. Lists the files infra's typecheck sees (its own effect-tsgo, with
//    --listFilesOnly) and fails on any of the same game modules there: an
//    `import type` the bundle drops still pulls the client into the
//    Worker's types.
// 3. Plays a World 600 ticks in Bun and in a local workerd from infra's
//    binary (or WORKERD), and fails unless both give the same World.
// 4. Plays a co-op room's World from its seats the same way.
//
//   bun run world:check

import './globals'
import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Record,
  Schema,
  String,
} from 'effect'
import { FetchHttpClient, HttpClientRequest } from 'effect/http'
import { modifyFields } from 'foldkit/struct'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { PlayerInput } from '@munch/netcode'

import { refreshIntent } from '../../src/app/frame'
import { worldToJson } from '../../src/world/net/worldWire'
import { focusOf, modifySeat, seatCrew } from '../../src/world/party/party'
import type { Intent } from '../../src/world/schema/worldSchema'
import { encodeJson } from '../json'
import { askWorkerd } from './askWorkerd'
import { commandOutput, infraBinary, serveWorkerd } from './process'
import { playFrame, startedRun } from './script'
import {
  type PlayRequest,
  type RoomPlayRequest,
  intentToJson,
  playRoomWorld,
  playWorld,
} from './worldPlay'

const here = import.meta.dirname
const WORKERD_PORT = 8796

class CheckFailed extends Schema.TaggedError<
  CheckFailed,
  { readonly brand: unique symbol }
>()('CheckFailed', { message: Schema.String }) {}

const rootOf = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(here, '../..')
})

// NOTE: the game modules a room may carry: the World's own folder and the
// small helpers under it (AGENTS.md "Folders"), but none of their tests.
// munch/folder-imports keeps src/world/ importing only those, so a client
// module here means that rule was silenced or bypassed.
const ROOM_FOLDERS = /^src\/(world|shared)\//

const isRoomModule = (path: string): boolean =>
  ROOM_FOLDERS.test(path) && !String.includes('/__tests__/')(path)

// NOTE: what infra's typecheck may see that a room may not carry: the
// player scope the sync Worker serves and its migrations, the run summary
// the analytics Worker decodes, and the recorded runs' endpoint it keeps in
// R2 (infra/tsconfig.json includes them).
const INFRA_OWN_MODULES: ReadonlyArray<RegExp> = [
  /^src\/platform\/playerScope\.ts$/,
  /^src\/platform\/playerMigrations\.ts$/,
  /^src\/platform\/proofScope\.ts$/,
  /^src\/platform\/masteryScope\.ts$/,
  /^src\/platform\/missionScope\.ts$/,
  /^src\/platform\/playerScopeParts\.ts$/,
  /^src\/platform\/analytics\.ts$/,
  /^src\/platform\/recordingApi\.ts$/,
]

const ALLOWED_PACKAGES: ReadonlyArray<RegExp> = [
  /node_modules\/effect\//,
  /node_modules\/foldkit\/dist\/(struct|schema)\//,
]

const relativeOf =
  (root: string) =>
  (path: string): string =>
    String.startsWith(root)(path) ? String.slice(root.length + 1)(path) : path

const bundle = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* rootOf
  const outdir = path.resolve(here, 'out')
  yield* fs.makeDirectory(outdir, { recursive: true })
  const result = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [path.resolve(here, 'worldWorker.ts')],
        outdir,
        target: 'browser',
        format: 'esm',
        minify: false,
        metafile: true,
        plugins: [],
        define: {},
      }),
    catch: error =>
      CheckFailed.make({
        message: `the World did not bundle: ${globalThis.String(error)}`,
      }),
  })
  if (!result.success || result.metafile === undefined) {
    yield* Effect.forEach(result.logs, log => Console.error(log))
    return yield* CheckFailed.make({ message: 'the World did not bundle' })
  }
  return Array.map(Record.keys(result.metafile.inputs), input =>
    relativeOf(root)(path.resolve(root, input)),
  )
})

// NOTE: a package other than Effect and Foldkit's pure modules, any of the
// netcode package's runtime code, or a game module outside the room's
// folders.
const problemsOf = (inputs: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.filter(inputs, path =>
    String.includes('node_modules/')(path)
      ? !Array.some(ALLOWED_PACKAGES, allowed => allowed.test(path))
      : String.startsWith('packages/')(path) ||
        (String.startsWith('src/')(path) && !isRoomModule(path)),
  )

// NOTE: a binary from infra's packages, or the run fails with `reason`.
const infraBinaryOr = (
  name: string,
  override: Option.Option<string>,
  reason: string,
) =>
  Effect.gen(function* () {
    const root = yield* rootOf
    const maybeBinary = yield* infraBinary({ root, name, override })
    return yield* Effect.fromOption(maybeBinary).pipe(
      Effect.mapError(() => CheckFailed.make({ message: reason })),
    )
  })

// NOTE: every file of the repo infra's typecheck reads, by type or at run
// time, from its own TypeScript and tsconfig.
const infraTypeFiles = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = yield* rootOf
  const binary = yield* infraBinaryOr(
    'effect-tsgo',
    Option.none(),
    'no effect-tsgo: run bun install in infra/',
  )
  const listed = yield* commandOutput({
    command: binary,
    args: ['tsrs', '--noEmit', '--listFilesOnly'],
    cwd: path.resolve(root, 'infra'),
  }).pipe(
    Effect.mapError(error =>
      CheckFailed.make({
        message: `infra's typecheck did not list its files: ${error.message}`,
      }),
    ),
  )
  return Array.map(
    Array.filter(
      Array.map(String.split('\n')(listed), line => String.trim(line)),
      line => line !== '' && !String.includes('/node_modules/')(line),
    ),
    relativeOf(root),
  )
})

const infraTypeProblemsOf = (
  files: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.filter(
    files,
    path =>
      String.startsWith('src/')(path) &&
      !isRoomModule(path) &&
      !Array.some(INFRA_OWN_MODULES, own => own.test(path)),
  )

// NOTE: the requests as JSON for the worker, which reads them back
// (worldWorker.ts).
const encodePlayRequest = encodeJson(
  Schema.Struct({
    world: Schema.String,
    intents: Schema.Array(Schema.Tuple([Schema.Finite, Schema.String])),
    ticks: Schema.Finite,
  }),
)
const encodeRoomPlayRequest = encodeJson(
  Schema.Struct({
    slots: Schema.Array(Schema.Finite),
    seed: Schema.Finite,
    inputs: Schema.Array(Schema.Tuple([Schema.Finite, PlayerInput])),
    ticks: Schema.Finite,
  }),
)

// NOTE: a local workerd for this one request, gone once it answers.
const playInWorkerd = (body: string, route: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const override = yield* Config.option(Config.String('WORKERD'))
      const binary = yield* infraBinaryOr(
        'workerd',
        override,
        'no workerd: run bun install in infra/, or set WORKERD',
      )
      yield* serveWorkerd({
        binary,
        config: path.resolve(here, 'worldWorkerd.capnp'),
        cwd: here,
      })
      return yield* askWorkerd(
        HttpClientRequest.post(`http://127.0.0.1:${WORKERD_PORT}${route}`).pipe(
          HttpClientRequest.bodyText(body),
        ),
      )
    }),
  )

const checkBundle = Effect.gen(function* () {
  const inputs = yield* bundle
  const gameModules = Array.filter(inputs, path =>
    String.startsWith('src/')(path),
  )
  const problems = problemsOf(inputs)
  yield* Console.log(
    `The World's bundle: ${gameModules.length} game modules, ${inputs.length} in all.`,
  )
  if (problems.length > 0) {
    return yield* CheckFailed.make({
      message: `It pulls in modules a room must not carry:\n  ${Array.join(problems, '\n  ')}`,
    })
  }
  yield* Console.log(
    'No UI, art, audio, camera, input, store, sync, or netcode module in it.',
  )
})

const checkInfraTypes = Effect.gen(function* () {
  const typeFiles = yield* infraTypeFiles
  const typeProblems = infraTypeProblemsOf(typeFiles)
  yield* Console.log(
    `Infra's typecheck: ${Array.filter(typeFiles, path => String.startsWith('src/')(path)).length} game modules, ${typeFiles.length} files of the repo in all.`,
  )
  if (typeProblems.length > 0) {
    return yield* CheckFailed.make({
      message: `Its types reach modules a room must not carry (import the World's own types, not the client's):\n  ${Array.join(typeProblems, '\n  ')}`,
    })
  }
  yield* Console.log('No client module in its types either.')
})

// NOTE: a World mid-wave, with zombies about, from the scripted player.
const played = Array.reduce(
  globalThis.Array.from({ length: 900 }),
  startedRun(7, 'Campaign'),
  (model: ReturnType<typeof startedRun>, _, frame) =>
    playFrame(model, frame, 'Fixed60'),
)
const intended = refreshIntent(played)

// NOTE: co-op's crew joins the same World mid-wave (Phase 1): teammates who
// walk, aim, fire, and stab their own way, so the bundle plays every seat:
// the last teammate holds the knife, so its trigger stabs.
const MATE_INTENTS: ReadonlyArray<Intent> = [
  {
    move: { x: -0.6, y: 0.8 },
    maybeAim: Option.some({ x: 0, y: -1 }),
    trigger: 'Held',
    interact: 'Released',
  },
  {
    move: { x: 1, y: 0 },
    maybeAim: Option.none(),
    trigger: 'Held',
    interact: 'Held',
  },
  {
    move: { x: 0, y: 0 },
    maybeAim: Option.some({ x: -1, y: 0 }),
    trigger: 'Held',
    interact: 'Released',
  },
]

const KNIFE_SEAT = 3

const requestFor = (players: number) =>
  Effect.map(
    worldToJson(
      modifySeat(seatCrew(intended, players), KNIFE_SEAT, {
        player: player => modifyFields(player, { wield: () => 'Melee' }),
      }),
    ),
    (world): PlayRequest => ({
      world,
      intents: [
        [0, intentToJson(focusOf(intended).intent)],
        ...Array.map(
          MATE_INTENTS.slice(0, players - 1),
          (intent, index) => [index + 1, intentToJson(intent)] as const,
        ),
      ],
      ticks: 600,
    }),
  )

const checkPlayers = (players: number) =>
  Effect.gen(function* () {
    const request = yield* requestFor(players)
    const inWorkerd = yield* playInWorkerd(encodePlayRequest(request), '/')
    const inBun = yield* playWorld(request)
    if (inWorkerd !== inBun) {
      return yield* CheckFailed.make({
        message: `workerd and Bun disagree after ${request.ticks} ticks with ${players} players.\n  workerd: ${String.slice(0, 300)(inWorkerd)}`,
      })
    }
    yield* Console.log(
      `workerd plays ${request.ticks} ticks of the World with ${players} ${players === 1 ? 'player' : 'players'} exactly as Bun does.`,
    )
  })

// NOTE: a co-op room's World from its seats (src/world/net/roomWorld.ts): the lobby's
// players walking and firing their own ways from the start of the run.
const ROOM_INPUTS: ReadonlyArray<RoomPlayRequest['inputs'][number]> = [
  [0, { moveX: 90, moveY: -90, aimX: 0, aimY: -1024, buttons: 1, action: 0 }],
  [1, { moveX: -127, moveY: 0, aimX: 0, aimY: 0, buttons: 1, action: 0 }],
  [2, { moveX: 0, moveY: 127, aimX: 1024, aimY: 0, buttons: 0, action: 0 }],
  [3, { moveX: 0, moveY: 0, aimX: -724, aimY: 724, buttons: 1, action: 0 }],
]

const checkRoom = (players: number) =>
  Effect.gen(function* () {
    const request: RoomPlayRequest = {
      slots: Array.map(ROOM_INPUTS.slice(0, players), ([slot]) => slot),
      seed: 11,
      inputs: ROOM_INPUTS.slice(0, players),
      ticks: 900,
    }
    const inWorkerd = yield* playInWorkerd(
      encodeRoomPlayRequest(request),
      '/room',
    )
    const inBun = yield* playRoomWorld(request)
    if (inWorkerd !== inBun) {
      return yield* CheckFailed.make({
        message: `workerd and Bun disagree on a co-op room after ${request.ticks} ticks with ${players} players.\n  workerd: ${String.slice(0, 300)(inWorkerd)}`,
      })
    }
    yield* Console.log(
      `workerd plays ${request.ticks} ticks of a co-op room with ${players} players exactly as Bun does.`,
    )
  })

const program = Effect.gen(function* () {
  yield* checkBundle
  yield* checkInfraTypes
  yield* checkPlayers(1)
  yield* checkPlayers(2)
  yield* checkPlayers(4)
  yield* checkRoom(2)
  yield* checkRoom(4)
})

NodeRuntime.runMain(
  program.pipe(
    Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
  ),
)
