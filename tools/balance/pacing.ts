// Pacing: plays campaign runs with the balance bot and reads its World
// every frame, for docs/PACING_REPORT.md. Per wave: its length, the time
// with fewer than 3 zombies alive, the time with nothing in the 320 by 180
// view, the first arrival, the gaps between packs, the kill rate, and the
// tail; per break, the bot's time against the clock; per run, when each
// room opened, when the list was done, and the run's length.
//
// Run it through the guard, one difficulty a job, as `bun run heavy -- --cpu
// sh tools/balance/pacing.sh <runs>` with DIFFICULTY= and AIM= as for the
// bot: it plays `run <count> <from>` slices in rounds of WORKERS processes,
// each writing tools/balance/reports/pacing-<difficulty>-<from>.json
// (gitignored), and `bun tools/balance/pacing.ts report` prints the tables.
// A run takes about a minute, so a round of 2 run slices is a couple of
// minutes, and between rounds the script calls `yield <workers>`, which
// yields the guard's turn (yieldTurn) and prints the WORKERS for the next
// round. Clear the old slices before a new measurement.

import {
  Array,
  Config,
  Console,
  Effect,
  FileSystem,
  Option,
  Order,
  Schema,
  String,
} from 'effect'
import { Window } from 'happy-dom'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { yieldTurn } from '../heavy/turn'
import { readJsonFile, writeJsonFile } from '../json'
import type { Model } from './bot/basics'

const browserWindow = new Window()
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  __BUILD_ID__: 'dev',
})

const { DEFAULT_OPTIONS, FRAME_MS, parseDifficulty, windowCamera } =
  await import('./bot/basics')
const { runOnce, seedAt } = await import('./bot')
const { pendingSpawns, spawnKey } = await import('./bot/logs')
const { knobText } = await import('./bot/knobs')
const { LANDSCAPE_SCREEN } = await import('../../src/render/screen')
const { focusOf } = await import('../../src/world/party/party')
const { killTotal } = await import('../../src/world/run/stats')
const { aliveCount, isAlive } = await import('../../src/world/waves/pacing')
const { DIFFICULTY_ORDER, breakMsOf } =
  await import('../../src/world/run/difficulty')

// WHAT ONE RUN RECORDS

const WaveStat = Schema.Struct({
  wave: Schema.Finite,
  lengthMs: Schema.Finite,
  underThreeMs: Schema.Finite,
  emptyMs: Schema.Finite,
  noTargetMs: Schema.Finite,
  restingMs: Schema.Finite,
  fadingMs: Schema.Finite,
  firstArrivalMs: Schema.Finite,
  firstNearMs: Schema.Finite,
  packTimesMs: Schema.Array(Schema.Finite),
  lastReleaseMs: Schema.Finite,
  stragglerMs: Schema.Finite,
  zombies: Schema.Finite,
  kills: Schema.Finite,
  heartsLost: Schema.Finite,
  keysAtEnd: Schema.Finite,
  cleared: Schema.Boolean,
})
type WaveStat = typeof WaveStat.Type

const BreakStat = Schema.Struct({
  beforeWave: Schema.Finite,
  ms: Schema.Finite,
  walkedPx: Schema.Finite,
})

const RoomOpen = Schema.Struct({ atMs: Schema.Finite, wave: Schema.Finite })

const RunStat = Schema.Struct({
  seed: Schema.Finite,
  escaped: Schema.Boolean,
  lastWave: Schema.Finite,
  totalMs: Schema.Finite,
  waveMs: Schema.Finite,
  breakMs: Schema.Finite,
  rooms: Schema.Array(RoomOpen),
  listDoneMs: Schema.Finite,
  listDoneWave: Schema.Finite,
  chunkWave: Schema.Finite,
  hatMs: Schema.Finite,
  waves: Schema.Array(WaveStat),
  breaks: Schema.Array(BreakStat),
})
type RunStat = typeof RunStat.Type

const PacingFile = Schema.Struct({
  difficulty: Schema.String,
  aim: Schema.String,
  clockBreakMs: Schema.Finite,
  runs: Schema.Array(RunStat),
})

// NOTE: a zombie this near the player counts as arrived: a 120 px ring is
// about two seconds of a Groaner's walk on Normal.
const NEAR_PX = 120
const FEW_ALIVE = 3
const STRAGGLERS = 2

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> }

const freshWave = (wave: number): Mutable<WaveStat> => ({
  wave,
  lengthMs: 0,
  underThreeMs: 0,
  emptyMs: 0,
  noTargetMs: 0,
  restingMs: 0,
  fadingMs: 0,
  firstArrivalMs: -1,
  firstNearMs: -1,
  packTimesMs: [],
  lastReleaseMs: 0,
  stragglerMs: -1,
  zombies: 0,
  kills: 0,
  heartsLost: 0,
  keysAtEnd: 0,
  cleared: false,
})

const recorder = () => {
  const waves: Array<Mutable<WaveStat>> = []
  const breaks: Array<{ beforeWave: number; ms: number; walkedPx: number }> = []
  const rooms: Array<{ atMs: number; wave: number }> = []
  const seenPacks = new Set<number>()
  const counted = new Set<string>()
  const state = {
    totalMs: 0,
    waveMs: 0,
    breakMs: 0,
    listDoneMs: 0,
    listDoneWave: 0,
    chunkWave: 0,
    hatMs: 0,
    stragglerFromMs: -1,
  }
  const onFrame = (before: Model, after: Model): void => {
    const phase = before.phase
    if (phase._tag !== 'Wave' && phase._tag !== 'Preparation') {
      return
    }
    state.totalMs += FRAME_MS
    if (phase._tag === 'Preparation') {
      state.breakMs += FRAME_MS
      const last = breaks[breaks.length - 1]
      const current =
        last !== undefined && last.beforeWave === phase.wave
          ? last
          : { beforeWave: phase.wave, ms: 0, walkedPx: 0 }
      if (current !== last) {
        breaks.push(current)
      }
      current.ms += FRAME_MS
      const from = focusOf(before).player
      const to = focusOf(after).player
      current.walkedPx += Math.hypot(to.x - from.x, to.y - from.y)
    }
    if (phase._tag === 'Wave') {
      state.waveMs += FRAME_MS
      const last = waves[waves.length - 1]
      const log =
        last !== undefined && last.wave === phase.wave
          ? last
          : freshWave(phase.wave)
      if (log !== last) {
        waves.push(log)
        seenPacks.clear()
        counted.clear()
        state.stragglerFromMs = -1
        log.zombies = pendingSpawns(before).length
      }
      log.lengthMs += FRAME_MS
      const alive = aliveCount(after.zombies)
      const player = focusOf(after).player
      const camera = windowCamera(after, LANDSCAPE_SCREEN)
      const living = Array.filter(after.zombies, isAlive)
      const inView = Array.filter(
        living,
        zombie =>
          zombie.x >= camera.x &&
          zombie.x <= camera.x + camera.width &&
          zombie.y >= camera.y &&
          zombie.y <= camera.y + camera.height,
      ).length
      const near = Array.some(
        living,
        zombie =>
          Math.hypot(zombie.x - player.x, zombie.y - player.y) <= NEAR_PX,
      )
      log.underThreeMs += alive < FEW_ALIVE ? FRAME_MS : 0
      log.emptyMs += alive === 0 ? FRAME_MS : 0
      log.noTargetMs += inView === 0 ? FRAME_MS : 0
      log.restingMs += after.pacing.beat._tag === 'Resting' ? FRAME_MS : 0
      log.fadingMs += after.pacing.beat._tag === 'Fading' ? FRAME_MS : 0
      if (log.firstArrivalMs < 0 && alive > 0) {
        log.firstArrivalMs = log.lengthMs
      }
      if (log.firstNearMs < 0 && near) {
        log.firstNearMs = log.lengthMs
      }
      const remaining = new Set(Array.map(pendingSpawns(after), spawnKey))
      Array.forEach(pendingSpawns(before), spawn => {
        const key = spawnKey(spawn)
        if (remaining.has(key) || counted.has(key)) {
          return
        }
        counted.add(key)
        log.lastReleaseMs = log.lengthMs
        if (!seenPacks.has(spawn.pack)) {
          seenPacks.add(spawn.pack)
          log.packTimesMs.push(log.lengthMs)
        }
      })
      log.zombies = Math.max(log.zombies, counted.size)
      if (
        state.stragglerFromMs < 0 &&
        pendingSpawns(after).length === 0 &&
        alive <= STRAGGLERS &&
        after.boss._tag !== 'Fighting'
      ) {
        state.stragglerFromMs = log.lengthMs
      }
      log.kills += killTotal(after.stats.kills) - killTotal(before.stats.kills)
      log.heartsLost += Math.max(
        0,
        focusOf(before).player.hp - focusOf(after).player.hp,
      )
      log.keysAtEnd = after.keys.found
      if (after.phase._tag !== 'Wave') {
        log.cleared = after.phase._tag !== 'GameOver'
        log.stragglerMs =
          state.stragglerFromMs < 0 ? 0 : log.lengthMs - state.stragglerFromMs
      }
    }
    if (state.chunkWave === 0 && after.boss._tag !== 'Absent') {
      state.chunkWave =
        after.phase._tag === 'Wave' || after.phase._tag === 'Preparation'
          ? after.phase.wave
          : 0
    }
    Array.forEach(after.frameEvents, event => {
      if (event._tag === 'ExitOpened') {
        rooms.push({ atMs: state.totalMs, wave: phase.wave })
      }
      if (event._tag === 'DareListDone' && state.listDoneMs === 0) {
        state.listDoneMs = state.totalMs
        state.listDoneWave = phase.wave
      }
      if (
        event._tag === 'DareFound' &&
        event.kind === 'PartyHat' &&
        state.hatMs === 0
      ) {
        state.hatMs = state.totalMs
      }
    })
  }
  const finish = (seed: number, escaped: boolean): RunStat => ({
    seed,
    escaped,
    lastWave: waves[waves.length - 1]?.wave ?? 0,
    totalMs: state.totalMs,
    waveMs: state.waveMs,
    breakMs: state.breakMs,
    rooms,
    listDoneMs: state.listDoneMs,
    listDoneWave: state.listDoneWave,
    chunkWave: state.chunkWave,
    hatMs: state.hatMs,
    waves,
    breaks,
  })
  return { onFrame, finish }
}

// SUMMARY

const median = (values: ReadonlyArray<number>): number => {
  const sorted = Array.sort(values, Order.Number)
  if (sorted.length === 0) {
    return globalThis.Number.NaN
  }
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0
    ? globalThis.Number.NaN
    : Array.reduce(values, 0, (sum, value) => sum + value) / values.length

const seconds = (ms: number): string =>
  globalThis.Number.isNaN(ms) ? '-' : (ms / 1000).toFixed(1)

const gapsOf = (times: ReadonlyArray<number>): Array<number> =>
  Array.flatMap(Array.drop(times, 1), (time, index) => {
    const previous = times[index]
    return previous === undefined ? [] : [time - previous]
  })

const WAVE_ROWS = 12

const reportOf = (
  runs: ReadonlyArray<RunStat>,
  label: string,
  clockBreakMs: number,
): string => {
  const lines: Array<string> = [
    `## ${label}: ${runs.length} runs, escaped ${Array.filter(runs, run => run.escaped).length}`,
    '',
    '| Wave | Runs | Zombies | Length s | <3 alive s | Empty s | No target s | Resting s | First in s | First near s | Pack gap s | Tail after last pack s | Straggler s | Kills/s | Hearts |',
    '| ---- | ---- | ------- | -------- | ---------- | ------- | ----------- | --------- | ---------- | ------------ | ---------- | ---------------------- | ----------- | ------- | ------ |',
  ]
  Array.forEach(Array.range(1, WAVE_ROWS), wave => {
    const stats = Array.filter(
      Array.flatMap(runs, run => run.waves),
      stat => stat.wave === wave && stat.cleared,
    )
    if (stats.length === 0) {
      return
    }
    const pick = (read: (stat: WaveStat) => number) =>
      seconds(median(Array.map(stats, read)))
    const gaps = Array.flatMap(stats, stat => gapsOf(stat.packTimesMs))
    lines.push(
      `| ${wave} | ${stats.length} | ${median(Array.map(stats, stat => stat.zombies))} | ${pick(stat => stat.lengthMs)} | ${pick(stat => stat.underThreeMs)} | ${pick(stat => stat.emptyMs)} | ${pick(stat => stat.noTargetMs)} | ${pick(stat => stat.restingMs)} | ${pick(stat => stat.firstArrivalMs)} | ${pick(stat => stat.firstNearMs)} | ${seconds(median(gaps))} | ${pick(stat => stat.lengthMs - stat.lastReleaseMs)} | ${pick(stat => stat.stragglerMs)} | ${median(Array.map(stats, stat => (stat.kills * 1000) / Math.max(1, stat.lengthMs))).toFixed(2)} | ${mean(Array.map(stats, stat => stat.heartsLost)).toFixed(2)} |`,
    )
  })
  const breaks = Array.flatMap(runs, run => run.breaks)
  lines.push(
    '',
    '| Break before wave | Bot s | Walked px |',
    '| ----------------- | ----- | --------- |',
  )
  Array.forEach(Array.range(1, WAVE_ROWS), wave => {
    const at = Array.filter(breaks, stat => stat.beforeWave === wave)
    if (at.length > 0) {
      lines.push(
        `| ${wave} | ${seconds(median(Array.map(at, stat => stat.ms)))} | ${median(Array.map(at, stat => stat.walkedPx)).toFixed(0)} |`,
      )
    }
  })
  const escaped = Array.filter(runs, run => run.escaped)
  const all = (read: (run: RunStat) => number, from = runs) =>
    seconds(median(Array.map(from, read)))
  const minutes = (ms: number) => (ms / 60000).toFixed(1)
  const roomAt = (index: number) =>
    Array.flatMap(runs, run => {
      const room = run.rooms[index]
      return room === undefined ? [] : [room]
    })
  lines.push(
    '',
    `- Run (all runs), median: ${minutes(median(Array.map(runs, run => run.totalMs)))} min, waves ${all(run => run.waveMs)} s, breaks ${all(run => run.breakMs)} s, last wave ${median(Array.map(runs, run => run.lastWave))}.`,
    `- Escapes, median: ${minutes(median(Array.map(escaped, run => run.totalMs)))} min, waves ${all(run => run.waveMs, escaped)} s, breaks ${all(run => run.breakMs, escaped)} s, on wave ${median(Array.map(escaped, run => run.lastWave))}; with every break run to its ${seconds(clockBreakMs)} s clock: ${minutes(median(Array.map(escaped, run => run.waveMs + run.breaks.length * clockBreakMs)))} min.`,
    `- Break share of the run: bot ${(100 * mean(Array.map(runs, run => run.breakMs / Math.max(1, run.totalMs)))).toFixed(0)}%, at the clock ${(100 * mean(Array.map(runs, run => (run.breaks.length * clockBreakMs) / Math.max(1, run.waveMs + run.breaks.length * clockBreakMs)))).toFixed(0)}%.`,
    ...Array.map(Array.range(0, 3), index => {
      const opened = roomAt(index)
      return `- Room ${index + 1} opened in ${opened.length} of ${runs.length} runs: median wave ${median(Array.map(opened, room => room.wave))}, at ${minutes(median(Array.map(opened, room => room.atMs)))} min.`
    }),
    `- List done in ${Array.filter(runs, run => run.listDoneWave > 0).length} runs: median wave ${median(
      Array.filter(
        Array.map(runs, run => run.listDoneWave),
        wave => wave > 0,
      ),
    )}, at ${minutes(
      median(
        Array.filter(
          Array.map(runs, run => run.listDoneMs),
          ms => ms > 0,
        ),
      ),
    )} min. Uncle Chunk's median wave ${median(
      Array.filter(
        Array.map(runs, run => run.chunkWave),
        wave => wave > 0,
      ),
    )}.`,
    '',
  )
  return Array.join(lines, '\n')
}

// THE PROGRAM

const REPORTS = 'tools/balance/reports'

// `run <runs> <from>` plays runs from..from+runs-1 and writes one slice;
// `report` reads every slice and prints the tables by difficulty.
const playSlice = (runCount: number, from: number) =>
  Effect.gen(function* () {
    const maybeDifficulty = yield* Config.String('DIFFICULTY').pipe(
      Config.option,
    )
    const difficulty = parseDifficulty(Option.getOrUndefined(maybeDifficulty))
    const aim = knobText('AIM') ?? 'human'
    const runs = Array.map(Array.range(from, from + runCount - 1), index => {
      const seed = seedAt(1, index)
      const record = recorder()
      const result = runOnce(seed, {
        ...DEFAULT_OPTIONS,
        difficulty,
        onFrame: record.onFrame,
      })
      return record.finish(seed, result.escaped)
    })
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(REPORTS, { recursive: true })
    yield* writeJsonFile(
      PacingFile,
      `${REPORTS}/pacing-${difficulty}-${from}.json`,
      { difficulty, aim, clockBreakMs: breakMsOf(difficulty), runs },
    )
  })

const printReport = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const entries = yield* fs.readDirectory(REPORTS)
  const names = Array.filter(
    entries,
    name =>
      String.startsWith('pacing-')(name) && String.endsWith('.json')(name),
  )
  const files = yield* Effect.forEach(names, name =>
    readJsonFile(PacingFile, `${REPORTS}/${name}`),
  )
  yield* Effect.forEach(DIFFICULTY_ORDER, difficulty => {
    const slices = Array.filter(files, file => file.difficulty === difficulty)
    const first = slices[0]
    return first === undefined
      ? Effect.void
      : Console.log(
          reportOf(
            Array.flatMap(slices, file => file.runs),
            `${difficulty} (${first.aim})`,
            first.clockBreakMs,
          ),
        )
  })
})

// NOTE: the boundary between rounds of slices: prints the WORKERS the guard
// grants for the next round, or the ones it had outside the guard.
const yieldBetweenRounds = (workers: number) =>
  yieldTurn('the next round of pacing slices').pipe(
    Effect.map(Option.getOrElse(() => workers)),
    Effect.flatMap(next => Console.log(`${next}`)),
  )

const program = Effect.gen(function* () {
  const [mode, runs, from] = process.argv.slice(2)
  yield* mode === 'run'
    ? playSlice(
        globalThis.Number.parseInt(runs ?? '1', 10),
        globalThis.Number.parseInt(from ?? '0', 10),
      )
    : mode === 'yield'
      ? yieldBetweenRounds(globalThis.Number.parseInt(runs ?? '1', 10))
      : printReport
})

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
