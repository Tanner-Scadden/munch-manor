import { Record } from 'effect'

// NOTE: a count of the costly passes the game makes, each over a whole
// level or a whole plan, so tests can hold the frame to a budget of them
// (src/world/__tests__/workBudget.test.ts) rather than to a time, which
// moves with the machine. Counting changes nothing the game computes, so
// update stays pure in everything it returns; nothing in the game reads it.
// A LevelTable is a table read off a level's rooms or exits (the exits for
// sale, the stations standing in open rooms), built once per Level.
export type WorkKind = 'FlowField' | 'MapScan' | 'SpawnRoute' | 'LevelTable'

const counts: Record<WorkKind, number> = {
  FlowField: 0,
  MapScan: 0,
  SpawnRoute: 0,
  LevelTable: 0,
}

export const countWork = (kind: WorkKind): void => {
  counts[kind]++
}

export const workCounts = (): Readonly<Record<WorkKind, number>> => ({
  ...counts,
})

export const resetWorkCounts = (): void => {
  for (const kind of Record.keys(counts)) {
    counts[kind] = 0
  }
}
