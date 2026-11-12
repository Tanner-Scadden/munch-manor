// Uncle Chunk at the front door, from the tables: his finale health by
// difficulty and crew (src/world/dare/finale.ts, `chunkHpFor`), at the wave
// he usually comes on, and the seconds a crew at the model's loadout dps
// takes to fell him. The model's dps is every shot landing, so
// a real fight runs longer: dodging, adds, and misses.

import { Array, Console, Effect, Number, Option, String } from 'effect'

import type { Difficulty } from '../../src/shared/playerData'
import { chunkHpFor } from '../../src/world/dare/finale'
import { DIFFICULTY_ORDER } from '../../src/world/run/difficulty'
import { type BalanceModel, balanceModel, rolledWave } from './model'
import { ASSUMPTIONS } from './modelAssumptions'

// NOTE: he comes at the start of the wave after the list is done, and the
// balance bot finishes its list on wave 9 on the median Normal run
// (2026-11-10, 50 runs).
const ARRIVAL_WAVE = 9

type ChunkRow = Readonly<{
  difficulty: Difficulty
  crew: number
  hp: number
  seconds: number
}>

const CREWS: ReadonlyArray<number> = [1, 2, 3, 4]

const meanHpOf = (difficulty: Difficulty, crew: number): number =>
  Number.sumAll(
    Array.map(ASSUMPTIONS.seeds, seed =>
      chunkHpFor({
        difficulty,
        crew,
        spawns: rolledWave(seed, ARRIVAL_WAVE, difficulty).spawns,
      }),
    ),
  ) / Math.max(1, ASSUMPTIONS.seeds.length)

const dpsAt = (model: BalanceModel, difficulty: Difficulty): number =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(model[difficulty], ({ wave }) => wave === ARRIVAL_WAVE),
      ({ dps }) => dps,
    ),
    () => 1,
  )

export const chunkRows = (model: BalanceModel): ReadonlyArray<ChunkRow> =>
  Array.flatMap(DIFFICULTY_ORDER, difficulty =>
    Array.map(CREWS, crew => {
      const hp = meanHpOf(difficulty, crew)
      return {
        difficulty,
        crew,
        hp,
        seconds: hp / (dpsAt(model, difficulty) * crew),
      }
    }),
  )

export const formatChunk = (model: BalanceModel): string =>
  Array.join(
    [
      `Uncle Chunk at the front door on wave ${ARRIVAL_WAVE} (every shot landing)`,
      'Difficulty  crew     hp  seconds',
      ...Array.map(
        chunkRows(model),
        ({ difficulty, crew, hp, seconds }) =>
          `${String.padEnd(10)(difficulty)}  ${String.padStart(4)(`${crew}`)}  ${String.padStart(5)(hp.toFixed(0))}  ${String.padStart(7)(seconds.toFixed(0))}`,
      ),
    ],
    '\n',
  )

if (import.meta.main === true) {
  Effect.runSync(Console.log(formatChunk(balanceModel())))
}
