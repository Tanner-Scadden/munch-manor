import { Record } from 'effect'

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
