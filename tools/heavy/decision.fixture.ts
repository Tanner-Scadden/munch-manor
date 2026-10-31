// The guard's decision tests' shared setup: the clock, lock holders of each
// class, waiting jobs, and checks on a Decision. tools/heavy/decision.test.ts
// and tools/heavy/queue.test.ts start from it.

import { Option } from 'effect'

import {
  BudgetPolicy,
  Decision,
  JobClass,
  JobKind,
  type LockHolder,
  LockState,
  type SharedSlot,
  type Snapshot,
} from './decision'

export const NOW = 1_700_000_600_000
const LONG_AGO = NOW - 10 * 60_000

export const HOLDER: LockHolder = {
  pid: 4212,
  command: 'bun tools/balance/simulate.ts 100',
  cwd: '/repo',
  startedAt: LONG_AGO,
}
export const BALANCE: LockHolder = { ...HOLDER, jobClass: 'Cpu', cost: 4 }
export const PERF: LockHolder = {
  pid: 4300,
  command: 'bun tools/audit/perf.ts',
  cwd: '/repo',
  startedAt: LONG_AGO,
  jobClass: 'Timing',
  cost: 1,
}
export const TAPS: LockHolder = {
  pid: 5101,
  command: 'bun tools/audit/taps.ts',
  cwd: '/repo',
  startedAt: LONG_AGO,
  jobClass: 'Shared',
  cost: 3,
}
export const SHOTS: LockHolder = {
  ...TAPS,
  pid: 5102,
  command: 'bun shots9.ts',
  cost: 1,
}

export const held = (slot: number, holder: LockHolder): SharedSlot => ({
  slot,
  lock: LockState.cases.Held.make({ holder }),
})

export const waiting = (
  holder: LockHolder,
  arrivedBeforeMs: number,
): LockHolder => ({
  ...holder,
  startedAt: NOW - 2000 - arrivedBeforeMs,
})

// NOTE: 12 cores, a target of 8.4, a load of 2, nothing running.
export const BASE: Snapshot = {
  pid: 7000,
  cwd: '/repo',
  turns: [],
  load: 2,
  cores: 12,
  target: 8.4,
  now: NOW,
  jobClass: JobClass.cases.Cpu.make({}),
  cost: 1,
  maybeRequestedWorkers: Option.none(),
  lock: LockState.cases.Free.make({}),
  shared: [],
  waiters: [],
  extraRecent: [],
  arrivedAt: NOW - 1000,
  batchesUsed: 0,
  job: JobKind.cases.Balance.make({}),
  budgetPolicy: BudgetPolicy.cases.Enforced.make({}),
}
export const TIMING: Snapshot = {
  ...BASE,
  jobClass: JobClass.cases.Timing.make({}),
  job: JobKind.cases.Other.make({}),
}
// NOTE: a CPU job's snapshot is the base one; tests name it CPU when the
// class is the point. `@alias` tells knip the second name is on purpose.
/** @alias */
export const CPU = BASE
export const SHARED: Snapshot = {
  ...BASE,
  jobClass: JobClass.cases.Shared.make({}),
  cost: 3,
  job: JobKind.cases.Other.make({}),
}

export const isRun = (decision: Decision) => Decision.isAnyOf(['Run'])(decision)
export const isWait = (decision: Decision) =>
  Decision.isAnyOf(['Wait'])(decision)
