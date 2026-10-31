import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  BUDGET_REFUSE_AT,
  BUDGET_WARN_AT,
  BudgetPolicy,
  Decision,
  Hold,
  Invocation,
  JobClass,
  JobKind,
  LockAction,
  type LockHolder,
  LockState,
  MAX_CPU_WORKERS,
  MAX_OTHER_WORKERS,
  REPORT_EVERY_MS,
  allowedWorkers,
  batchesUsed,
  budgetKey,
  classifyLock,
  costOf,
  decide,
  decodeLedger,
  decodeLockHolder,
  encodeLedger,
  encodeLockHolder,
  formatDuration,
  freeSlot,
  headroom,
  isSameHolder,
  jobClassOf,
  jobKindOf,
  maybeConflictAfterTaking,
  parseArguments,
  recentCost,
  recordBatch,
  resetBudget,
  sharedCostOf,
  shouldReport,
  summaryLine,
  targetLoad,
  testWorkers,
} from './decision'
import {
  BALANCE,
  BASE,
  CPU,
  HOLDER,
  NOW,
  PERF,
  SHARED,
  SHOTS,
  TAPS,
  TIMING,
  held,
  isRun,
  isWait,
  waiting,
} from './decision.fixture'
const OG: LockHolder = { ...SHOTS, pid: 5103, command: 'bun og.ts' }
const ICONS: LockHolder = { ...SHOTS, pid: 5104, command: 'bun icons.ts' }

const fresh = (holder: LockHolder): LockHolder => ({
  ...holder,
  startedAt: NOW - 10_000,
})

const alwaysAlive = () => true
const neverAlive = () => false
const workersOf = (decision: Decision) =>
  Decision.isAnyOf(['Run'])(decision) ? decision.workers : -1

describe('the budget', () => {
  test('aims at 70% of the cores unless HEAVY_TARGET_LOAD is set', () => {
    expect(targetLoad(12, Option.none())).toBeCloseTo(8.4)
    expect(targetLoad(12, Option.some(6))).toBe(6)
  })

  test('counts only the jobs started in the last minute', () => {
    expect(
      recentCost({
        ...BASE,
        lock: LockState.cases.Held.make({ holder: fresh(BALANCE) }),
        shared: [held(1, fresh(TAPS)), held(2, SHOTS)],
        extraRecent: [{ ...fresh(SHOTS), pid: 9, cost: 2 }],
      }),
    ).toBe(4 + 3 + 2)
    expect(headroom(BASE)).toBeCloseTo(6.4)
  })

  test('estimates a slot from an older guard by its command', () => {
    expect(
      costOf({ pid: 1, command: 'bun taps.ts', cwd: '/', startedAt: 0 }),
    ).toBe(3)
    expect(
      costOf({ pid: 1, command: 'bun og.ts', cwd: '/', startedAt: 0 }),
    ).toBe(1)
  })

  test('costs a Shared job one core per browser context', () => {
    const env = (values: Record<string, string>) => (key: string) =>
      Option.fromNullishOr(values[key])
    expect(sharedCostOf(['bun', 'tools/audit/taps.ts'], env({}))).toBe(3)
    expect(
      sharedCostOf(['bun', 'tools/audit/taps.ts'], env({ TAPS_PARALLEL: '1' })),
    ).toBe(1)
    expect(
      sharedCostOf(['bun', 'shots34.ts'], env({ SHOTS_PARALLEL: '2' })),
    ).toBe(2)
    expect(sharedCostOf(['bun', 'shots9.ts'], env({}))).toBe(1)
    expect(sharedCostOf(['bun', 'shots33.ts'], env({}))).toBe(6)
    expect(
      sharedCostOf(['bun', 'shots33.ts'], env({ SHOTS_PARALLEL: '1' })),
    ).toBe(2)
    expect(sharedCostOf(['bun', 'og.ts'], env({ TAPS_PARALLEL: '3' }))).toBe(1)
  })
})

describe('Timing jobs', () => {
  test('run alone on a quiet machine, holding the solo lock', () => {
    expect(decide(TIMING)).toStrictEqual(
      Decision.cases.Run.make({
        hold: Hold.cases.Solo.make({}),
        workers: MAX_OTHER_WORKERS,
        cost: 1,
        lockAction: LockAction.cases.Create.make({}),
        notes: [],
      }),
    )
  })

  test('keep the old load gate: wait over the core count, run at it', () => {
    expect(decide({ ...TIMING, load: 24.1 })).toStrictEqual(
      Decision.cases.Wait.make({ reason: 'load 24.1 over 12 cores' }),
    )
    expect(isRun(decide({ ...TIMING, load: 12 }))).toBe(true)
  })

  test('wait for every running Shared job', () => {
    expect(
      decide({ ...TIMING, shared: [held(1, TAPS), held(2, SHOTS)] }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          '2 shared jobs running (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots9.ts)',
      }),
    )
  })

  test('wait for a CPU job', () => {
    expect(
      decide({
        ...TIMING,
        lock: LockState.cases.Held.make({ holder: BALANCE }),
      }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'a CPU job is running (pid 4212: bun tools/balance/simulate.ts 100)',
      }),
    )
  })

  test('name both the load and the holder when both block', () => {
    expect(
      decide({
        ...TIMING,
        load: 24.1,
        lock: LockState.cases.Held.make({ holder: HOLDER }),
      }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'load 24.1 over 12 cores (lock held by pid 4212: bun tools/balance/simulate.ts 100)',
      }),
    )
  })

  test('take over a stale or corrupt lock', () => {
    expect(
      decide({
        ...TIMING,
        lock: LockState.cases.Stale.make({ holder: HOLDER }),
      }),
    ).toStrictEqual(
      Decision.cases.Run.make({
        hold: Hold.cases.Solo.make({}),
        workers: MAX_OTHER_WORKERS,
        cost: 1,
        lockAction: LockAction.cases.TakeOver.make({
          reason:
            'Taking over a stale lock: pid 4212: bun tools/balance/simulate.ts 100 is gone.',
        }),
        notes: [],
      }),
    )
    const decision = decide({
      ...TIMING,
      lock: LockState.cases.Unreadable.make({ text: '{"pid":' }),
    })
    expect(
      Decision.isAnyOf(['Run'])(decision) &&
        LockAction.isAnyOf(['TakeOver'])(decision.lockAction),
    ).toBe(true)
  })

  test('ignore stale and corrupt slots', () => {
    expect(
      decide({
        ...TIMING,
        shared: [
          { slot: 1, lock: LockState.cases.Stale.make({ holder: TAPS }) },
          { slot: 2, lock: LockState.cases.Unreadable.make({ text: '{' }) },
        ],
      }),
    ).toStrictEqual(decide(TIMING))
  })
})

describe('CPU jobs', () => {
  test('size WORKERS to the budget, up to 8', () => {
    expect(workersOf(decide(CPU))).toBe(6)
    expect(workersOf(decide({ ...CPU, load: 0.2 }))).toBe(MAX_CPU_WORKERS)
    expect(
      workersOf(decide({ ...CPU, load: 0.2, cores: 32, target: 22.4 })),
    ).toBe(MAX_CPU_WORKERS)
  })

  test('say how they sized WORKERS', () => {
    expect(decide(CPU)).toStrictEqual(
      Decision.cases.Run.make({
        hold: Hold.cases.Solo.make({}),
        workers: 6,
        cost: 6,
        lockAction: LockAction.cases.Create.make({}),
        notes: [
          'WORKERS=6 fits the budget (target 8.4, load 2.0, 0.0 just started, cap 8).',
        ],
      }),
    )
  })

  test('treat a WORKERS the caller set as a ceiling', () => {
    expect(
      workersOf(decide({ ...CPU, maybeRequestedWorkers: Option.some(2) })),
    ).toBe(2)
    expect(
      workersOf(decide({ ...CPU, maybeRequestedWorkers: Option.some(12) })),
    ).toBe(6)
  })

  test('leave room for Shared jobs started in the last minute', () => {
    expect(workersOf(decide({ ...CPU, shared: [held(1, fresh(TAPS))] }))).toBe(
      3,
    )
    expect(workersOf(decide({ ...CPU, shared: [held(1, TAPS)] }))).toBe(6)
  })

  test('run beside Shared jobs', () => {
    expect(
      isRun(decide({ ...CPU, load: 4, shared: [held(1, TAPS), held(2, OG)] })),
    ).toBe(true)
  })

  test('wait when not even one worker fits', () => {
    expect(decide({ ...CPU, load: 7.5 })).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'load 7.5 + 0.0 just started + 1 worker is over the target of 8.4 on 12 cores',
      }),
    )
    expect(workersOf(decide({ ...CPU, load: 7.4 }))).toBe(1)
  })

  test('run one at a time', () => {
    expect(
      decide({ ...CPU, lock: LockState.cases.Held.make({ holder: BALANCE }) }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'a CPU job is running (pid 4212: bun tools/balance/simulate.ts 100)',
      }),
    )
  })

  test('never run beside a Timing job, or an older guard', () => {
    expect(
      decide({ ...CPU, lock: LockState.cases.Held.make({ holder: PERF }) }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason: 'lock held by pid 4300: bun tools/audit/perf.ts',
      }),
    )
    expect(
      isWait(
        decide({ ...CPU, lock: LockState.cases.Held.make({ holder: HOLDER }) }),
      ),
    ).toBe(true)
  })
})

describe('Shared jobs', () => {
  test('take the first slot within the budget', () => {
    expect(decide(SHARED)).toStrictEqual(
      Decision.cases.Run.make({
        hold: Hold.cases.Shared.make({ slot: 1 }),
        workers: MAX_OTHER_WORKERS,
        cost: 3,
        lockAction: LockAction.cases.Create.make({}),
        notes: [],
      }),
    )
  })

  test('take the lowest free slot beside other Shared jobs', () => {
    const decision = decide({
      ...SHARED,
      shared: [held(1, TAPS), held(3, SHOTS)],
    })
    expect(Decision.isAnyOf(['Run'])(decision) && decision.hold).toStrictEqual(
      Hold.cases.Shared.make({ slot: 2 }),
    )
  })

  test('take over a stale slot', () => {
    const decision = decide({
      ...SHARED,
      shared: [
        held(1, TAPS),
        { slot: 2, lock: LockState.cases.Stale.make({ holder: SHOTS }) },
      ],
    })
    expect(
      Decision.isAnyOf(['Run'])(decision) && decision.lockAction,
    ).toStrictEqual(
      LockAction.cases.TakeOver.make({
        reason:
          'Taking over a stale shared slot 2: pid 5102: bun shots9.ts is gone.',
      }),
    )
  })

  test('wait at four running, the hard cap', () => {
    expect(
      decide({
        ...SHARED,
        cost: 1,
        shared: [held(1, TAPS), held(2, SHOTS), held(3, OG), held(4, ICONS)],
      }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'all 4 shared slots busy (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots9.ts; pid 5103: bun og.ts; pid 5104: bun icons.ts)',
      }),
    )
  })

  test('start only while the load and recent jobs leave room for their cost', () => {
    expect(isRun(decide({ ...SHARED, load: 5.4 }))).toBe(true)
    expect(decide({ ...SHARED, load: 5.5 })).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'load 5.5 + 0.0 just started + 3 for this job is over the target of 8.4 on 12 cores',
      }),
    )
    expect(
      decide({ ...SHARED, load: 3, shared: [held(1, fresh(TAPS))] }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'load 3.0 + 3.0 just started + 3 for this job is over the target of 8.4 on 12 cores',
      }),
    )
    expect(isRun(decide({ ...SHARED, cost: 1, load: 7 }))).toBe(true)
  })

  test('run beside a CPU job', () => {
    expect(
      isRun(
        decide({
          ...SHARED,
          lock: LockState.cases.Held.make({ holder: BALANCE }),
        }),
      ),
    ).toBe(true)
  })

  test('wait while a Timing job, or an older guard, holds the lock', () => {
    expect(
      decide({ ...SHARED, lock: LockState.cases.Held.make({ holder: PERF }) }),
    ).toStrictEqual(
      Decision.cases.Wait.make({
        reason: 'lock held by pid 4300: bun tools/audit/perf.ts',
      }),
    )
    expect(
      isWait(
        decide({
          ...SHARED,
          lock: LockState.cases.Held.make({ holder: HOLDER }),
        }),
      ),
    ).toBe(true)
  })

  test('ignore a stale solo lock', () => {
    expect(
      decide({ ...SHARED, lock: LockState.cases.Stale.make({ holder: PERF }) }),
    ).toStrictEqual(decide(SHARED))
  })

  test('count test runs in the budget', () => {
    expect(
      isWait(
        decide({
          ...SHARED,
          extraRecent: [{ ...fresh(SHOTS), command: 'bun run test', cost: 4 }],
        }),
      ),
    ).toBe(true)
  })
})

describe('fairness by arrival', () => {
  test('a Timing job waiting first blocks every later arrival', () => {
    const waiters = [waiting(PERF, 0)]
    expect(decide({ ...SHARED, cost: 1, waiters })).toStrictEqual(
      Decision.cases.Wait.make({
        reason: 'a job is waiting first (pid 4300: bun tools/audit/perf.ts)',
      }),
    )
    expect(isWait(decide({ ...CPU, waiters }))).toBe(true)
    expect(isWait(decide({ ...TIMING, waiters }))).toBe(true)
  })

  test('a CPU job waiting first blocks every later arrival', () => {
    const waiters = [waiting(BALANCE, 0)]
    expect(isWait(decide({ ...SHARED, cost: 1, waiters }))).toBe(true)
    expect(isWait(decide({ ...TIMING, waiters }))).toBe(true)
  })

  test('a waiter that arrived later blocks nothing', () => {
    const later = { ...PERF, startedAt: NOW }
    expect(isRun(decide({ ...SHARED, waiters: [later] }))).toBe(true)
  })

  test('a Shared job waiting first blocks later Shared jobs of equal or larger cost', () => {
    const waiters = [waiting(TAPS, 0)]
    expect(isWait(decide({ ...SHARED, cost: 3, waiters }))).toBe(true)
    expect(isWait(decide({ ...SHARED, cost: 4, waiters }))).toBe(true)
    expect(isRun(decide({ ...SHARED, cost: 1, waiters }))).toBe(true)
    expect(isWait(decide({ ...TIMING, waiters }))).toBe(true)
  })

  test('a later CPU job passes a waiting Shared job but leaves its cost free', () => {
    const waiters = [waiting(TAPS, 0)]
    expect(workersOf(decide({ ...CPU, waiters }))).toBe(3)
    expect(decide({ ...CPU, load: 5, waiters })).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'load 5.0 + 0.0 just started + 1 worker (and 3.0 kept for jobs waiting first) is over the target of 8.4 on 12 cores',
      }),
    )
  })
})

describe('the cost kept free for waiting Shared jobs', () => {
  const shots34 = (pid: number, arrivedBeforeMs: number): LockHolder =>
    waiting(
      { ...TAPS, pid, command: 'bun tools/audit/shots34.ts' },
      arrivedBeforeMs,
    )

  test('is only the head waiter, so a queue of them does not starve a CPU job', () => {
    const waiters = [
      shots34(5201, 4000),
      shots34(5202, 3000),
      shots34(5203, 2000),
      shots34(5204, 1000),
      shots34(5205, 0),
    ]
    expect(workersOf(decide({ ...CPU, waiters }))).toBe(3)
  })

  test('is the cost of the waiter that arrived first', () => {
    const waiters = [waiting(TAPS, 0), waiting(SHOTS, 1000)]
    expect(workersOf(decide({ ...CPU, waiters }))).toBe(5)
  })

  test('is at most the target', () => {
    const waiters = [waiting({ ...TAPS, cost: 20 }, 0)]
    expect(decide({ ...CPU, load: 0, waiters })).toStrictEqual(
      Decision.cases.Wait.make({
        reason:
          'load 0.0 + 0.0 just started + 1 worker (and 8.4 kept for jobs waiting first) is over the target of 8.4 on 12 cores',
      }),
    )
  })
})

describe('freeSlot', () => {
  test('is the lowest of the four slots without a live job', () => {
    expect(freeSlot([])).toStrictEqual(
      Option.some({ slot: 1, lock: LockState.cases.Free.make({}) }),
    )
    expect(freeSlot([held(1, TAPS), held(2, SHOTS)])).toStrictEqual(
      Option.some({ slot: 3, lock: LockState.cases.Free.make({}) }),
    )
    expect(
      freeSlot([held(1, TAPS), held(2, SHOTS), held(3, OG), held(4, ICONS)]),
    ).toStrictEqual(Option.none())
  })
})

describe('maybeConflictAfterTaking', () => {
  const self: LockHolder = { ...TAPS, pid: 7000, startedAt: 5 }

  test('a Timing job backs off when a Shared job slipped in', () => {
    expect(
      maybeConflictAfterTaking(
        JobClass.cases.Timing.make({}),
        self,
        LockState.cases.Held.make({ holder: self }),
        [held(1, TAPS)],
      ),
    ).toStrictEqual(
      Option.some(
        'a shared job started at the same time (pid 5101: bun tools/audit/taps.ts)',
      ),
    )
    expect(
      maybeConflictAfterTaking(
        JobClass.cases.Timing.make({}),
        self,
        LockState.cases.Held.make({ holder: self }),
        [{ slot: 1, lock: LockState.cases.Stale.make({ holder: TAPS }) }],
      ),
    ).toStrictEqual(Option.none())
  })

  test('a CPU job keeps running beside Shared jobs', () => {
    expect(
      maybeConflictAfterTaking(
        JobClass.cases.Cpu.make({}),
        self,
        LockState.cases.Held.make({ holder: self }),
        [held(1, TAPS)],
      ),
    ).toStrictEqual(Option.none())
  })

  test('a Shared job backs off when a Timing job slipped in, not a CPU one', () => {
    expect(
      maybeConflictAfterTaking(
        JobClass.cases.Shared.make({}),
        self,
        LockState.cases.Held.make({ holder: PERF }),
        [held(1, self)],
      ),
    ).toStrictEqual(
      Option.some(
        'a timing job started at the same time (pid 4300: bun tools/audit/perf.ts)',
      ),
    )
    expect(
      maybeConflictAfterTaking(
        JobClass.cases.Shared.make({}),
        self,
        LockState.cases.Held.make({ holder: BALANCE }),
        [held(1, self)],
      ),
    ).toStrictEqual(Option.none())
  })
})

describe('testWorkers', () => {
  test('gives vitest what is left of the budget', () => {
    expect(testWorkers(BASE)).toBe(6)
    expect(testWorkers({ ...BASE, load: 0 })).toBe(8)
  })

  test('never goes under 2 or over one less than the cores', () => {
    expect(testWorkers({ ...BASE, load: 23 })).toBe(2)
    expect(testWorkers({ ...BASE, load: 0, target: 40 })).toBe(11)
  })

  test('counts other test runs started in the last minute', () => {
    expect(
      testWorkers({
        ...BASE,
        extraRecent: [{ ...fresh(SHOTS), command: 'bun run test', cost: 4 }],
      }),
    ).toBe(2)
  })
})

describe('jobClassOf', () => {
  const classOf = (...command: ReadonlyArray<string>) =>
    jobClassOf(command, Option.none())

  test('runs screenshot and functional audits as Shared', () => {
    Array.forEach(
      [
        ['bun', 'tools/audit/taps.ts'],
        ['bun', 'tools/audit/shots34.ts'],
        ['bun', '/abs/repo/tools/audit/shots9.ts'],
        ['bun', 'shots33.ts'],
        ['bun', './offline.ts'],
        ['bun', 'tools/audit/sqlite.ts'],
        ['bun', 'tools/audit/sync.ts'],
        ['bun', 'tools/audit/save.ts'],
        ['bun', 'live-check.ts', 'https://example.com'],
        ['bun', 'tools/audit/icons.ts'],
        ['bun', 'tools/audit/og.ts'],
        ['bun', 'tools/audit/beacon-check.ts'],
        ['bun', 'tools/audit/mp.ts'],
        ['sh', '-c', 'cd tools/audit && PORTRAIT=1 bun taps.ts'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(
          JobClass.cases.Shared.make({}),
        )
      },
    )
  })

  test('runs the balance bot and determinism as CPU', () => {
    Array.forEach(
      [
        ['bun', 'tools/balance/simulate.ts', '100'],
        ['bun', 'tools/balance/simulate.ts', '--wave', '4', '--runs', '200'],
        ['bun', 'tools/balance/nightly.ts'],
        ['bun', 'tools/determinism/crossEngine.ts'],
        ['bun', 'tools/determinism/beforeAfter.ts', 'origin/main'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(JobClass.cases.Cpu.make({}))
      },
    )
  })

  test('runs timing audits as Timing', () => {
    Array.forEach(
      [
        ['bun', 'tools/audit/perf.ts'],
        ['bun', 'tools/audit/perf-check.ts'],
        ['bun', 'tools/audit/profile.ts'],
        ['bun', 'tools/audit/measure.ts'],
        ['bun', 'tools/audit/splash.ts'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(
          JobClass.cases.Timing.make({}),
        )
      },
    )
  })

  test('runs a command it does not know as Timing', () => {
    expect(classOf('bun', 'tools/audit/shots.ts')).toStrictEqual(
      JobClass.cases.Timing.make({}),
    )
    expect(classOf('bun', 'src/save.ts')).toStrictEqual(
      JobClass.cases.Timing.make({}),
    )
    expect(classOf('sleep', '30')).toStrictEqual(JobClass.cases.Timing.make({}))
  })

  test('takes the most careful class a command names', () => {
    expect(
      classOf('sh', '-c', 'bun tools/audit/taps.ts && bun tools/audit/perf.ts'),
    ).toStrictEqual(JobClass.cases.Timing.make({}))
    expect(
      classOf(
        'sh',
        '-c',
        'bun tools/audit/taps.ts && bun tools/balance/simulate.ts',
      ),
    ).toStrictEqual(JobClass.cases.Cpu.make({}))
  })

  test('follows an override', () => {
    expect(
      jobClassOf(['sleep', '30'], Option.some(JobClass.cases.Shared.make({}))),
    ).toStrictEqual(JobClass.cases.Shared.make({}))
    expect(
      jobClassOf(
        ['bun', 'tools/audit/taps.ts'],
        Option.some(JobClass.cases.Cpu.make({})),
      ),
    ).toStrictEqual(JobClass.cases.Cpu.make({}))
  })
})

describe('allowedWorkers for Timing and Shared jobs', () => {
  test('keeps the old cap of 4, cut once the load passes half the cores', () => {
    expect(allowedWorkers(8, 0, 12)).toBe(MAX_OTHER_WORKERS)
    expect(allowedWorkers(0, 0, 12)).toBe(1)
    expect(allowedWorkers(4, 8.1, 12)).toBe(1)
  })
})

describe('the balance batch budget', () => {
  test('says nothing for the first two batches', () => {
    expect(decide({ ...CPU, batchesUsed: BUDGET_WARN_AT - 2 })).toStrictEqual(
      decide(CPU),
    )
  })

  test('warns on the third batch and after', () => {
    const decision = decide({ ...CPU, batchesUsed: BUDGET_WARN_AT - 1 })
    expect(Decision.isAnyOf(['Run'])(decision) && decision.notes[1]).toBe(
      'Third balance batch on this branch; prefer accepting near-target results.',
    )
  })

  test('refuses the sixth batch, before it would wait', () => {
    expect(
      Decision.isAnyOf(['Refuse'])(
        decide({ ...CPU, batchesUsed: BUDGET_REFUSE_AT - 1 }),
      ),
    ).toBe(true)
    expect(
      Decision.isAnyOf(['Refuse'])(
        decide({
          ...CPU,
          load: 30,
          lock: LockState.cases.Held.make({ holder: HOLDER }),
          batchesUsed: 9,
        }),
      ),
    ).toBe(true)
  })

  test('runs past the budget with --allow-more and still warns', () => {
    const decision = decide({
      ...CPU,
      batchesUsed: BUDGET_REFUSE_AT - 1,
      budgetPolicy: BudgetPolicy.cases.AllowMore.make({}),
    })
    expect(Decision.isAnyOf(['Run'])(decision) && decision.notes[1]).toBe(
      '6th balance batch on this branch; prefer accepting near-target results.',
    )
  })

  test('never counts a job that is not balance', () => {
    expect(
      isRun(
        decide({ ...CPU, batchesUsed: 50, job: JobKind.cases.Other.make({}) }),
      ),
    ).toBe(true)
  })
})

describe('lock files from older guards', () => {
  test('decode without a class or cost', () => {
    expect(
      decodeLockHolder(
        '{"pid":4212,"command":"bun x.ts","cwd":"/","startedAt":1}',
      ),
    ).toStrictEqual(
      Option.some({ pid: 4212, command: 'bun x.ts', cwd: '/', startedAt: 1 }),
    )
  })

  test('round trip with a class and cost', () => {
    expect(decodeLockHolder(encodeLockHolder(BALANCE))).toStrictEqual(
      Option.some(BALANCE),
    )
  })
})

describe('classifyLock', () => {
  const text = encodeLockHolder(HOLDER)

  test('reads a missing lock file as free', () => {
    expect(classifyLock(Option.none(), alwaysAlive)).toStrictEqual(
      LockState.cases.Free.make({}),
    )
  })

  test('reads a lock whose pid is alive as held', () => {
    expect(classifyLock(Option.some(text), alwaysAlive)).toStrictEqual(
      LockState.cases.Held.make({ holder: HOLDER }),
    )
  })

  test('reads a lock whose pid is gone as stale', () => {
    expect(classifyLock(Option.some(text), neverAlive)).toStrictEqual(
      LockState.cases.Stale.make({ holder: HOLDER }),
    )
  })

  test('asks about the pid in the file', () => {
    expect(
      classifyLock(Option.some(text), pid => pid === HOLDER.pid),
    ).toStrictEqual(LockState.cases.Held.make({ holder: HOLDER }))
    expect(
      classifyLock(Option.some(text), pid => pid !== HOLDER.pid),
    ).toStrictEqual(LockState.cases.Stale.make({ holder: HOLDER }))
  })

  test('reads a corrupt or wrong-shaped file as unreadable', () => {
    Array.forEach(
      [
        '',
        '{"pid":',
        'not json',
        '{"pid":"4212","command":"x","cwd":"/","startedAt":1}',
        '{"pid":4212.5,"command":"x","cwd":"/","startedAt":1}',
        '{"pid":0,"command":"x","cwd":"/","startedAt":1}',
        '{"command":"x","cwd":"/","startedAt":1}',
      ],
      corrupt => {
        expect(classifyLock(Option.some(corrupt), alwaysAlive)).toStrictEqual(
          LockState.cases.Unreadable.make({ text: corrupt }),
        )
      },
    )
  })

  test('matches a lock to its own holder by pid and start time', () => {
    expect(isSameHolder(Option.some(text), HOLDER)).toBe(true)
    expect(isSameHolder(Option.some(text), { ...HOLDER, startedAt: 1 })).toBe(
      false,
    )
    expect(isSameHolder(Option.some(text), { ...HOLDER, pid: 1 })).toBe(false)
    expect(isSameHolder(Option.none(), HOLDER)).toBe(false)
    expect(isSameHolder(Option.some('garbage'), HOLDER)).toBe(false)
  })
})

describe('ledger', () => {
  const key = budgetKey('/repo', 'main')

  test('decodes a written ledger', () => {
    const ledger = { [key]: 3, '/other#feature': 1 }
    expect(decodeLedger(encodeLedger(ledger))).toStrictEqual(ledger)
  })

  test('falls back to an empty ledger for a corrupt file', () => {
    Array.forEach(
      [
        '',
        '{',
        'null',
        '[]',
        '[1, 2]',
        '"text"',
        `{"${key}": "three"}`,
        `{"${key}": -1}`,
        `{"${key}": 1.5}`,
      ],
      corrupt => {
        expect(decodeLedger(corrupt)).toStrictEqual({})
      },
    )
  })

  test('counts, records, and resets batches per key', () => {
    const once = recordBatch({}, key)
    const twice = recordBatch(once, key)
    expect(batchesUsed({}, key)).toBe(0)
    expect(batchesUsed(twice, key)).toBe(2)
    expect(batchesUsed(twice, budgetKey('/repo', 'other'))).toBe(0)
    expect(resetBudget(twice, key)).toStrictEqual({})
    expect(resetBudget(recordBatch(twice, '/other#x'), key)).toStrictEqual({
      '/other#x': 1,
    })
  })
})

describe('parseArguments', () => {
  const command = ['bun', 'tools/balance/simulate.ts', '100']

  test('takes the command after the separator', () => {
    expect(parseArguments(['--', ...command])).toStrictEqual(
      Invocation.cases.RunCommand.make({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.cases.Enforced.make({}),
        maybeClassOverride: Option.none(),
      }),
    )
  })

  test('takes a command with no separator', () => {
    expect(Invocation.isAnyOf(['RunCommand'])(parseArguments(command))).toBe(
      true,
    )
  })

  test('reads --allow-more before the command', () => {
    expect(parseArguments(['--', '--allow-more', ...command])).toStrictEqual(
      Invocation.cases.RunCommand.make({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.cases.AllowMore.make({}),
        maybeClassOverride: Option.none(),
      }),
    )
  })

  test('leaves flags after the command to the command', () => {
    expect(parseArguments(['--', 'bun', 'x.ts', '--allow-more'])).toStrictEqual(
      Invocation.cases.RunCommand.make({
        command: ['bun', 'x.ts', '--allow-more'],
        budgetPolicy: BudgetPolicy.cases.Enforced.make({}),
        maybeClassOverride: Option.none(),
      }),
    )
  })

  test('reads --reset-budget', () => {
    expect(parseArguments(['--', '--reset-budget'])).toStrictEqual(
      Invocation.cases.ResetBudget.make({}),
    )
  })

  test('reads a class flag before the command', () => {
    const overrideOf = (flag: string) => {
      const invocation = parseArguments(['--', flag, 'sleep', '30'])
      return Invocation.isAnyOf(['RunCommand'])(invocation)
        ? invocation.maybeClassOverride
        : Option.none()
    }
    expect(overrideOf('--shared')).toStrictEqual(
      Option.some(JobClass.cases.Shared.make({})),
    )
    expect(overrideOf('--cpu')).toStrictEqual(
      Option.some(JobClass.cases.Cpu.make({})),
    )
    expect(overrideOf('--timing')).toStrictEqual(
      Option.some(JobClass.cases.Timing.make({})),
    )
    expect(overrideOf('--exclusive')).toStrictEqual(
      Option.some(JobClass.cases.Timing.make({})),
    )
    expect(
      parseArguments(['--', '--cpu', '--allow-more', ...command]),
    ).toStrictEqual(
      Invocation.cases.RunCommand.make({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.cases.AllowMore.make({}),
        maybeClassOverride: Option.some(JobClass.cases.Cpu.make({})),
      }),
    )
  })

  test('refuses two class flags', () => {
    expect(
      Invocation.isAnyOf(['ShowUsage'])(
        parseArguments(['--', '--cpu', '--shared', 'sleep', '1']),
      ),
    ).toBe(true)
  })

  test('shows usage for no command or an unknown flag', () => {
    expect(Invocation.isAnyOf(['ShowUsage'])(parseArguments([]))).toBe(true)
    expect(Invocation.isAnyOf(['ShowUsage'])(parseArguments(['--']))).toBe(true)
    expect(
      Invocation.isAnyOf(['ShowUsage'])(parseArguments(['--alow-more', 'bun'])),
    ).toBe(true)
  })
})

describe('jobKindOf', () => {
  test('knows the balance bot by its script', () => {
    expect(jobKindOf(['bun', 'tools/balance/simulate.ts'])).toStrictEqual(
      JobKind.cases.Balance.make({}),
    )
    expect(
      jobKindOf(['bun', '/abs/repo/tools/balance/simulate.ts', '200']),
    ).toStrictEqual(JobKind.cases.Balance.make({}))
    expect(jobKindOf(['bun', 'tools/audit/perf.ts'])).toStrictEqual(
      JobKind.cases.Other.make({}),
    )
  })
})

describe('reporting', () => {
  test('reports the first wait and then at most every 30 seconds', () => {
    expect(shouldReport(Option.none(), 0)).toBe(true)
    expect(shouldReport(Option.some(0), REPORT_EVERY_MS - 1)).toBe(false)
    expect(shouldReport(Option.some(0), REPORT_EVERY_MS)).toBe(true)
  })

  test('formats the summary line', () => {
    expect(formatDuration(4_400)).toBe('4s')
    expect(formatDuration(192_000)).toBe('3m 12s')
    expect(
      summaryLine({
        exitCode: 0,
        wallMs: 192_000,
        workers: 3,
        loadBefore: 18.21,
        loadAfter: 20.06,
      }),
    ).toBe(
      'exit 0 after 3m 12s with WORKERS=3, load 18.2 before and 20.1 after.',
    )
  })
})
