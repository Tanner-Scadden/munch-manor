// Headless balance simulation. Run it from the repo root through the heavy
// guard (tools/heavy), never directly:
//   bun run balance [runs] [firstSeed]
//   MODE=endless bun run balance [runs] [firstSeed]
//   WORKERS=4 bun run balance 200   (splits the runs over processes, capped)
//   TIMELINE=1 bun run balance 40   (adds the wave timeline audit)
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

import { Data, Effect, Predicate, Schema } from 'effect'
import { Window } from 'happy-dom'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { encodeJson, readJsonFile, writeJsonFile } from '../json'
import type { BotOptions } from './bot/basics'
import type { BossFight, NewKindLog, RunResult, WaveRun } from './bot/results'

const browserWindow = new Window()
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  __BUILD_ID__: 'dev',
})

const { DEFAULT_OPTIONS, parseDifficulty } = await import('./bot/basics')
const { KINDS, emptyHurt, quietPartMs } = await import('./bot/logs')
const { RunResults, WaveRuns } = await import('./bot/results')
const { runOnce, seedAt: seedFrom } = await import('./bot')
const { playWavePass } = await import('./bot/snapshots')
const { FINAL_WAVE } = await import('../../src/wavePlans')
const summary = await import('./summary')
const turn = await import('../heavy/turn')
const { nextChunk } = await import('../heavy/decision')

// TUNE=path/to/tune.ts loads a module whose default export edits the
// tables in place before the runs, so a balance idea can be tried without
// touching src. Bake the winning numbers into src afterwards.
// NOTE: the tables a tune module may edit in place.
const tuneTables = async () => ({
  WAVE_PLANS: (await import('../../src/wavePlans')).WAVE_PLANS,
  ZOMBIE_KINDS: (await import('../../src/zombies')).ZOMBIE_KINDS,
  SHOP_ITEMS: (await import('../../src/shop')).SHOP_ITEMS,
  WEAPONS: (await import('../../src/weapons')).WEAPONS,
  UPGRADE_TIERS: (await import('../../src/weapons')).UPGRADE_TIERS,
  TRAPS: (await import('../../src/traps')).TRAPS,
  DROP_CHANCE: (await import('../../src/powerups')).DROP_CHANCE,
  DROP_RULES: (await import('../../src/powerups')).DROP_RULES,
  BOOSTS: (await import('../../src/powerups')).BOOSTS,
  PICKUPS: (await import('../../src/powerups')).PICKUPS,
  BOSS_RULES: (await import('../../src/boss')).BOSS_RULES,
  CHUCKER_RULES: (await import('../../src/chucker')).CHUCKER_RULES,
  CRAWLER_RULES: (await import('../../src/crawler')).CRAWLER_RULES,
  FRENZY_RULES: (await import('../../src/frenzy')).FRENZY_RULES,
  BAIT_RULES: (await import('../../src/traps')).BAIT_RULES,
  DIFFICULTIES: (await import('../../src/difficulty')).DIFFICULTIES,
})
type TuneTables = Awaited<ReturnType<typeof tuneTables>>

// NOTE: a tune module is the caller's own script: its default export is
// checked to be a function, and is trusted to take the tables.
const TuneModule = Schema.Struct({
  default: Schema.declare(
    (value: unknown): value is (tables: TuneTables) => void =>
      Predicate.isFunction(value),
  ),
})
const TUNE = process.env['TUNE']
if (TUNE !== undefined) {
  const tunePath = TUNE.startsWith('/') ? TUNE : `${process.cwd()}/${TUNE}`
  const tune = Schema.decodeUnknownSync(TuneModule)(await import(tunePath))
  tune.default(await tuneTables())
}

// ARGUMENTS

const argv = process.argv.slice(2)
const flagValue = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const positional = argv.filter(
  (arg, index) =>
    !arg.startsWith('--') && argv[index - 1]?.startsWith('--') !== true,
)

const IS_ENDLESS = process.env['MODE'] === 'endless'
const OPTIONS: BotOptions = {
  ...DEFAULT_OPTIONS,
  difficulty: parseDifficulty(process.env['DIFFICULTY']),
  mode: IS_ENDLESS ? 'Endless' : 'Campaign',
  swapsBack: process.env['SWAP'] !== undefined,
  noUpgrades: process.env['NO_UPGRADES'] !== undefined,
}
const DIFFICULTY = OPTIONS.difficulty
const SWAPS_BACK = OPTIONS.swapsBack
const NO_UPGRADES = OPTIONS.noUpgrades
const KITES = process.env['KITE'] !== undefined
const IGNORES_PICKUPS = process.env['NO_PICKUPS'] !== undefined
const WAVE_FLAG = flagValue('--wave')
const JSON_OUT = flagValue('--json')
const runs = Number(flagValue('--runs') ?? positional[0] ?? 40)
const firstSeed = Number(flagValue('--first-seed') ?? positional[1] ?? 1)
const seedOffset = Number(flagValue('--seed-offset') ?? 0)
if (!Number.isInteger(seedOffset) || seedOffset < 0) {
  throw new Error('--seed-offset must be a whole number of runs, 0 or more')
}
const slots = Number(flagValue('--slots') ?? 10)
const seedAt = (index: number) => seedFrom(firstSeed, seedOffset + index)
const WORKERS = Math.max(1, Number(process.env['WORKERS'] ?? 1))
const IS_CHUNKED = turn.isUnderGuard()
const started = performance.now()
const STYLE = SWAPS_BACK ? 'SwapsBack' : 'Default'

const waveList = (flag: string): Array<number> => {
  if (flag === 'all') {
    return Array.from({ length: FINAL_WAVE }, (_, index) => index + 1)
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
  const [from, to] = text.split(':').map(Number)
  if (from === undefined || to === undefined) {
    throw new Error(`Expected from:to, got ${text}`)
  }
  return [from, to]
}

const WORKER_SLICE = process.env['WORKER_SLICE']
if (WORKER_SLICE !== undefined) {
  const [from, to] = rangeFrom(WORKER_SLICE)
  const [slotFrom, slotTo] = rangeFrom(
    process.env['WORKER_SLOTS'] ?? `0:${slots}`,
  )
  const out = process.env['WORKER_OUT']
  if (out === undefined) {
    throw new Error('A worker needs WORKER_OUT')
  }
  if (WAVE_FLAG === undefined) {
    writeJsonFile(
      RunResults,
      out,
      Array.from({ length: to - from }, (_, offset) =>
        runOnce(seedAt(from + offset), OPTIONS),
      ),
    )
  } else {
    writeJsonFile(
      WaveRuns,
      out,
      playWavePass(
        { waves: waveList(WAVE_FLAG), runs, slots, firstSeed, seedOffset },
        OPTIONS,
        slot => slot >= slotFrom && slot < slotTo && slot % to === from,
      ),
    )
  }
  process.exit(0)
}

const SELF = fileURLToPath(import.meta.url)

class WorkerFailed extends Data.TaggedError('WorkerFailed')<{
  message: string
}> {}

// NOTE: plays one worker's share in a child process and reads back what it
// wrote, decoded with `schema`.
const runWorker = <A>(
  schema: Schema.ConstraintDecoder<ReadonlyArray<A>>,
  slice: string,
  index: number,
  slotRange?: string,
): Promise<ReadonlyArray<A>> =>
  Effect.runPromise(
    Effect.callback<ReadonlyArray<A>, WorkerFailed>(resume => {
      const out = `/tmp/simulate-${process.pid}-${index}.json`
      const child = spawn(process.execPath, [SELF, ...argv], {
        env: {
          ...process.env,
          WORKER_SLICE: slice,
          WORKER_OUT: out,
          ...(slotRange === undefined ? {} : { WORKER_SLOTS: slotRange }),
        },
        stdio: 'inherit',
      })
      child.on('error', error =>
        resume(Effect.fail(new WorkerFailed({ message: error.message }))),
      )
      child.on('exit', code =>
        resume(
          code === 0
            ? Effect.sync(() => readJsonFile(schema, out))
            : Effect.fail(
                new WorkerFailed({
                  message: `worker ${index} exited with ${String(code)}`,
                }),
              ),
        ),
      )
    }),
  )

// NOTE: the guard may give a later chunk more or fewer workers.
let workers = WORKERS

const playRange = async (
  first: number,
  end: number,
): Promise<Array<RunResult>> => {
  if (workers === 1) {
    return Array.from({ length: end - first }, (_, offset) =>
      runOnce(seedAt(first + offset), OPTIONS),
    )
  }
  const per = Math.ceil((end - first) / workers)
  const slices = Array.from(
    { length: workers },
    (_, index) =>
      [first + index * per, Math.min(end, first + (index + 1) * per)] as const,
  ).filter(([from, to]) => to > from)
  const outputs = await Promise.all(
    slices.map(([from, to], index) =>
      runWorker(RunResults, `${from}:${to}`, index),
    ),
  )
  return outputs.flat()
}

// NOTE: plays the runs in chunks, in seed order, yielding the guard's turn
// between chunks. Run i is always seed i, so the results do not depend on
// where the chunks fall.
const playAll = async (): Promise<Array<RunResult>> => {
  const results: Array<RunResult> = []
  for (let done = 0; done < runs;) {
    if (done > 0) {
      workers = await turn.yieldTurnAsync(`${done} of ${runs} runs`, workers)
    }
    const [from, to] = nextChunk(
      done,
      runs,
      IS_CHUNKED ? turn.chunkRuns(workers) : 0,
    )
    results.push(...(await playRange(from, to)))
    done = to
  }
  return results
}

const playSlots = async (
  waves: Array<number>,
  slotFrom: number,
  slotTo: number,
): Promise<Array<WaveRun>> => {
  const pass = { waves, runs, slots, firstSeed, seedOffset }
  const count = Math.min(workers, slotTo - slotFrom)
  if (count === 1) {
    return playWavePass(
      pass,
      OPTIONS,
      slot => slot >= slotFrom && slot < slotTo,
    )
  }
  const outputs = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      runWorker(WaveRuns, `${index}:${count}`, index, `${slotFrom}:${slotTo}`),
    ),
  )
  return outputs.flat()
}

// NOTE: a wave pass chunks by snapshot slot, one slot a worker, so each
// slot's snapshots are found once. The runs are sorted by wave and run, so
// the order never depends on the chunks or the workers.
const playWaves = async (waves: Array<number>): Promise<Array<WaveRun>> => {
  const waveRuns: Array<WaveRun> = []
  for (let done = 0; done < slots;) {
    if (done > 0) {
      workers = await turn.yieldTurnAsync(
        `${done} of ${slots} snapshot slots`,
        workers,
      )
    }
    const [from, to] = nextChunk(
      done,
      slots,
      IS_CHUNKED && turn.chunkRuns(workers) > 0 ? workers : 0,
    )
    waveRuns.push(...(await playSlots(waves, from, to)))
    done = to
  }
  return waveRuns.sort(
    (first, second) =>
      first.wave - second.wave || first.waveSeed - second.waveSeed,
  )
}

const writeJson = (value: unknown) => {
  if (JSON_OUT !== undefined) {
    writeJsonFile(Schema.Unknown, JSON_OUT, value)
    console.log(`\nWrote the summary to ${JSON_OUT}`)
  }
}

// WAVE SNAPSHOT PASS

if (WAVE_FLAG !== undefined) {
  const waves = waveList(WAVE_FLAG)
  const waveRuns = await playWaves(waves)
  const pass = summary.summarizeWavePass(waveRuns, waves, {
    difficulty: DIFFICULTY,
    style: STYLE,
    runsPerWave: runs,
    slots,
    wallSeconds: (performance.now() - started) / 1000,
  })
  console.log(summary.formatWavePass(pass))
  writeJson(pass)
  process.exit(0)
}

// CAMPAIGN

const median = (values: Array<number>): number => summary.median(values)

const results = await playAll()
const elapsed = (performance.now() - started) / 1000

const lastWave = IS_ENDLESS
  ? Math.max(...results.map(result => result.cleared + 1))
  : FINAL_WAVE
console.log(
  `${runs} ${IS_ENDLESS ? 'endless' : 'campaign'} runs on ${DIFFICULTY} in ${elapsed.toFixed(1)} s${NO_UPGRADES ? ', no upgrades' : ''}${SWAPS_BACK ? ', swaps back to the spare' : ''}${KITES ? ', kites the boss' : ''}`,
)
console.log('\nWave  reached  cleared')
for (let wave = 1; wave <= lastWave; wave++) {
  const reached = results.filter(result => result.cleared >= wave - 1).length
  const cleared = results.filter(result => result.cleared >= wave).length
  console.log(
    `${String(wave).padStart(4)}  ${((100 * reached) / runs).toFixed(0).padStart(6)}%  ${((100 * cleared) / runs).toFixed(0).padStart(6)}%`,
  )
}
const deaths = results
  .filter(result => !result.victory)
  .map(result => result.cleared + 1)
const wins = results.filter(result => result.victory)
const mean = (values: Array<number>): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
console.log(
  '\nWave  died  hearts lost  pressure s  relax s  length s  peak alive  (means over runs that played the wave)',
)
for (let wave = 1; wave <= lastWave; wave++) {
  const logs = results.flatMap(r => r.waves[wave - 1] ?? [])
  const died = deaths.filter(death => death === wave).length
  console.log(
    `${String(wave).padStart(4)}  ${((100 * died) / runs).toFixed(0).padStart(3)}%  ${mean(
      logs.map(l => l.heartsLost),
    )
      .toFixed(2)
      .padStart(11)}  ${mean(logs.map(l => l.pressureMs / 1000))
      .toFixed(1)
      .padStart(10)}  ${mean(logs.map(l => l.relaxMs / 1000))
      .toFixed(1)
      .padStart(7)}  ${mean(logs.map(l => l.lengthMs / 1000))
      .toFixed(0)
      .padStart(8)}  ${mean(logs.map(l => l.peakAlive))
      .toFixed(1)
      .padStart(10)}`,
  )
}
console.log(`\nVictories: ${wins.length} of ${runs}`)
console.log(
  `Close calls: ${wins.filter(r => r.minHp <= 1).length} of ${wins.length} wins reached 1 heart`,
)
console.log(`Median wave of death: ${median(deaths)}`)
if (IS_ENDLESS) {
  const reached = results.map(result => result.cleared + 1)
  console.log(
    `Endless wave reached: median ${median(reached)}, best ${Math.max(...reached)}, worst ${Math.min(...reached)}`,
  )
}
console.log(
  `Upgrades at the end: spare tier median ${median(results.map(r => r.spareTier))}, pistol tier median ${median(results.map(r => r.pistolTier))}, spent median $${median(results.map(r => r.upgradeSpend))}`,
)
console.log(
  `Gnomes placed per run: median ${median(results.map(r => r.gnomesPlaced))}, most ${Math.max(...results.map(r => r.gnomesPlaced))}`,
)
const kitchenWaves = results.map(r => r.kitchenWave).filter(wave => wave > 0)
console.log(
  `Kitchen bought: ${((100 * kitchenWaves.length) / Math.max(1, results.length)).toFixed(0)}% of runs, in the break before wave ${kitchenWaves.length > 0 ? median(kitchenWaves) : '-'} (median)`,
)
const pullers = results.filter(r => r.fridge.pulls > 0)
const countsJson = encodeJson(Schema.Record(Schema.String, Schema.Number))
const emptyCounts = (): Record<string, number> => ({})
const fridgeTotals = results.reduce(
  (totals, { fridge }) => {
    Object.entries(fridge.prizes).forEach(([prize, count]) => {
      totals.prizes[prize] = (totals.prizes[prize] ?? 0) + count
    })
    totals.ended[fridge.endedWith] = (totals.ended[fridge.endedWith] ?? 0) + 1
    totals.lids += fridge.lids
    totals.pops += fridge.pops
    totals.swings += fridge.swings
    totals.clangs += fridge.clangs
    totals.sprays += fridge.sprays
    totals.shatters += fridge.shatters
    totals.taken += fridge.taken
    totals.stabs += fridge.stabs
    totals.stabHits += fridge.stabHits
    totals.counterBuys += fridge.counterBuys
    return totals
  },
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
    counterBuys: 0,
  },
)
const fridgeWins = (prize: string) =>
  results.filter(r => (r.fridge.prizes[prize] ?? 0) > 0)
console.log(
  `Fridge: pulled in ${((100 * pullers.length) / Math.max(1, results.length)).toFixed(0)}% of runs, ${results.reduce((sum, r) => sum + r.fridge.pulls, 0)} pulls, first in the break before wave ${pullers.length > 0 ? median(pullers.map(r => r.fridge.firstPullWave)) : '-'} (median)`,
)
console.log(
  `Fridge prizes: ${countsJson(fridgeTotals.prizes)}; carried at the end: ${countsJson(fridgeTotals.ended)}`,
)
console.log(
  `Fridge weapons taken: ${fridgeTotals.taken}. Knife: ${fridgeTotals.stabs} stabs, ${fridgeTotals.stabHits} hits (${(fridgeTotals.stabs / Math.max(1, results.length)).toFixed(1)} stabs a run).`,
)
console.log(
  `Ammo window: ${fridgeTotals.counterBuys} refills mid-wave (${(fridgeTotals.counterBuys / Math.max(1, results.length)).toFixed(1)} a run)`,
)
console.log(
  `Fridge weapons: ${fridgeTotals.lids} lids, ${fridgeTotals.pops} pops, ${fridgeTotals.swings} swings (${fridgeTotals.clangs} clangs), ${fridgeTotals.sprays} sprays, ${fridgeTotals.shatters} shatters`,
)
console.log(
  `Wins by fridge weapon pulled: ${['Cooker', 'Pan', 'Freeze']
    .map(prize => {
      const pulled = fridgeWins(prize)
      return `${prize} ${pulled.filter(r => r.victory).length}/${pulled.length}`
    })
    .join(
      ', ',
    )}, none ${results.filter(r => r.fridge.pulls === 0 && r.victory).length}/${results.filter(r => r.fridge.pulls === 0).length}`,
)
console.log(
  `Median run length: ${(median(results.map(r => r.runMs)) / 60000).toFixed(2)} min`,
)
console.log(
  `Median win length: ${(median(wins.map(r => r.runMs)) / 60000).toFixed(2)} min`,
)
console.log(
  '\nMoney earned by the end of wave (median of runs that cleared it)',
)
for (let wave = 1; wave <= lastWave; wave++) {
  const values = results.flatMap(r => r.moneyAfterWave[wave - 1] ?? [])
  if (values.length > 0) {
    console.log(`  wave ${wave}: $${median(values)}`)
  }
}
console.log(
  '\nShop visits: money on arrival (median, p25 to p75) and what the bot bought (share of visits)',
)
const quantile = (values: Array<number>, q: number): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}
for (let wave = 2; wave <= lastWave; wave++) {
  const { money, visits, bought } = summary.tallyShopVisits(results, wave)
  if (visits === 0) {
    continue
  }
  const shares = bought
    .map(([item, n]) => `${item} ${((100 * n) / visits).toFixed(0)}%`)
    .join(', ')
  console.log(
    `  before wave ${wave}: $${median([...money])} ($${quantile([...money], 0.25)} to $${quantile([...money], 0.75)}), n=${visits}: ${shares}`,
  )
}
const hurt = results.reduce((sum, r) => {
  KINDS.forEach(kind => {
    sum[kind] += r.hurtBy[kind]
  })
  return sum
}, emptyHurt())
const totalHurt = Object.values(hurt).reduce((a, b) => a + b, 0)
console.log('\nHearts lost by kind')
KINDS.forEach(kind => {
  console.log(
    `  ${kind.padEnd(9)} ${String(hurt[kind]).padStart(5)}  ${((100 * hurt[kind]) / Math.max(1, totalHurt)).toFixed(0)}%`,
  )
})

const pickupKinds = [
  ...new Set(
    results.flatMap(r => [
      ...Object.keys(r.dropped),
      ...Object.keys(r.grabbed),
    ]),
  ),
].sort()
const sumOf = (pick: (r: RunResult) => Record<string, number>, kind: string) =>
  results.reduce((sum, r) => sum + (pick(r)[kind] ?? 0), 0)
const totalDropped = pickupKinds.reduce(
  (sum, kind) => sum + sumOf(r => r.dropped, kind),
  0,
)
const totalGrabbed = pickupKinds.reduce(
  (sum, kind) => sum + sumOf(r => r.grabbed, kind),
  0,
)
console.log(
  `\nPickups: ${(totalDropped / runs).toFixed(1)} dropped and ${(totalGrabbed / runs).toFixed(1)} grabbed a run${IGNORES_PICKUPS ? ' (the bot ignores them)' : ''}, boosted ${(
    (100 * results.reduce((sum, r) => sum + r.boostedMs, 0)) /
    Math.max(
      1,
      results.reduce((sum, r) => sum + r.waveMs, 0),
    )
  ).toFixed(0)}% of wave time`,
)
pickupKinds.forEach(kind => {
  console.log(
    `  ${kind.padEnd(9)} dropped ${String(sumOf(r => r.dropped, kind)).padStart(5)}  grabbed ${String(sumOf(r => r.grabbed, kind)).padStart(5)}`,
  )
})

const fights = results.flatMap(r => r.boss)
const fightWaves = [...new Set(fights.map(fight => fight.wave))].sort(
  (a, b) => a - b,
)
console.log('\nBoss fights (per boss wave reached)')
fightWaves.forEach(bossWave => {
  const atWave = fights.filter(fight => fight.wave === bossWave)
  const arrived = atWave.filter(fight => fight.arrived)
  const felled = atWave.filter(fight => fight.felled)
  const diedTo = atWave.filter(fight => fight.diedToIt)
  const diedAtWave = results.filter(
    r => !r.victory && r.cleared + 1 === bossWave,
  ).length
  const perFight = (pick: (fight: BossFight) => number) =>
    (
      arrived.reduce((sum, fight) => sum + pick(fight), 0) /
      Math.max(1, arrived.length)
    ).toFixed(1)
  const share = (part: number, whole: number) =>
    `${((100 * part) / Math.max(1, whole)).toFixed(0)}%`
  const sum = (pick: (fight: BossFight) => number) =>
    arrived.reduce((total, fight) => total + pick(fight), 0)
  const wonKills = results
    .filter(r => r.victory || r.cleared >= bossWave)
    .flatMap(r => r.boss)
    .filter(fight => fight.wave === bossWave && fight.felled)
    .map(fight => fight.fightMs)
  const lostToBoss = sum(fight => fight.heartsLost)
  const waveHearts = results.reduce(
    (total, r) => total + (r.waves[bossWave - 1]?.heartsLost ?? 0),
    0,
  )
  console.log(
    `  wave ${bossWave}: reached ${atWave.length}, boss arrived ${arrived.length}, felled ${felled.length}, runs that died with it standing ${diedTo.length} of ${diedAtWave} deaths on the wave`,
  )
  console.log(
    `    fight: median ${(median(arrived.map(fight => fight.fightMs)) / 1000).toFixed(1)} s, kill time in runs that cleared the wave median ${(median(wonKills) / 1000).toFixed(1)} s (p25 ${(quantile(wonKills, 0.25) / 1000).toFixed(1)}, p75 ${(quantile(wonKills, 0.75) / 1000).toFixed(1)}, n=${wonKills.length}), enraged in ${share(arrived.filter(fight => fight.enraged).length, arrived.length)}`,
  )
  console.log(
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
  console.log(
    `    his health taken a second of fight ${(sum(fight => fight.damageTaken) / Math.max(1, sum(fight => fight.fightMs) / 1000)).toFixed(2)}, a second aimed at him ${(sum(fight => fight.damageTaken) / Math.max(1, sum(fight => fight.aimedMs) / 1000)).toFixed(2)}, aimed at him ${share(
      sum(fight => fight.aimedMs),
      sum(fight => fight.fightMs),
    )} of the fight`,
  )
  console.log(
    `    hearts lost while he stood ${lostToBoss} (${share(lostToBoss, waveHearts)} of the wave's ${waveHearts}): stomp ${sum(fight => fight.heartsByAttack.Stomp)}, charge ${sum(fight => fight.heartsByAttack.Charge)}, glob ${sum(fight => fight.heartsByAttack.Glob)}, his bite ${sum(fight => fight.heartsByAttack.Bite)}, the rest to the crowd`,
  )
})

const newKindTotal = (pick: (log: NewKindLog) => number) =>
  results.reduce((sum, r) => sum + pick(r.newKinds), 0)
const perRun = (pick: (log: NewKindLog) => number) =>
  (newKindTotal(pick) / Math.max(1, runs)).toFixed(1)
console.log('\nNew kinds and frenzy (per run)')
console.log(
  `  Big Leaguer throws ${perRun(log => log.throws)}, shields ${perRun(log => log.shields)}, landed on the bot ${perRun(log => log.throwHits)} (${(
    (100 * newKindTotal(log => log.throwHits)) /
    Math.max(
      1,
      newKindTotal(log => log.throws),
    )
  ).toFixed(0)}%)`,
)
console.log(
  `  Ankle Biters surfaced ${perRun(log => log.surfaced)}, grabbed the bot ${perRun(log => log.grabs)}, hearts lost while held ${perRun(log => log.heartsWhileClung)}`,
)
console.log(
  `  Frenzied packs ${perRun(log => log.frenzies)}, wiped for the bonus ${perRun(log => log.wipes)}, bonus paid $${perRun(log => log.wipeBonus)}`,
)

console.log(
  `\nMost zombies on screen at once: median ${median(results.map(r => r.maxAlive))}, worst ${Math.max(...results.map(r => r.maxAlive))}`,
)

// TIMELINE

const seconds = (ms: number) => (ms / 1000).toFixed(1)

const printTimeline = (result: RunResult) => {
  console.log(
    `\nTimeline of seed ${result.seed} (wall seconds from wave start)`,
  )
  result.timelines.forEach((timeline, index) => {
    const gaps = timeline.packs
      .slice(1)
      .map((arrival, at) => arrival.atMs - (timeline.packs[at]?.atMs ?? 0))
    console.log(
      `  Wave ${index + 1}: ${seconds(timeline.lengthMs)} s, ${timeline.packs.length} packs, rests ${timeline.restMs.map(seconds).join(', ') || 'none'}, longest gap between packs ${seconds(Math.max(0, ...gaps))} s`,
    )
    console.log(
      `    ${timeline.packs
        .map(
          arrival =>
            `${seconds(arrival.atMs)} ${arrival.door[0]}${arrival.size}${arrival.formation === 'Squad' || arrival.formation === 'Trickle' ? '' : arrival.formation[0]}${new Set(arrival.kinds).size > 1 ? '*' : ''}`,
        )
        .join('  ')}`,
    )
    const empties = timeline.empty.filter(stretch => stretch.ms >= 1000)
    if (empties.length > 0) {
      console.log(
        `    empty room: ${empties
          .map(
            stretch =>
              `${seconds(stretch.fromMs)} for ${seconds(stretch.ms)} (quiet ${seconds(quietPartMs(stretch))})`,
          )
          .join(', ')}`,
      )
    }
  })
}

const firstResult = results[0]
if (process.env['TIMELINE'] !== undefined && firstResult !== undefined) {
  printTimeline(firstResult)
  console.log(
    '\nWave  first pack s  packs  sizes (min to max, distinct)  empty s  longest empty s  longest quiet s (mean, worst)  rests s',
  )
  for (let wave = 1; wave <= lastWave; wave++) {
    const timelines = results.flatMap(r => r.timelines[wave - 1] ?? [])
    if (timelines.length === 0) {
      continue
    }
    const sizes = timelines.flatMap(t => t.packs.map(p => p.size))
    const distinct = mean(
      timelines.map(t => new Set(t.packs.map(p => p.size)).size),
    )
    const longestQuiet = timelines.map(t =>
      Math.max(0, ...t.empty.map(quietPartMs)),
    )
    console.log(
      `${String(wave).padStart(4)}  ${seconds(mean(timelines.map(t => t.packs[0]?.atMs ?? 0))).padStart(12)}  ${mean(
        timelines.map(t => t.packs.length),
      )
        .toFixed(1)
        .padStart(
          5,
        )}  ${`${Math.min(...sizes)} to ${Math.max(...sizes)}, ${distinct.toFixed(1)}`.padStart(29)}  ${seconds(
        mean(timelines.map(t => t.empty.reduce((sum, e) => sum + e.ms, 0))),
      ).padStart(7)}  ${seconds(
        mean(timelines.map(t => Math.max(0, ...t.empty.map(e => e.ms)))),
      ).padStart(
        15,
      )}  ${`${seconds(mean(longestQuiet))}, ${seconds(Math.max(...longestQuiet))}`.padStart(30)}  ${seconds(mean(timelines.flatMap(t => t.restMs)))}`,
    )
  }
}

writeJson(
  summary.summarizeCampaign(results, {
    difficulty: DIFFICULTY,
    kind: OPTIONS.mode,
    style: STYLE,
    wallSeconds: elapsed,
    lastWave,
  }),
)
