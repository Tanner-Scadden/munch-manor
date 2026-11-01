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
import { Option, Schema } from 'effect'
import { HttpClientRequest } from 'effect/http'
import { modifyFields } from 'foldkit/struct'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PlayerInput } from '@munch/netcode'

import { refreshIntent } from '../../src/frame'
import { seatCrew, withSeat } from '../../src/party'
import type { Intent } from '../../src/worldSchema'
import { worldToJson } from '../../src/worldWire'
import { askWorkerd } from './askWorkerd'
import { playFrame, startedRun } from './script'
import {
  type PlayRequest,
  type RoomPlayRequest,
  intentToJson,
  playRoomWorld,
  playWorld,
} from './worldPlay'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outdir = resolve(here, 'out')
const WORKERD_PORT = 8796

// NOTE: game modules a room must never carry: the client Model and its UI,
// the views and art, the camera and raw input, audio, the store and sync,
// analytics, onboarding's hints, the run reset, the cosmetics, and the
// client's own Schemas.
const FORBIDDEN_GAME_MODULES: ReadonlyArray<RegExp> = [
  /^src\/model\.ts$/,
  /^src\/clientSchema\.ts$/,
  /^src\/main\.ts$/,
  /^src\/entry\.ts$/,
  /^src\/view\.ts$/,
  /View\.ts$/,
  /^src\/(camera|input|screen|touchControls|thumbArea)\.ts$/,
  /^src\/(sprite|spriteAtlas|png|font|icons|layers|drawing)\.ts$/,
  /^src\/(room|roomPalette|roomFloor|roomWalls|roomCover)\.ts$/,
  /^src\/sprites\//,
  /^src\/(audio|audioRecipes|zombieRecipes|soundRecipe)\.ts$/,
  /^src\/(music|musicPlan)\.ts$/,
  /^src\/(store|storeSqlite|save|playerScope|playerSync)\.ts$/,
  /^src\/(commands|subscriptions|analyticsBeacon|support|changelog)\.ts$/,
  /^src\/(onboarding|runReset|frame|hud|menus|screens|juice)\.ts$/,
  /^src\/(particles|particlePhysics|particleBursts)\.ts$/,
  /^src\/(crewAwards|tallyIcons|callingArt|callingPick)\.ts$/,
  /^src\/update\//,
  /^src\/coop\//,
  /^src\/roomTesting\.ts$/,
  /^packages\//,
]

// NOTE: what infra's typecheck may see that a room may not carry: the
// player scope the sync Worker serves (infra/tsconfig.json includes it), and
// the packages the Worker is built on.
const INFRA_OWN_MODULES: ReadonlyArray<RegExp> = [
  /^src\/playerScope\.ts$/,
  /^packages\//,
]

const ALLOWED_PACKAGES: ReadonlyArray<RegExp> = [
  /node_modules\/effect\//,
  /node_modules\/foldkit\/dist\/(struct|schema)\//,
]

const relativeOf = (path: string): string =>
  path.startsWith(root) ? path.slice(root.length + 1) : path

const bundle = async (): Promise<ReadonlyArray<string>> => {
  mkdirSync(outdir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [resolve(here, 'worldWorker.ts')],
    outdir,
    target: 'browser',
    format: 'esm',
    minify: false,
    metafile: true,
    plugins: [],
    define: {},
  })
  if (!result.success || result.metafile === undefined) {
    result.logs.forEach(log => console.error(log))
    throw new Error('the World did not bundle')
  }
  return Object.keys(result.metafile.inputs).map(path =>
    relativeOf(resolve(root, path)),
  )
}

const problemsOf = (inputs: ReadonlyArray<string>): ReadonlyArray<string> =>
  inputs.filter(path =>
    path.includes('node_modules/')
      ? !ALLOWED_PACKAGES.some(allowed => allowed.test(path))
      : FORBIDDEN_GAME_MODULES.some(forbidden => forbidden.test(path)),
  )

// NOTE: a binary from infra's packages, in this checkout or, from a
// worktree with none installed, in the main one.
const infraBinary = (name: string, override?: string): string | undefined => {
  const commonDir = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root, encoding: 'utf8' },
  ).stdout.trim()
  return [
    override,
    resolve(root, `infra/node_modules/.bin/${name}`),
    commonDir === ''
      ? undefined
      : resolve(commonDir, `../infra/node_modules/.bin/${name}`),
  ].find(path => path !== undefined && existsSync(path))
}

const workerdBinary = (): string | undefined =>
  infraBinary('workerd', process.env['WORKERD'])

// NOTE: every file of the repo infra's typecheck reads, by type or at run
// time, from its own TypeScript and tsconfig.
const infraTypeFiles = (): ReadonlyArray<string> => {
  const binary = infraBinary('effect-tsgo')
  if (binary === undefined) {
    throw new Error('no effect-tsgo: run bun install in infra/')
  }
  const listed = spawnSync(binary, ['tsrs', '--noEmit', '--listFilesOnly'], {
    cwd: resolve(root, 'infra'),
    encoding: 'utf8',
  })
  if (listed.status !== 0) {
    console.error(listed.stdout, listed.stderr)
    throw new Error("infra's typecheck did not list its files")
  }
  return listed.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.includes('/node_modules/'))
    .map(relativeOf)
}

const infraTypeProblemsOf = (
  files: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  files.filter(
    path =>
      path.startsWith('src/') &&
      !INFRA_OWN_MODULES.some(own => own.test(path)) &&
      FORBIDDEN_GAME_MODULES.some(forbidden => forbidden.test(path)),
  )

// NOTE: the requests as JSON for the worker, which reads them back
// (worldWorker.ts).
const encodePlayRequest = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      world: Schema.String,
      intents: Schema.Array(Schema.Tuple([Schema.Number, Schema.String])),
      ticks: Schema.Number,
    }),
  ),
)
const encodeRoomPlayRequest = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      slots: Schema.Array(Schema.Number),
      seed: Schema.Number,
      inputs: Schema.Array(Schema.Tuple([Schema.Number, PlayerInput])),
      ticks: Schema.Number,
    }),
  ),
)

const playInWorkerd = async (body: string, path = '/'): Promise<string> => {
  const binary = workerdBinary()
  if (binary === undefined) {
    throw new Error('no workerd: run bun install in infra/, or set WORKERD')
  }
  const server = spawn(binary, ['serve', resolve(here, 'worldWorkerd.capnp')], {
    cwd: here,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  try {
    return await askWorkerd(
      HttpClientRequest.post(`http://127.0.0.1:${WORKERD_PORT}${path}`).pipe(
        HttpClientRequest.bodyText(body),
      ),
    )
  } finally {
    server.kill()
  }
}

const inputs = await bundle()
const gameModules = inputs.filter(path => path.startsWith('src/'))
const problems = problemsOf(inputs)
console.log(
  `The World's bundle: ${gameModules.length} game modules, ${inputs.length} in all.`,
)
if (problems.length > 0) {
  console.error(
    `It pulls in modules a room must not carry:\n  ${problems.join('\n  ')}`,
  )
  process.exit(1)
}
console.log(
  'No UI, art, audio, camera, input, store, sync, or netcode module in it.',
)

const typeFiles = infraTypeFiles()
const typeProblems = infraTypeProblemsOf(typeFiles)
console.log(
  `Infra's typecheck: ${typeFiles.filter(path => path.startsWith('src/')).length} game modules, ${typeFiles.length} files of the repo in all.`,
)
if (typeProblems.length > 0) {
  console.error(
    `Its types reach modules a room must not carry (import the World's own types, not the client's):\n  ${typeProblems.join('\n  ')}`,
  )
  process.exit(1)
}
console.log('No client module in its types either.')

// NOTE: a World mid-wave, with zombies about, from the scripted player.
const played = Array.from({ length: 900 }).reduce(
  (model: ReturnType<typeof startedRun>, _, frame) =>
    playFrame(model, frame, 'Fixed60'),
  startedRun(7, 'Campaign'),
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

const requestFor = (players: number): PlayRequest => ({
  world: worldToJson(
    withSeat(seatCrew(intended, players), KNIFE_SEAT, seatWorld =>
      modifyFields(seatWorld, {
        player: player => modifyFields(player, { wield: () => 'Melee' }),
      }),
    ),
  ),
  intents: [
    [0, intentToJson(intended.intent)],
    ...MATE_INTENTS.slice(0, players - 1).map(
      (intent, index) => [index + 1, intentToJson(intent)] as const,
    ),
  ],
  ticks: 600,
})

const checkPlayers = async (players: number): Promise<void> => {
  const request = requestFor(players)
  const inWorkerd = await playInWorkerd(encodePlayRequest(request))
  const inBun = playWorld(request)
  if (inWorkerd !== inBun) {
    console.error(
      `workerd and Bun disagree after ${request.ticks} ticks with ${players} players.\n  workerd: ${inWorkerd.slice(0, 300)}`,
    )
    process.exit(1)
  }
  console.log(
    `workerd plays ${request.ticks} ticks of the World with ${players} ${players === 1 ? 'player' : 'players'} exactly as Bun does.`,
  )
}

await checkPlayers(1)
await checkPlayers(2)
await checkPlayers(4)

// NOTE: a co-op room's World from its seats (src/roomWorld.ts): the lobby's
// players walking and firing their own ways from the start of the run.
const ROOM_INPUTS: ReadonlyArray<RoomPlayRequest['inputs'][number]> = [
  [0, { moveX: 90, moveY: -90, aimX: 0, aimY: -1024, buttons: 1, action: 0 }],
  [1, { moveX: -127, moveY: 0, aimX: 0, aimY: 0, buttons: 1, action: 0 }],
  [2, { moveX: 0, moveY: 127, aimX: 1024, aimY: 0, buttons: 0, action: 0 }],
  [3, { moveX: 0, moveY: 0, aimX: -724, aimY: 724, buttons: 1, action: 0 }],
]

const checkRoom = async (players: number): Promise<void> => {
  const request: RoomPlayRequest = {
    slots: ROOM_INPUTS.slice(0, players).map(([slot]) => slot),
    seed: 11,
    inputs: ROOM_INPUTS.slice(0, players),
    ticks: 900,
  }
  const inWorkerd = await playInWorkerd(encodeRoomPlayRequest(request), '/room')
  const inBun = playRoomWorld(request)
  if (inWorkerd !== inBun) {
    console.error(
      `workerd and Bun disagree on a co-op room after ${request.ticks} ticks with ${players} players.\n  workerd: ${inWorkerd.slice(0, 300)}`,
    )
    process.exit(1)
  }
  console.log(
    `workerd plays ${request.ticks} ticks of a co-op room with ${players} players exactly as Bun does.`,
  )
}

await checkRoom(2)
await checkRoom(4)
