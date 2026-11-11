// The end report (END_REPORT=1 bun run balance): a line for each run on
// where it stopped (the wave, the list's progress, things still behind
// boards or hidden in open rooms, keys left on the ring, cases opened for
// the bot and not taken), a line for each Uncle Chunk fight (the bot's
// hearts and distance to him each second, the time in his slam's reach and
// crowded, and what took its hearts), then the batch's tally of both.
// bot/runEnd.ts records it.

import { Array, Console, Effect, Number, Option, Record, String } from 'effect'

import type { BossFight, RunResult, RunStop } from './bot/results'
import { median } from './summary'

const percent = (part: number, whole: number) =>
  `${whole === 0 ? 0 : Math.round((100 * part) / whole)}%`

const sumOf = (values: ReadonlyArray<number>) =>
  Array.reduce(values, 0, (sum, value) => sum + value)

const STOPS: ReadonlyArray<RunStop> = [
  'Escaped',
  'DiedToChunk',
  'DiedListDone',
  'DiedHunting',
  'TimedOut',
]

const runLine = (result: RunResult): string => {
  const { end } = result
  return `  seed ${result.seed}  ${String.padEnd(12)(end.stop)} w${end.wave}  plan ${end.plan}  list ${end.found}/${end.listLength} (behind boards ${end.behindBoards}, hidden in open ${end.hiddenInOpen}, boards shut ${end.shutBoards})  keys ${end.keysHeld}  cases waiting ${end.casesWaiting}, locked ${end.casesLocked}${result.killedBy === undefined ? '' : `  killed by ${result.killedBy}`}`
}

const blameLine = (fights: ReadonlyArray<BossFight>): string => {
  const attacks = Array.map(
    ['Stomp', 'Slam', 'Charge', 'Glob', 'Bite'] as const,
    attack =>
      `${attack} ${sumOf(Array.map(fights, fight => fight.heartsByAttack[attack]))}`,
  )
  const crowd: Record<string, number> = {}
  Array.forEach(fights, fight =>
    Array.forEach(Record.toEntries(fight.crowdHurtBy), ([kind, lost]) => {
      crowd[kind] = (crowd[kind] ?? 0) + lost
    }),
  )
  const crowdText = Array.join(
    Array.map(
      Array.sort(
        Record.toEntries(crowd),
        (a: readonly [string, number], b: readonly [string, number]) =>
          b[1] - a[1] < 0 ? -1 : b[1] - a[1] > 0 ? 1 : 0,
      ),
      ([kind, lost]) => `${kind} ${lost}`,
    ),
    ', ',
  )
  return `${Array.join(attacks, ', ')}; the crowd: ${crowdText || 'none'}`
}

// NOTE: every other second, so a long fight fits a line.
const everyOther = (values: ReadonlyArray<number>) =>
  Array.join(
    Array.map(
      Array.filter(values, (_, at) => at % 2 === 0),
      value => globalThis.String(value),
    ),
    ' ',
  )

const fightLine = (fight: BossFight): string =>
  `    Chunk w${fight.wave} ${(fight.fightMs / 1000).toFixed(0)} s${fight.felled ? ' felled' : ''}${fight.diedToIt ? ' died' : ''}: hearts ${everyOther(fight.hpBySecond)} | px ${everyOther(fight.distanceBySecond)} | in slam reach ${percent(fight.nearMs, fight.fightMs)}, crowded ${percent(fight.crowdedMs, fight.fightMs)}, aimed at him ${percent(fight.aimedMs, fight.fightMs)} | ${blameLine([fight])}`

// NOTE: how many runs ended on each of the plan's steps, a Save by the
// median keys short.
const planTally = (ends: ReadonlyArray<RunResult['end']>): string => {
  const steps: Record<string, Array<number>> = {}
  Array.forEach(ends, ({ plan }) => {
    const [step, ...rest] = String.split(plan, ' ')
    ;(steps[step] ??= []).push(
      Option.getOrElse(Number.parse(Array.join(rest, '')), () => 0),
    )
  })
  return Array.join(
    Array.map(Record.toEntries(steps), ([step, shorts]) =>
      step === 'Save'
        ? `Save ${shorts.length} (short ${median(shorts)})`
        : `${step} ${shorts.length}`,
    ),
    ', ',
  )
}

const stopTally = (results: ReadonlyArray<RunResult>) =>
  Effect.gen(function* () {
    yield* Console.log('\nWhere the runs stopped')
    for (const stop of STOPS) {
      const ended = Array.filter(results, ({ end }) => end.stop === stop)
      if (ended.length === 0) {
        continue
      }
      const ends = Array.map(ended, ({ end }) => end)
      yield* Console.log(
        `  ${String.padEnd(12)(stop)} ${String.padStart(3)(globalThis.String(ended.length))} runs, the plan's step ${planTally(ends)}, wave ${median(Array.map(ends, end => end.wave))} (median); list found ${median(Array.map(ends, end => end.found))} of ${median(Array.map(ends, end => end.listLength))}; things behind boards in ${percent(Array.filter(ends, end => end.behindBoards > 0).length, ends.length)} (keys left ${median(
          Array.map(
            Array.filter(ends, end => end.behindBoards > 0),
            end => end.keysHeld,
          ),
        )}), hidden in an open room in ${percent(Array.filter(ends, end => end.hiddenInOpen > 0).length, ends.length)}; a case waiting in ${percent(Array.filter(ends, end => end.casesWaiting > 0).length, ends.length)}, cases locked ${median(Array.map(ends, end => end.casesLocked))}`,
      )
    }
  })

const chunkTally = (results: ReadonlyArray<RunResult>) =>
  Effect.gen(function* () {
    const fights = Array.filter(
      Array.flatMap(results, result => result.boss),
      fight => fight.arrived,
    )
    if (fights.length === 0) {
      return
    }
    const felled = Array.filter(fights, fight => fight.felled).length
    const share = (pick: (fight: BossFight) => number) =>
      percent(
        sumOf(Array.map(fights, pick)),
        sumOf(Array.map(fights, fight => fight.fightMs)),
      )
    const firstTen = Array.map(
      fights,
      fight =>
        (fight.hpBySecond[0] ?? 0) -
        (fight.hpBySecond[Math.min(10, fight.hpBySecond.length - 1)] ?? 0),
    )
    yield* Console.log(
      `\nUncle Chunk's fights: ${fights.length}, felled ${felled}, ${(median(Array.map(fights, fight => fight.fightMs)) / 1000).toFixed(0)} s (median)`,
    )
    yield* Console.log(
      `  distance to him ${median(Array.flatMap(fights, fight => fight.distanceBySecond))} px (median of seconds), in his slam's reach ${share(fight => fight.nearMs)}, crowded by 3 or more ${share(fight => fight.crowdedMs)}, aimed at him ${share(fight => fight.aimedMs)}`,
    )
    yield* Console.log(
      `  hearts lost in his first 10 s ${median(firstTen)} (median), a fight ${(sumOf(Array.map(fights, fight => fight.heartsLost)) / fights.length).toFixed(1)} (mean)`,
    )
    yield* Console.log(`  what took them: ${blameLine(fights)}`)
  })

export const printEndReport = (results: ReadonlyArray<RunResult>) =>
  Effect.gen(function* () {
    yield* Console.log('\nEnd of each run')
    for (const result of results) {
      yield* Console.log(runLine(result))
      for (const fight of Array.filter(result.boss, ({ arrived }) => arrived)) {
        yield* Console.log(fightLine(fight))
      }
    }
    yield* stopTally(results)
    yield* chunkTally(results)
  })
