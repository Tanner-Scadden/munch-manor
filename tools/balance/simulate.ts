// Headless balance simulation. Run it from the repo root through the heavy
// guard (tools/heavy), never directly:
//   bun run balance [runs] [firstSeed]
//   MODE=endless bun run balance [runs] [firstSeed]
//   WORKERS=4 bun run balance 200   (splits the runs over processes, capped)
//   TIMELINE=1 bun run balance 40   (adds the wave timeline audit)
//   END_REPORT=1 bun run balance 100   (adds where each run stopped and
//     each Uncle Chunk fight, tools/balance/endReport.ts)
//   AIM=sharp bun run balance 200   (the old bot, without the human limits)
//   KITE=1 bun run balance 200   (runs from the boss, never dodges)
//   NO_DODGE=1 bun run balance 200   (ignores every floor tell)
//   DIFFICULTY=hard bun run balance 200   (easy, normal, hard, or nightmare)
//   bun run balance -- --wave 4 --runs 200   (the wave snapshot pass)
//   bun run balance -- --wave all --runs 100   (every campaign wave)
//   bun run balance -- --runs 100 --seed-offset 100   (the next 100 seeds)
// Flags: --runs n, --first-seed n, --seed-offset n (skips the first n runs'
// seeds, so a second batch plays new seeds: --seed-offset 100 after a batch
// of 100 plays runs 100 to 199 of the same seed list), --wave n|all, --slots
// n (snapshot slots, 10 by default), and --json path (also write the summary
// the nightly suite reads). Under the guard it plays the runs in chunks of about 25 (by
// slot groups for a wave pass) and yields the guard's turn between them, so
// waiting jobs go in between; the report is the same as one unchunked
// batch, since every run is seeded by its index. HEAVY_CHUNK_RUNS=n sets
// the chunk, and 0 plays it whole. It drives the game's own init model and update with the bot in
// tools/balance/bot.ts (its parts in tools/balance/bot/) and prints survival per wave, run length, the money
// curve, and which zombie kinds cost the bot the most hearts. Nothing here
// ships with the game.

import {
  Array,
  Config,
  Console,
  Effect,
  Option,
  Predicate,
  Record,
  Ref,
  Schema,
  String,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Window } from 'happy-dom'
import { fileURLToPath } from 'node:url'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson, readJsonFile, writeJsonFile } from '../json'
import type { BotOptions } from './bot/basics'
import type { BossFight, NewKindLog, RunResult, WaveRun } from './bot/results'

const CAMPAIGN_REPORT_WAVES = 14

const browserWindow = new Window()
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  __BUILD_ID__: 'dev',
})

const {
  DEFAULT_OPTIONS,
  parseCalling,
  parseDareMark,
  parseModifiers,
  parseDifficulty,
} = await import('./bot/basics')
const { KINDS, emptyHurt, quietPartMs } = await import('./bot/logs')
const { RunResults, WaveRuns } = await import('./bot/results')
const { runOnce, seedAt: seedFrom } = await import('./bot')
const { playWavePass } = await import('./bot/snapshots')
const { FINAL_WAVE } = await import('../../src/world/waves/wavePlans')
const summary = await import('./summary')
const { printEndReport } = await import('./endReport')
const turn = await import('../heavy/turn')
const { nextChunk } = await import('../heavy/decision')

// TUNE=path/to/tune.ts loads a module whose default export edits the
// tables in place before the runs, so a balance idea can be tried without
// touching src. Bake the winning numbers into src afterwards.
// NOTE: the tables a tune module may edit in place.
const tuneTables = Effect.map(
  Effect.all({
    wavePlans: Effect.promise(() => import('../../src/world/waves/wavePlans')),
    zombies: Effect.promise(() => import('../../src/world/zombies/zombies')),
    keys: Effect.promise(() => import('../../src/world/keys/keys')),
    exits: Effect.promise(() => import('../../src/world/level/exits')),
    fridge: Effect.promise(() => import('../../src/world/fridge/leftovers')),
    weapons: Effect.promise(() => import('../../src/world/gear/weapons')),
    traps: Effect.promise(() => import('../../src/world/gear/traps')),
    powerups: Effect.promise(() => import('../../src/world/gear/powerups')),
    boss: Effect.promise(() => import('../../src/world/zombies/bossRules')),
    chucker: Effect.promise(() => import('../../src/world/zombies/chucker')),
    crawler: Effect.promise(() => import('../../src/world/zombies/crawler')),
    frenzy: Effect.promise(() => import('../../src/world/zombies/frenzy')),
    difficulty: Effect.promise(() => import('../../src/world/run/difficulty')),
  }),
  modules => ({
    WAVE_PLANS: modules.wavePlans.WAVE_PLANS,
    ZOMBIE_KINDS: modules.zombies.ZOMBIE_KINDS,
    KEY_RULES: modules.keys.KEY_RULES,
    EXIT_RULES: modules.exits.EXIT_RULES,
    FRIDGE_RULES: modules.fridge.FRIDGE_RULES,
    WEAPONS: modules.weapons.WEAPONS,
    UPGRADE_TIERS: modules.weapons.UPGRADE_TIERS,
    TRAPS: modules.traps.TRAPS,
    DROP_CHANCE: modules.powerups.DROP_CHANCE,
    DROP_RULES: modules.powerups.DROP_RULES,
    BOOSTS: modules.powerups.BOOSTS,
    PICKUPS: modules.powerups.PICKUPS,
    BOSS_RULES: modules.boss.BOSS_RULES,
    CHUCKER_RULES: modules.chucker.CHUCKER_RULES,
    CRAWLER_RULES: modules.crawler.CRAWLER_RULES,
    FRENZY_RULES: modules.frenzy.FRENZY_RULES,
    BAIT_RULES: modules.traps.BAIT_RULES,
    DIFFICULTIES: modules.difficulty.DIFFICULTIES,
  }),
)
type TuneTables = Effect.Success<typeof tuneTables>

// NOTE: a tune module is the caller's own script: its default export is
// checked to be a function, and is trusted to take the tables.
const TuneModule = Schema.Struct({
  default: Schema.declare(
    (value: unknown): value is (tables: TuneTables) => void =>
      Predicate.isFunction(value),
  ),
})

class TuneFailed extends Schema.TaggedError<
  TuneFailed,
  { readonly brand: unique symbol }
>()('TuneFailed', {
  path: Schema.String,
  reason: Schema.String,
}) {}

const applyTune = (tune: string) =>
  Effect.gen(function* () {
    const tunePath = String.startsWith('/')(tune)
      ? tune
      : `${process.cwd()}/${tune}`
    const loaded: unknown = yield* Effect.tryPromise({
      try: () => import(tunePath),
      catch: error =>
        TuneFailed.make({ path: tunePath, reason: globalThis.String(error) }),
    })
    const module = yield* Schema.decodeUnknownEffect(TuneModule)(loaded)
    const tables = yield* tuneTables
    module.default(tables)
  })

// ARGUMENTS

const argv = process.argv.slice(2)
const flagValue = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const positional = Array.filter(
  argv,
  (arg, index) =>
    !String.startsWith('--')(arg) &&
    !String.startsWith('--')(argv[index - 1] ?? ''),
)

const SimulateConfig = Config.all({
  maybeTune: Config.String('TUNE').pipe(Config.option),
  maybeMode: Config.String('MODE').pipe(Config.option),
  maybeDifficulty: Config.String('DIFFICULTY').pipe(Config.option),
  maybeSwap: Config.String('SWAP').pipe(Config.option),
  maybeNoUpgrades: Config.String('NO_UPGRADES').pipe(Config.option),
  maybeCalling: Config.String('CALLING').pipe(Config.option),
  maybeMods: Config.String('MODS').pipe(Config.option),
  maybeMark: Config.String('MARK').pipe(Config.option),
  maybeKite: Config.String('KITE').pipe(Config.option),
  maybeNoPickups: Config.String('NO_PICKUPS').pipe(Config.option),
  maybeWorkers: Config.String('WORKERS').pipe(Config.option),
  maybeTimeline: Config.String('TIMELINE').pipe(Config.option),
  maybeEndReport: Config.String('END_REPORT').pipe(Config.option),
  maybeWorkerSlice: Config.String('WORKER_SLICE').pipe(Config.option),
  maybeWorkerSlots: Config.String('WORKER_SLOTS').pipe(Config.option),
  maybeWorkerOut: Config.String('WORKER_OUT').pipe(Config.option),
})

// NOTE: what the whole batch reads, from the flags and the environment.
type Setup = {
  readonly options: BotOptions
  readonly isEndless: boolean
  readonly kites: boolean
  readonly ignoresPickups: boolean
  readonly hasTimeline: boolean
  readonly hasEndReport: boolean
  readonly waveFlag: string | undefined
  readonly jsonOut: string | undefined
  readonly runs: number
  readonly firstSeed: number
  readonly seedOffset: number
  readonly slots: number
  readonly isChunked: boolean
  readonly started: number
}

const styleOf = (setup: Setup) =>
  setup.options.swapsBack ? 'SwapsBack' : 'Default'

const seedAt = (setup: Setup, index: number) =>
  seedFrom(setup.firstSeed, setup.seedOffset + index)

const waveList = (flag: string): Array<number> => {
  if (flag === 'all') {
    return globalThis.Array.from(
      { length: FINAL_WAVE },
      (_, index) => index + 1,
    )
  }
  const wave = Number(flag)
  if (!Number.isInteger(wave) || wave < 1 || wave > FINAL_WAVE) {
    throw new Error(`--wave must be all or a wave from 1 to ${FINAL_WAVE}`)
  }
  return [wave]
}

// WORKERS

// A worker plays one share of the work and writes its results as JSON, so
// WORKERS=n gives the same report as one process, only sooner. A campaign
// worker plays a slice of the seeds, from:to. A wave worker plays the
// snapshot slots whose index modulo the worker count is its own, index:count,
// among the slots of its chunk, WORKER_SLOTS=from:to. A worker writes its
// RunResults or WaveRuns through their Schemas (bot/results.ts) and this
// process decodes them with the same ones, so they read exactly as results
// played in process.

// NOTE: an env var holding from:to, two whole numbers.
const rangeFrom = (text: string): readonly [number, number] => {
  const [from, ...rest] = Array.map(String.split(':')(text), Number)
  const to = rest[0]
  if (to === undefined) {
    throw new Error(`Expected from:to, got ${text}`)
  }
  return [from, to]
}

class WorkerFailed extends Schema.TaggedError<
  WorkerFailed,
  { readonly brand: unique symbol }
>()('WorkerFailed', {
  message: Schema.String,
}) {}

// NOTE: plays this process's share as a worker and writes it to `out`.
const playAsWorker = (
  setup: Setup,
  slice: string,
  maybeSlots: Option.Option<string>,
  maybeOut: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const [from, to] = rangeFrom(slice)
    const [slotFrom, slotTo] = rangeFrom(
      Option.getOrElse(maybeSlots, () => `0:${setup.slots}`),
    )
    if (Option.isNone(maybeOut)) {
      return yield* Effect.die(new Error('A worker needs WORKER_OUT'))
    }
    const out = maybeOut.value
    if (setup.waveFlag === undefined) {
      yield* writeJsonFile(
        RunResults,
        out,
        globalThis.Array.from({ length: to - from }, (_, offset) =>
          runOnce(seedAt(setup, from + offset), setup.options),
        ),
      )
    } else {
      yield* writeJsonFile(
        WaveRuns,
        out,
        playWavePass(
          {
            waves: waveList(setup.waveFlag),
            runs: setup.runs,
            slots: setup.slots,
            firstSeed: setup.firstSeed,
            seedOffset: setup.seedOffset,
          },
          setup.options,
          slot => slot >= slotFrom && slot < slotTo && slot % to === from,
        ),
      )
    }
  })

const SELF = fileURLToPath(import.meta.url)

// NOTE: plays one worker's share in a child process and reads back what it
// wrote, decoded with `schema`.
const runWorker = <A>(
  schema: Schema.ConstraintDecoder<ReadonlyArray<A>>,
  slice: string,
  index: number,
  slotRange?: string,
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const out = `/tmp/simulate-${process.pid}-${index}.json`
    const code = yield* spawner
      .exitCode(
        ChildProcess.make(process.execPath, [SELF, ...argv], {
          env: {
            WORKER_SLICE: slice,
            WORKER_OUT: out,
            ...(slotRange === undefined ? {} : { WORKER_SLOTS: slotRange }),
          },
          extendEnv: true,
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
          detached: false,
        }),
      )
      .pipe(
        Effect.mapError(error => WorkerFailed.make({ message: error.message })),
      )
    if (code !== 0) {
      return yield* WorkerFailed.make({
        message: `worker ${index} exited with ${globalThis.String(code)}`,
      })
    }
    return yield* readJsonFile(schema, out)
  })

const playRange = (setup: Setup, workers: number, first: number, end: number) =>
  Effect.gen(function* () {
    if (workers === 1) {
      return globalThis.Array.from({ length: end - first }, (_, offset) =>
        runOnce(seedAt(setup, first + offset), setup.options),
      )
    }
    const per = Math.ceil((end - first) / workers)
    const slices = Array.filter(
      globalThis.Array.from(
        { length: workers },
        (_, index) =>
          [
            first + index * per,
            Math.min(end, first + (index + 1) * per),
          ] as const,
      ),
      ([from, to]) => to > from,
    )
    const outputs = yield* Effect.all(
      Array.map(slices, ([from, to], index) =>
        runWorker(RunResults, `${from}:${to}`, index),
      ),
      { concurrency: 'unbounded' },
    )
    return Array.flatten(outputs)
  })

// NOTE: the guard may give a later chunk more or fewer workers. Returns the
// workers for the next chunk.
const yieldTurn = (label: string, workers: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const current = yield* Ref.get(workers)
    const maybeNext = yield* turn.yieldTurn(label)
    yield* Ref.set(
      workers,
      Option.getOrElse(maybeNext, () => current),
    )
  })

// NOTE: plays the runs in chunks, in seed order, yielding the guard's turn
// between chunks. Run i is always seed i, so the results do not depend on
// where the chunks fall.
const playAll = (setup: Setup, workers: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const results: Array<RunResult> = []
    for (let done = 0; done < setup.runs;) {
      if (done > 0) {
        yield* yieldTurn(`${done} of ${setup.runs} runs`, workers)
      }
      const count = yield* Ref.get(workers)
      const [from, to] = nextChunk(
        done,
        setup.runs,
        setup.isChunked ? turn.chunkRuns(count) : 0,
      )
      results.push(...(yield* playRange(setup, count, from, to)))
      done = to
    }
    return results
  })

const playSlots = (
  setup: Setup,
  workers: number,
  waves: Array<number>,
  slotFrom: number,
  slotTo: number,
) =>
  Effect.gen(function* () {
    const pass = {
      waves,
      runs: setup.runs,
      slots: setup.slots,
      firstSeed: setup.firstSeed,
      seedOffset: setup.seedOffset,
    }
    const count = Math.min(workers, slotTo - slotFrom)
    if (count === 1) {
      return playWavePass(
        pass,
        setup.options,
        slot => slot >= slotFrom && slot < slotTo,
      )
    }
    const outputs = yield* Effect.all(
      globalThis.Array.from({ length: count }, (_, index) =>
        runWorker(
          WaveRuns,
          `${index}:${count}`,
          index,
          `${slotFrom}:${slotTo}`,
        ),
      ),
      { concurrency: 'unbounded' },
    )
    return Array.flatten(outputs)
  })

// NOTE: a wave pass chunks by snapshot slot, one slot a worker, so each
// slot's snapshots are found once. The runs are sorted by wave and run, so
// the order never depends on the chunks or the workers.
const playWaves = (
  setup: Setup,
  workers: Ref.Ref<number>,
  waves: Array<number>,
) =>
  Effect.gen(function* () {
    const waveRuns: Array<WaveRun> = []
    for (let done = 0; done < setup.slots;) {
      if (done > 0) {
        yield* yieldTurn(`${done} of ${setup.slots} snapshot slots`, workers)
      }
      const count = yield* Ref.get(workers)
      const [from, to] = nextChunk(
        done,
        setup.slots,
        setup.isChunked && turn.chunkRuns(count) > 0 ? count : 0,
      )
      waveRuns.push(...(yield* playSlots(setup, count, waves, from, to)))
      done = to
    }
    return waveRuns.sort(
      (first, second) =>
        first.wave - second.wave || first.waveSeed - second.waveSeed,
    )
  })

const writeJson = (setup: Setup, value: unknown) =>
  Effect.gen(function* () {
    if (setup.jsonOut !== undefined) {
      yield* writeJsonFile(Schema.Unknown, setup.jsonOut, value)
      yield* Console.log(`\nWrote the summary to ${setup.jsonOut}`)
    }
  })

// WAVE SNAPSHOT PASS

const reportWavePass = (
  setup: Setup,
  waves: Array<number>,
  waveRuns: Array<WaveRun>,
) =>
  Effect.gen(function* () {
    const pass = summary.summarizeWavePass(waveRuns, waves, {
      difficulty: setup.options.difficulty,
      style: styleOf(setup),
      runsPerWave: setup.runs,
      slots: setup.slots,
      wallSeconds: (performance.now() - setup.started) / 1000,
    })
    yield* Console.log(summary.formatWavePass(pass))
    for (const wave of waves) {
      const fights = Array.flatMap(waveRuns, ({ boss, outcome, ...run }) =>
        run.wave === wave && boss?.arrived === true
          ? [{ fight: boss, cleared: outcome === 'Cleared' }]
          : [],
      )
      if (fights.length === 0) {
        continue
      }
      const kills = Array.map(
        Array.filter(fights, ({ fight, cleared }) => cleared && fight.felled),
        ({ fight }) => fight.fightMs / 1000,
      )
      const sumOf = (pick: (fight: BossFight) => number) =>
        Array.reduce(fights, 0, (total, { fight }) => total + pick(fight))
      yield* Console.log(
        `\nBoss on wave ${wave}: arrived in ${fights.length}, felled in ${Array.filter(fights, ({ fight }) => fight.felled).length}, died with him standing ${Array.filter(fights, ({ fight }) => fight.diedToIt).length}, enraged in ${Array.filter(fights, ({ fight }) => fight.enraged).length}`,
      )
      yield* Console.log(
        `  kill time in cleared runs: median ${summary.median(kills).toFixed(1)} s (p25 ${summary.quantile(kills, 0.25).toFixed(1)}, p75 ${summary.quantile(kills, 0.75).toFixed(1)}, n=${kills.length}); health taken a second aimed at him ${(sumOf(fight => fight.damageTaken) / Math.max(1, sumOf(fight => fight.aimedMs) / 1000)).toFixed(2)}, a second of fight ${(sumOf(fight => fight.damageTaken) / Math.max(1, sumOf(fight => fight.fightMs) / 1000)).toFixed(2)}; hearts lost while he stood ${(sumOf(fight => fight.heartsLost) / fights.length).toFixed(2)} a fight`,
      )
    }
    yield* writeJson(setup, pass)
  })

// CAMPAIGN

const median = (values: Array<number>): number => summary.median(values)

const mean = (values: Array<number>): number =>
  values.length === 0
    ? 0
    : Array.reduce(values, 0, (a, b) => a + b) / values.length

const quantile = (values: Array<number>, q: number): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

const reportCampaign = (
  setup: Setup,
  results: Array<RunResult>,
  elapsed: number,
) =>
  Effect.gen(function* () {
    // NOTE: an escape runs past the ten tuned waves into the ramp, so the
    // campaign's tables go on to CAMPAIGN_REPORT_WAVES, a fixed count so
    // the nightly's metrics keep the same keys from run to run.
    const lastWave = setup.isEndless
      ? Math.max(...Array.map(results, result => result.cleared + 1))
      : Math.max(FINAL_WAVE, CAMPAIGN_REPORT_WAVES)
    yield* Console.log(
      `${setup.runs} ${setup.isEndless ? 'endless' : 'campaign'} runs on ${setup.options.difficulty} in ${elapsed.toFixed(1)} s${setup.options.noUpgrades ? ', no upgrades' : ''}${setup.options.swapsBack ? ', swaps back to the spare' : ''}${setup.kites ? ', kites the boss' : ''}`,
    )
    yield* Console.log('\nWave  reached  cleared')
    for (let wave = 1; wave <= lastWave; wave++) {
      const reached = Array.filter(
        results,
        result => result.cleared >= wave - 1,
      ).length
      const cleared = Array.filter(
        results,
        result => result.cleared >= wave,
      ).length
      yield* Console.log(
        `${String.padStart(4)(globalThis.String(wave))}  ${String.padStart(6)(((100 * reached) / setup.runs).toFixed(0))}%  ${String.padStart(6)(((100 * cleared) / setup.runs).toFixed(0))}%`,
      )
    }
    const deaths = Array.map(
      Array.filter(results, result => !result.escaped),
      result => result.cleared + 1,
    )
    const wins = Array.filter(results, result => result.escaped)
    yield* Console.log(
      '\nWave  died  hearts lost  pressure s  relax s  length s  peak alive  (means over runs that played the wave)',
    )
    for (let wave = 1; wave <= lastWave; wave++) {
      const logs = Array.flatMap(results, r =>
        Array.fromNullishOr(r.waves[wave - 1]),
      )
      const died = Array.filter(deaths, death => death === wave).length
      yield* Console.log(
        `${String.padStart(4)(globalThis.String(wave))}  ${String.padStart(3)(((100 * died) / setup.runs).toFixed(0))}%  ${String.padStart(
          11,
        )(
          mean(Array.map(logs, l => l.heartsLost)).toFixed(2),
        )}  ${String.padStart(10)(
          mean(Array.map(logs, l => l.pressureMs / 1000)).toFixed(1),
        )}  ${String.padStart(7)(
          mean(Array.map(logs, l => l.relaxMs / 1000)).toFixed(1),
        )}  ${String.padStart(8)(
          mean(Array.map(logs, l => l.lengthMs / 1000)).toFixed(0),
        )}  ${String.padStart(10)(
          mean(Array.map(logs, l => l.peakAlive)).toFixed(1),
        )}`,
      )
    }
    yield* Console.log(`\nEscapes: ${wins.length} of ${setup.runs}`)
    yield* Console.log(
      `Close calls: ${Array.filter(wins, r => r.minHp <= 1).length} of ${wins.length} wins reached 1 heart`,
    )
    yield* Console.log(`Median wave of death: ${median(deaths)}`)
    if (!setup.isEndless) {
      const listDone = Array.filter(
        Array.map(results, r => r.escape.listDoneWave),
        wave => wave > 0,
      )
      const keys = Array.filter(
        Array.map(results, r => r.escape.keyWave),
        wave => wave > 0,
      )
      // NOTE: the finale: runs Uncle Chunk came in, those he ended (the run
      // over with him still standing), and his fight's length.
      const met = Array.filter(results, r => r.escape.chunkWave > 0)
      const killedByChunk = Array.filter(
        met,
        r => !r.escaped && r.escape.keyWave === 0,
      )
      const fights = Array.filter(
        Array.map(results, r => r.escape.chunkFightMs / 1000),
        seconds => seconds > 0,
      )
      yield* Console.log(
        `Escape: list done in ${listDone.length} runs (median wave ${listDone.length > 0 ? median(listDone) : '-'}), Chunk felled in ${keys.length} (median wave ${keys.length > 0 ? median(keys) : '-'}), escaped on wave ${wins.length > 0 ? median(Array.map(wins, r => r.cleared + 1)) : '-'} (median)`,
      )
      yield* Console.log(
        `Finale: Chunk came in ${met.length} runs and ended ${killedByChunk.length} (${met.length > 0 ? Math.round((100 * killedByChunk.length) / met.length) : 0}%), his fight ${fights.length > 0 ? median(fights).toFixed(0) : '-'} s (median, felled)`,
      )
      yield* Console.log(
        `Escape: things found a run median ${median(Array.map(results, r => r.escape.found))}, cases opened median ${median(Array.map(results, r => r.escape.casesOpened))}`,
      )
      // NOTE: the wave the bot bought its first room open in, its second,
      // and so on, the median over the runs that opened that many.
      const roomWaves = Array.map(Array.range(0, 3), index => {
        const waves = Array.getSomes(
          Array.map(results, r => Array.get(r.escape.openedWaves, index)),
        )
        return `room ${index + 1}: ${waves.length > 0 ? median(waves) : '-'} (${waves.length} runs)`
      })
      yield* Console.log(
        `Escape: rooms opened by wave (median), ${Array.join(roomWaves, ', ')}`,
      )
    }
    if (setup.isEndless) {
      const reached = Array.map(results, result => result.cleared + 1)
      yield* Console.log(
        `Endless wave reached: median ${median(reached)}, best ${Math.max(...reached)}, worst ${Math.min(...reached)}`,
      )
    }
    yield* Console.log(
      `Gun levels at the end: spare tier median ${median(Array.map(results, r => r.spareTier))}, pistol tier median ${median(Array.map(results, r => r.pistolTier))}`,
    )
    yield* Console.log(
      `Gnomes placed per run: median ${median(Array.map(results, r => r.gnomesPlaced))}, most ${Math.max(...Array.map(results, r => r.gnomesPlaced))}`,
    )
    const kitchenWaves = Array.filter(
      Array.map(results, r => r.kitchenWave),
      wave => wave > 0,
    )
    yield* Console.log(
      `Kitchen bought: ${((100 * kitchenWaves.length) / Math.max(1, results.length)).toFixed(0)}% of runs, in the break before wave ${kitchenWaves.length > 0 ? median(kitchenWaves) : '-'} (median)`,
    )
    const pullers = Array.filter(results, r => r.fridge.pulls > 0)
    const countsJson = encodeJson(Schema.Record(Schema.String, Schema.Finite))
    const emptyCounts = (): Record<string, number> => ({})
    const fridgeTotals = Array.reduce(
      results,
      {
        prizes: emptyCounts(),
        ended: emptyCounts(),
        lids: 0,
        pops: 0,
        swings: 0,
        clangs: 0,
        sprays: 0,
        shatters: 0,
        taken: 0,
        stabs: 0,
        stabHits: 0,
      },
      (totals, { fridge }) => {
        Array.forEach(Record.toEntries(fridge.prizes), ([prize, count]) => {
          totals.prizes[prize] = (totals.prizes[prize] ?? 0) + count
        })
        totals.ended[fridge.endedWith] =
          (totals.ended[fridge.endedWith] ?? 0) + 1
        totals.lids += fridge.lids
        totals.pops += fridge.pops
        totals.swings += fridge.swings
        totals.clangs += fridge.clangs
        totals.sprays += fridge.sprays
        totals.shatters += fridge.shatters
        totals.taken += fridge.taken
        totals.stabs += fridge.stabs
        totals.stabHits += fridge.stabHits
        return totals
      },
    )
    const fridgeWins = (prize: string) =>
      Array.filter(results, r => (r.fridge.prizes[prize] ?? 0) > 0)
    yield* Console.log(
      `Fridge: pulled in ${((100 * pullers.length) / Math.max(1, results.length)).toFixed(0)}% of runs, ${Array.reduce(results, 0, (sum, r) => sum + r.fridge.pulls)} pulls, first in the break before wave ${pullers.length > 0 ? median(Array.map(pullers, r => r.fridge.firstPullWave)) : '-'} (median)`,
    )
    yield* Console.log(
      `Fridge prizes: ${countsJson(fridgeTotals.prizes)}; carried at the end: ${countsJson(fridgeTotals.ended)}`,
    )
    yield* Console.log(
      `Fridge weapons taken: ${fridgeTotals.taken}. Knife: ${fridgeTotals.stabs} stabs, ${fridgeTotals.stabHits} hits (${(fridgeTotals.stabs / Math.max(1, results.length)).toFixed(1)} stabs a run).`,
    )
    yield* Console.log(
      `Fridge weapons: ${fridgeTotals.lids} lids, ${fridgeTotals.pops} pops, ${fridgeTotals.swings} swings (${fridgeTotals.clangs} clangs), ${fridgeTotals.sprays} sprays, ${fridgeTotals.shatters} shatters`,
    )
    yield* Console.log(
      `Wins by fridge weapon pulled: ${Array.join(
        Array.map(['Cooker', 'Pan', 'Freeze'], prize => {
          const pulled = fridgeWins(prize)
          return `${prize} ${Array.filter(pulled, r => r.escaped).length}/${pulled.length}`
        }),
        ', ',
      )}, none ${Array.filter(results, r => r.fridge.pulls === 0 && r.escaped).length}/${Array.filter(results, r => r.fridge.pulls === 0).length}`,
    )
    yield* Console.log(
      `Median run length: ${(median(Array.map(results, r => r.runMs)) / 60000).toFixed(2)} min`,
    )
    yield* Console.log(
      `Median win length: ${(median(Array.map(wins, r => r.runMs)) / 60000).toFixed(2)} min`,
    )
    yield* Console.log(
      '\nMoney earned by the end of wave (median of runs that cleared it)',
    )
    for (let wave = 1; wave <= lastWave; wave++) {
      const values = Array.flatMap(results, r =>
        Array.fromNullishOr(r.moneyAfterWave[wave - 1]),
      )
      if (values.length > 0) {
        yield* Console.log(`  wave ${wave}: $${median(values)}`)
      }
    }
    yield* Console.log(
      '\nShop visits: money on arrival (median, p25 to p75) and what the bot bought (share of visits)',
    )
    for (let wave = 2; wave <= lastWave; wave++) {
      const { money, visits, bought } = summary.tallyShopVisits(results, wave)
      if (visits === 0) {
        continue
      }
      const shares = Array.join(
        Array.map(
          bought,
          ([item, n]) => `${item} ${((100 * n) / visits).toFixed(0)}%`,
        ),
        ', ',
      )
      yield* Console.log(
        `  before wave ${wave}: $${median([...money])} ($${quantile([...money], 0.25)} to $${quantile([...money], 0.75)}), n=${visits}: ${shares}`,
      )
    }
    const hurt = Array.reduce(results, emptyHurt(), (sum, r) => {
      Array.forEach(KINDS, kind => {
        sum[kind] += r.hurtBy[kind]
      })
      return sum
    })
    const totalHurt = Array.reduce(Record.values(hurt), 0, (a, b) => a + b)
    yield* Console.log('\nHearts lost by kind')
    for (const kind of KINDS) {
      yield* Console.log(
        `  ${String.padEnd(9)(kind)} ${String.padStart(5)(globalThis.String(hurt[kind]))}  ${((100 * hurt[kind]) / Math.max(1, totalHurt)).toFixed(0)}%`,
      )
    }

    const pickupKinds = [
      ...new Set(
        Array.flatMap(results, r => [
          ...Record.keys(r.dropped),
          ...Record.keys(r.grabbed),
        ]),
      ),
    ].sort()
    const sumOf = (
      pick: (r: RunResult) => Record<string, number>,
      kind: string,
    ) => Array.reduce(results, 0, (sum, r) => sum + (pick(r)[kind] ?? 0))
    const totalDropped = Array.reduce(
      pickupKinds,
      0,
      (sum, kind) => sum + sumOf(r => r.dropped, kind),
    )
    const totalGrabbed = Array.reduce(
      pickupKinds,
      0,
      (sum, kind) => sum + sumOf(r => r.grabbed, kind),
    )
    yield* Console.log(
      `\nPickups: ${(totalDropped / setup.runs).toFixed(1)} dropped and ${(totalGrabbed / setup.runs).toFixed(1)} grabbed a run${setup.ignoresPickups ? ' (the bot ignores them)' : ''}, boosted ${(
        (100 * Array.reduce(results, 0, (sum, r) => sum + r.boostedMs)) /
        Math.max(
          1,
          Array.reduce(results, 0, (sum, r) => sum + r.waveMs),
        )
      ).toFixed(0)}% of wave time`,
    )
    for (const kind of pickupKinds) {
      yield* Console.log(
        `  ${String.padEnd(9)(kind)} dropped ${String.padStart(5)(globalThis.String(sumOf(r => r.dropped, kind)))}  grabbed ${String.padStart(5)(globalThis.String(sumOf(r => r.grabbed, kind)))}`,
      )
    }

    const fights = Array.flatMap(results, r => r.boss)
    const fightWaves = [
      ...new Set(Array.map(fights, fight => fight.wave)),
    ].sort((a, b) => a - b)
    yield* Console.log('\nBoss fights (per boss wave reached)')
    for (const bossWave of fightWaves) {
      const atWave = Array.filter(fights, fight => fight.wave === bossWave)
      const arrived = Array.filter(atWave, fight => fight.arrived)
      const felled = Array.filter(atWave, fight => fight.felled)
      const diedTo = Array.filter(atWave, fight => fight.diedToIt)
      const diedAtWave = Array.filter(
        results,
        r => !r.escaped && r.cleared + 1 === bossWave,
      ).length
      const perFight = (pick: (fight: BossFight) => number) =>
        (
          Array.reduce(arrived, 0, (sum, fight) => sum + pick(fight)) /
          Math.max(1, arrived.length)
        ).toFixed(1)
      const share = (part: number, whole: number) =>
        `${((100 * part) / Math.max(1, whole)).toFixed(0)}%`
      const sum = (pick: (fight: BossFight) => number) =>
        Array.reduce(arrived, 0, (total, fight) => total + pick(fight))
      const wonKills = Array.map(
        Array.filter(
          Array.flatMap(
            Array.filter(
              results,
              (r: RunResult) => r.escaped || r.cleared >= bossWave,
            ),
            (r: RunResult) => r.boss,
          ),
          (fight: BossFight) => fight.wave === bossWave && fight.felled,
        ),
        (fight: BossFight) => fight.fightMs,
      )
      const lostToBoss = sum(fight => fight.heartsLost)
      const waveHearts = Array.reduce(
        results,
        0,
        (total, r) => total + (r.waves[bossWave - 1]?.heartsLost ?? 0),
      )
      yield* Console.log(
        `  wave ${bossWave}: reached ${atWave.length}, boss arrived ${arrived.length}, felled ${felled.length}, runs that died with it standing ${diedTo.length} of ${diedAtWave} deaths on the wave`,
      )
      yield* Console.log(
        `    fight: median ${(median(Array.map(arrived, fight => fight.fightMs)) / 1000).toFixed(1)} s, kill time in runs that cleared the wave median ${(median(wonKills) / 1000).toFixed(1)} s (p25 ${(quantile(wonKills, 0.25) / 1000).toFixed(1)}, p75 ${(quantile(wonKills, 0.75) / 1000).toFixed(1)}, n=${wonKills.length}), enraged in ${share(Array.filter(arrived, fight => fight.enraged).length, arrived.length)}`,
      )
      yield* Console.log(
        `    a fight: stomps ${perFight(fight => fight.stomps)} (${share(
          sum(fight => fight.stompHits),
          sum(fight => fight.stomps),
        )} hit), charges ${perFight(fight => fight.charges)} (${share(
          sum(fight => fight.chargeHits),
          sum(fight => fight.charges),
        )} hit, ${share(
          sum(fight => fight.bonks),
          sum(fight => fight.charges),
        )} bonked), spits ${perFight(fight => fight.spits)} (${share(
          sum(fight => fight.spitHits),
          sum(fight => fight.spits),
        )} hit), belches ${perFight(fight => fight.belches)}`,
      )
      yield* Console.log(
        `    his health taken a second of fight ${(sum(fight => fight.damageTaken) / Math.max(1, sum(fight => fight.fightMs) / 1000)).toFixed(2)}, a second aimed at him ${(sum(fight => fight.damageTaken) / Math.max(1, sum(fight => fight.aimedMs) / 1000)).toFixed(2)}, aimed at him ${share(
          sum(fight => fight.aimedMs),
          sum(fight => fight.fightMs),
        )} of the fight`,
      )
      yield* Console.log(
        `    hearts lost while he stood ${lostToBoss} (${share(lostToBoss, waveHearts)} of the wave's ${waveHearts}): stomp ${sum(fight => fight.heartsByAttack.Stomp)}, slam ${sum(fight => fight.heartsByAttack.Slam)}, charge ${sum(fight => fight.heartsByAttack.Charge)}, glob ${sum(fight => fight.heartsByAttack.Glob)}, his bite ${sum(fight => fight.heartsByAttack.Bite)}, the rest to the crowd`,
      )
    }

    const newKindTotal = (pick: (log: NewKindLog) => number) =>
      Array.reduce(results, 0, (sum, r) => sum + pick(r.newKinds))
    const perRun = (pick: (log: NewKindLog) => number) =>
      (newKindTotal(pick) / Math.max(1, setup.runs)).toFixed(1)
    yield* Console.log('\nNew kinds and frenzy (per run)')
    yield* Console.log(
      `  Big Leaguer throws ${perRun(log => log.throws)}, shields ${perRun(log => log.shields)}, landed on the bot ${perRun(log => log.throwHits)} (${(
        (100 * newKindTotal(log => log.throwHits)) /
        Math.max(
          1,
          newKindTotal(log => log.throws),
        )
      ).toFixed(0)}%)`,
    )
    yield* Console.log(
      `  Ankle Biters surfaced ${perRun(log => log.surfaced)}, grabbed the bot ${perRun(log => log.grabs)}, hearts lost while held ${perRun(log => log.heartsWhileClung)}`,
    )
    yield* Console.log(
      `  Frenzied packs ${perRun(log => log.frenzies)}, wiped for the bonus ${perRun(log => log.wipes)}, bonus paid $${perRun(log => log.wipeBonus)}`,
    )

    yield* Console.log(
      `\nMost zombies on screen at once: median ${median(Array.map(results, r => r.maxAlive))}, worst ${Math.max(...Array.map(results, r => r.maxAlive))}`,
    )
    if (setup.hasTimeline) {
      yield* reportTimelines(results, lastWave)
    }
    if (setup.hasEndReport) {
      yield* printEndReport(results)
    }

    yield* writeJson(
      setup,
      summary.summarizeCampaign(results, {
        difficulty: setup.options.difficulty,
        kind: setup.options.mode,
        style: styleOf(setup),
        wallSeconds: elapsed,
        lastWave,
      }),
    )
  })

// TIMELINE

const seconds = (ms: number) => (ms / 1000).toFixed(1)

const printTimeline = (result: RunResult) =>
  Effect.gen(function* () {
    yield* Console.log(
      `\nTimeline of seed ${result.seed} (wall seconds from wave start)`,
    )
    for (const [index, timeline] of result.timelines.entries()) {
      const gaps = Array.map(
        timeline.packs.slice(1),
        (arrival, at) => arrival.atMs - (timeline.packs[at]?.atMs ?? 0),
      )
      yield* Console.log(
        `  Wave ${index + 1}: ${seconds(timeline.lengthMs)} s, ${timeline.packs.length} packs, rests ${Array.join(Array.map(timeline.restMs, seconds), ', ') || 'none'}, longest gap between packs ${seconds(Math.max(0, ...gaps))} s`,
      )
      yield* Console.log(
        `    ${Array.join(
          Array.map(
            timeline.packs,
            arrival =>
              `${seconds(arrival.atMs)} ${arrival.door[0]}${arrival.size}${arrival.formation === 'Squad' || arrival.formation === 'Trickle' ? '' : arrival.formation[0]}${new Set(arrival.kinds).size > 1 ? '*' : ''}`,
          ),
          '  ',
        )}`,
      )
      const empties = Array.filter(
        timeline.empty,
        stretch => stretch.ms >= 1000,
      )
      if (empties.length > 0) {
        yield* Console.log(
          `    empty room: ${Array.join(
            Array.map(
              empties,
              stretch =>
                `${seconds(stretch.fromMs)} for ${seconds(stretch.ms)} (quiet ${seconds(quietPartMs(stretch))})`,
            ),
            ', ',
          )}`,
        )
      }
    }
  })

const reportTimelines = (results: Array<RunResult>, lastWave: number) =>
  Effect.gen(function* () {
    const firstResult = results[0]
    if (firstResult === undefined) {
      return
    }
    yield* printTimeline(firstResult)
    yield* Console.log(
      '\nWave  first pack s  packs  sizes (min to max, distinct)  empty s  longest empty s  longest quiet s (mean, worst)  rests s',
    )
    for (let wave = 1; wave <= lastWave; wave++) {
      const timelines = Array.flatMap(results, r =>
        Array.fromNullishOr(r.timelines[wave - 1]),
      )
      if (timelines.length === 0) {
        continue
      }
      const sizes = Array.flatMap(timelines, t =>
        Array.map(t.packs, p => p.size),
      )
      const distinct = mean(
        Array.map(
          timelines,
          t => new Set(Array.map(t.packs, p => p.size)).size,
        ),
      )
      const longestQuiet = Array.map(timelines, t =>
        Math.max(0, ...Array.map(t.empty, quietPartMs)),
      )
      yield* Console.log(
        `${String.padStart(4)(globalThis.String(wave))}  ${String.padStart(12)(seconds(mean(Array.map(timelines, t => t.packs[0]?.atMs ?? 0))))}  ${String.padStart(
          5,
        )(
          mean(Array.map(timelines, t => t.packs.length)).toFixed(1),
        )}  ${String.padStart(29)(`${Math.min(...sizes)} to ${Math.max(...sizes)}, ${distinct.toFixed(1)}`)}  ${String.padStart(
          7,
        )(
          seconds(
            mean(
              Array.map(timelines, t =>
                Array.reduce(t.empty, 0, (sum, e) => sum + e.ms),
              ),
            ),
          ),
        )}  ${String.padStart(15)(
          seconds(
            mean(
              Array.map(timelines, t =>
                Math.max(0, ...Array.map(t.empty, e => e.ms)),
              ),
            ),
          ),
        )}  ${String.padStart(30)(`${seconds(mean(longestQuiet))}, ${seconds(Math.max(...longestQuiet))}`)}  ${seconds(mean(Array.flatMap(timelines, t => t.restMs)))}`,
      )
    }
  })

// THE BATCH

const program = Effect.gen(function* () {
  const config = yield* SimulateConfig
  if (Option.isSome(config.maybeTune)) {
    yield* applyTune(config.maybeTune.value)
  }
  const isFlagSet = (maybe: Option.Option<string>) => Option.isSome(maybe)
  const seedOffset = Number(flagValue('--seed-offset') ?? 0)
  if (!Number.isInteger(seedOffset) || seedOffset < 0) {
    return yield* Effect.die(
      new Error('--seed-offset must be a whole number of runs, 0 or more'),
    )
  }
  const isEndless = Option.contains(config.maybeMode, 'endless')
  const setup: Setup = {
    options: {
      ...DEFAULT_OPTIONS,
      difficulty: parseDifficulty(
        Option.getOrUndefined(config.maybeDifficulty),
      ),
      mode: isEndless ? 'Endless' : 'Campaign',
      swapsBack: isFlagSet(config.maybeSwap),
      noUpgrades: isFlagSet(config.maybeNoUpgrades),
      calling: parseCalling(Option.getOrUndefined(config.maybeCalling)),
      modifiers: parseModifiers(Option.getOrUndefined(config.maybeMods)),
      dareMark: parseDareMark(Option.getOrUndefined(config.maybeMark)),
    },
    isEndless,
    kites: isFlagSet(config.maybeKite),
    ignoresPickups: isFlagSet(config.maybeNoPickups),
    hasTimeline: isFlagSet(config.maybeTimeline),
    hasEndReport: isFlagSet(config.maybeEndReport),
    waveFlag: flagValue('--wave'),
    jsonOut: flagValue('--json'),
    runs: Number(flagValue('--runs') ?? positional[0] ?? 40),
    firstSeed: Number(flagValue('--first-seed') ?? positional[1] ?? 1),
    seedOffset,
    slots: Number(flagValue('--slots') ?? 10),
    isChunked: turn.isUnderGuard(),
    started: performance.now(),
  }

  if (Option.isSome(config.maybeWorkerSlice)) {
    return yield* playAsWorker(
      setup,
      config.maybeWorkerSlice.value,
      config.maybeWorkerSlots,
      config.maybeWorkerOut,
    )
  }

  const workers = yield* Ref.make(
    Math.max(1, Number(Option.getOrElse(config.maybeWorkers, () => '1'))),
  )

  if (setup.waveFlag !== undefined) {
    const waves = waveList(setup.waveFlag)
    const waveRuns = yield* playWaves(setup, workers, waves)
    return yield* reportWavePass(setup, waves, waveRuns)
  }

  const results = yield* playAll(setup, workers)
  const elapsed = (performance.now() - setup.started) / 1000
  yield* reportCampaign(setup, results, elapsed)
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
