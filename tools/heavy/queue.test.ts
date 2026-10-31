import { Array, Number, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  BACKFILL_GRACE_MS,
  BUDGET_REFUSE_AT,
  DEFAULT_CHUNK_RUNS,
  DEFAULT_LEASE_MS,
  Decision,
  Handover,
  type HeldTurn,
  JobClass,
  JobKind,
  LEASE_REMIND_MS,
  type LockHolder,
  LockState,
  RECENT_TURN_MS,
  type Snapshot,
  chunkRunsOf,
  decide,
  decideHandover,
  decodeHeldTurn,
  encodeHeldTurn,
  isAheadInQueue,
  isPastLease,
  lastTurnAt,
  maybeLeaseWarning,
  maybeWaitReason,
  nextChunk,
  turnFileKey,
} from './decision'
import {
  BALANCE,
  BASE,
  CPU,
  NOW,
  PERF,
  SHARED,
  SHOTS,
  TIMING,
  held,
  isRun,
  isWait,
  waiting,
} from './decision.fixture'

// TURNS: round robin, handover, leases, and the max wait

const OTHER_TREE = '/other-tree'
const THIRD_TREE = '/third-tree'

const turnAt = (cwd: string, agoMs: number): HeldTurn => ({
  cwd,
  at: NOW - agoMs,
})

describe('round robin by worktree', () => {
  // NOTE: a Timing job from another worktree arrived 1 second ago. A perf
  // run from /repo has waited for 5 seconds more.
  const LATER_FROM_OTHER: Snapshot = {
    ...TIMING,
    cwd: OTHER_TREE,
    arrivedAt: NOW - 1000,
    waiters: [waiting(PERF, 5000)],
  }

  test('goes by arrival while no worktree had a recent turn', () => {
    expect(isWait(decide(LATER_FROM_OTHER))).toBe(true)
  })

  test('puts a worktree that just had a turn behind other worktrees', () => {
    const snapshot = {
      ...LATER_FROM_OTHER,
      turns: [turnAt('/repo', 60_000)],
    }
    expect(isAheadInQueue(snapshot, waiting(PERF, 5000))).toBe(false)
    expect(isRun(decide(snapshot))).toBe(true)
    // NOTE: and from /repo's side, its own job now waits.
    expect(
      isWait(
        decide({
          ...TIMING,
          pid: PERF.pid,
          arrivedAt: NOW - 7000,
          turns: [turnAt('/repo', 60_000)],
          waiters: [
            { ...PERF, pid: 7000, cwd: OTHER_TREE, startedAt: NOW - 1000 },
          ],
        }),
      ),
    ).toBe(true)
  })

  test('forgets a turn after RECENT_TURN_MS', () => {
    expect(
      isWait(
        decide({
          ...LATER_FROM_OTHER,
          turns: [turnAt('/repo', RECENT_TURN_MS + 1000)],
        }),
      ),
    ).toBe(true)
    expect(
      lastTurnAt([turnAt('/repo', RECENT_TURN_MS + 1000)], '/repo', NOW),
    ).toBe(0)
  })

  test('of two worktrees with recent turns, the one whose turn ended first goes first', () => {
    const snapshot = {
      ...LATER_FROM_OTHER,
      turns: [turnAt('/repo', 60_000), turnAt(OTHER_TREE, 30_000)],
    }
    expect(isWait(decide(snapshot))).toBe(true)
    expect(
      isRun(
        decide({
          ...snapshot,
          turns: [turnAt('/repo', 30_000), turnAt(OTHER_TREE, 60_000)],
        }),
      ),
    ).toBe(true)
  })

  test('alternates worktrees instead of running one worktree back to back', () => {
    // NOTE: /repo queued two perf runs before /other-tree queued one. Its
    // first ran; the other worktree goes next, then /repo again.
    const second = waiting(PERF, 60_000)
    const fromOther = {
      ...PERF,
      pid: 8100,
      cwd: OTHER_TREE,
      startedAt: NOW - 30_000,
    }
    const turns = [turnAt('/repo', 5000)]
    const secondTurn = decide({
      ...TIMING,
      pid: second.pid,
      arrivedAt: second.startedAt,
      turns,
      waiters: [fromOther],
    })
    const otherTurn = decide({
      ...TIMING,
      pid: fromOther.pid,
      cwd: OTHER_TREE,
      arrivedAt: fromOther.startedAt,
      turns,
      waiters: [second],
    })
    expect(isWait(secondTurn)).toBe(true)
    expect(isRun(otherTurn)).toBe(true)
  })

  test('names a worktree file by a short hash of its path', () => {
    expect(turnFileKey('/repo')).toMatch(/^[0-9a-f]{8}$/)
    expect(turnFileKey('/repo')).not.toBe(turnFileKey(OTHER_TREE))
    expect(decodeHeldTurn(encodeHeldTurn(turnAt('/repo', 0)))).toEqual(
      Option.some(turnAt('/repo', 0)),
    )
    expect(decodeHeldTurn('{"cwd":1}')).toEqual(Option.none())
  })
})

describe('chunk handover and re-queue order', () => {
  test('keeps the turn when nobody else waits', () => {
    expect(Handover.isAnyOf(['Keep'])(decideHandover(7000, []))).toBe(true)
    expect(
      Handover.isAnyOf(['Keep'])(
        decideHandover(7000, [{ ...BALANCE, pid: 7000 }]),
      ),
    ).toBe(true)
  })

  test('hands over when any other job waits, and names it', () => {
    const handover = decideHandover(7000, [waiting(SHOTS, 0)])
    expect(handover).toEqual(
      Handover.cases.HandOver.make({
        reason: '1 job is waiting (pid 5102: bun shots9.ts)',
      }),
    )
  })

  // NOTE: a balance batch from /repo yielded half a second ago and queued
  // again; its worktree's turn ended then.
  const REQUEUED: Snapshot = {
    ...CPU,
    arrivedAt: NOW - 500,
    turns: [turnAt('/repo', 500)],
    job: JobKind.cases.Other.make({}),
  }

  test('goes behind a job from its own worktree that arrived while it ran', () => {
    const arrivedWhileRunning = waiting(PERF, 60_000)
    expect(isAheadInQueue(REQUEUED, arrivedWhileRunning)).toBe(true)
    expect(
      isWait(decide({ ...REQUEUED, waiters: [arrivedWhileRunning] })),
    ).toBe(true)
  })

  test('goes behind another worktree, even one that arrived after it yielded', () => {
    const fromOther = { ...PERF, cwd: OTHER_TREE, startedAt: NOW - 100 }
    expect(isAheadInQueue(REQUEUED, fromOther)).toBe(true)
    expect(isWait(decide({ ...REQUEUED, waiters: [fromOther] }))).toBe(true)
  })

  test('stays ahead of its own worktree jobs that arrive after it yielded', () => {
    const laterSameTree = { ...PERF, startedAt: NOW - 100 }
    expect(isAheadInQueue(REQUEUED, laterSameTree)).toBe(false)
    expect(isRun(decide({ ...REQUEUED, waiters: [laterSameTree] }))).toBe(true)
  })

  test('is never refused or counted again as a balance batch', () => {
    expect(isRun(decide({ ...REQUEUED, batchesUsed: BUDGET_REFUSE_AT }))).toBe(
      true,
    )
  })

  test('sizes a chunk to whole rounds of its workers, about 25 runs', () => {
    expect(chunkRunsOf(1, Option.none())).toBe(DEFAULT_CHUNK_RUNS)
    expect(chunkRunsOf(4, Option.none())).toBe(28)
    expect(chunkRunsOf(7, Option.none())).toBe(28)
    expect(chunkRunsOf(8, Option.none())).toBe(32)
    expect(chunkRunsOf(8, Option.some(10))).toBe(10)
    expect(nextChunk(0, 50, 28)).toEqual([0, 28])
    expect(nextChunk(28, 50, 28)).toEqual([28, 50])
    expect(nextChunk(0, 50, 0)).toEqual([0, 50])
  })
})

describe('leases', () => {
  const LONG_PERF: LockHolder = { ...PERF, startedAt: NOW - 12 * 60_000 }

  test('a solo hold is past its lease after 10 minutes, or its own lease', () => {
    expect(DEFAULT_LEASE_MS).toBe(10 * 60_000)
    expect(isPastLease(LONG_PERF, NOW)).toBe(true)
    expect(isPastLease({ ...PERF, startedAt: NOW - 9 * 60_000 }, NOW)).toBe(
      false,
    )
    expect(isPastLease({ ...LONG_PERF, leaseMs: 15 * 60_000 }, NOW)).toBe(false)
    // NOTE: a chunked job that offered to yield 2 minutes ago renewed it.
    expect(
      isPastLease({ ...LONG_PERF, leaseFrom: NOW - 2 * 60_000 }, NOW),
    ).toBe(false)
  })

  test('warns once past the lease, then every few minutes', () => {
    const warning = maybeLeaseWarning({
      holder: LONG_PERF,
      now: NOW,
      maybeLastWarnedAt: Option.none(),
      waiters: [waiting(SHOTS, 0)],
    })
    expect(Option.getOrThrow(warning)).toContain(
      'LEASE UP: pid 4300: bun tools/audit/perf.ts has held the lock 12m 0s, past its 10 minute lease',
    )
    expect(Option.getOrThrow(warning)).toContain('1 waiting: pid 5102')
    expect(
      maybeLeaseWarning({
        holder: LONG_PERF,
        now: NOW,
        maybeLastWarnedAt: Option.some(NOW - 60_000),
        waiters: [],
      }),
    ).toEqual(Option.none())
    expect(
      Option.isSome(
        maybeLeaseWarning({
          holder: LONG_PERF,
          now: NOW,
          maybeLastWarnedAt: Option.some(NOW - LEASE_REMIND_MS),
          waiters: [],
        }),
      ),
    ).toBe(true)
    expect(
      maybeLeaseWarning({
        holder: PERF,
        now: PERF.startedAt + 60_000,
        maybeLastWarnedAt: Option.none(),
        waiters: [],
      }),
    ).toEqual(Option.none())
  })

  test('a waiting job names a holder past its lease', () => {
    const reason = maybeWaitReason({
      ...TIMING,
      lock: LockState.cases.Held.make({ holder: LONG_PERF }),
    })
    expect(Option.getOrThrow(reason)).toBe(
      'lock held by pid 4300: bun tools/audit/perf.ts; it has held the lock 12m 0s, past its 10 minute lease',
    )
    expect(
      Option.getOrThrow(
        maybeWaitReason({
          ...TIMING,
          lock: LockState.cases.Held.make({
            holder: { ...LONG_PERF, startedAt: NOW - 60_000 },
          }),
        }),
      ),
    ).not.toContain('lease')
  })

  test('a Shared job kept out by the budget names a CPU holder past its lease', () => {
    const longBalance = { ...BALANCE, startedAt: NOW - 11 * 60_000, cost: 7 }
    const reason = maybeWaitReason({
      ...SHARED,
      load: 8,
      lock: LockState.cases.Held.make({ holder: longBalance }),
    })
    expect(Option.getOrThrow(reason)).toContain(
      'pid 4212: bun tools/balance/simulate.ts 100 has held the lock 11m 0s, past its 10 minute lease',
    )
  })
})

// THE MAX WAIT
// A small model of the queue over time: solo jobs from several worktrees
// arrive, wait by `decide`, and a chunked job asks `decideHandover` at each
// boundary. It checks what chunking is for: no job waits long on one long
// holder.

type ModelJob = Readonly<{
  pid: number
  cwd: string
  jobClass: 'Timing' | 'Cpu' | 'Shared'
  arriveAt: number
  workMs: number
  maybeChunkMs: Option.Option<number>
}>

type Waits = ReadonlyMap<number, ReadonlyArray<number>>

const TICK_MS = 10_000
const MINUTE = 60_000

const markerOf = (job: ModelJob, since: number): LockHolder => ({
  pid: job.pid,
  command: `job ${job.pid}`,
  cwd: job.cwd,
  startedAt: since,
  jobClass: job.jobClass,
  cost: 1,
})

const runQueue = (jobs: ReadonlyArray<ModelJob>): Waits => {
  const waits = new Map<number, Array<number>>()
  const waitingSince = new Map<number, number>()
  const done = new Map<number, number>()
  const turns: Array<HeldTurn> = []
  let sharedRunning: ReadonlyArray<{
    job: ModelJob
    holder: LockHolder
    endsAt: number
  }> = []
  let running:
    | { job: ModelJob; holder: LockHolder; partEndsAt: number; partMs: number }
    | undefined
  const partOf = (job: ModelJob): number => {
    const left = job.workMs - (done.get(job.pid) ?? 0)
    return Option.match(job.maybeChunkMs, {
      onNone: () => left,
      onSome: chunkMs => Math.min(chunkMs, left),
    })
  }
  const markers = (except: number): ReadonlyArray<LockHolder> =>
    Array.flatMap(jobs, job =>
      job.pid !== except && waitingSince.has(job.pid)
        ? [markerOf(job, waitingSince.get(job.pid)!)]
        : [],
    )
  for (let now = 0; now < 6 * 60 * MINUTE; now += TICK_MS) {
    jobs.forEach(job => {
      if (job.arriveAt === now) {
        waitingSince.set(job.pid, now)
      }
    })
    sharedRunning = Array.filter(sharedRunning, ({ job, endsAt }) => {
      if (now < endsAt) {
        return true
      }
      turns.push({ cwd: job.cwd, at: now })
      return false
    })
    if (running !== undefined && now >= running.partEndsAt) {
      const { job } = running
      done.set(job.pid, (done.get(job.pid) ?? 0) + running.partMs)
      const isFinished = done.get(job.pid)! >= job.workMs
      if (isFinished) {
        turns.push({ cwd: job.cwd, at: now })
        running = undefined
      } else if (
        Handover.isAnyOf(['HandOver'])(
          decideHandover(job.pid, markers(job.pid)),
        )
      ) {
        turns.push({ cwd: job.cwd, at: now })
        waitingSince.set(job.pid, now)
        running = undefined
      } else {
        const partMs = partOf(job)
        running = { ...running, partEndsAt: now + partMs, partMs }
      }
    }
    // NOTE: every waiting job asks, in an order unrelated to the queue, so
    // only `decide` picks who goes.
    const askers = Array.filter(jobs, job =>
      waitingSince.has(job.pid),
    ).reverse()
    askers.forEach(job => {
      const since = waitingSince.get(job.pid)!
      const decision = decide({
        ...BASE,
        pid: job.pid,
        cwd: job.cwd,
        turns: Array.filter(turns, turn => now - turn.at < RECENT_TURN_MS),
        now,
        jobClass:
          job.jobClass === 'Cpu'
            ? JobClass.cases.Cpu.make({})
            : job.jobClass === 'Shared'
              ? JobClass.cases.Shared.make({})
              : JobClass.cases.Timing.make({}),
        job: JobKind.cases.Other.make({}),
        arrivedAt: since,
        lock:
          running === undefined
            ? LockState.cases.Free.make({})
            : LockState.cases.Held.make({ holder: running.holder }),
        waiters: markers(job.pid),
        shared: Array.map(sharedRunning, ({ holder }, index) =>
          held(index + 1, holder),
        ),
      })
      if (isRun(decision) && job.jobClass === 'Shared') {
        waitingSince.delete(job.pid)
        waits.set(job.pid, [...(waits.get(job.pid) ?? []), now - since])
        sharedRunning = [
          ...sharedRunning,
          { job, holder: markerOf(job, now), endsAt: now + job.workMs },
        ]
      } else if (isRun(decision) && running === undefined) {
        waitingSince.delete(job.pid)
        waits.set(job.pid, [...(waits.get(job.pid) ?? []), now - since])
        const partMs = partOf(job)
        running = {
          job,
          holder: { ...markerOf(job, now) },
          partEndsAt: now + partMs,
          partMs,
        }
      }
    })
  }
  return waits
}

const allWaits = (waits: Waits): ReadonlyArray<number> =>
  Array.flatten(globalThis.Array.from(waits.values()))

describe('the max wait', () => {
  // NOTE: /repo starts an hour of balance runs in 2 minute chunks. Other
  // worktrees arrive while it runs: timing audits, another chunked batch,
  // and /repo's own perf run.
  const BUSY_HOUR: ReadonlyArray<ModelJob> = [
    {
      pid: 1,
      cwd: '/repo',
      jobClass: 'Cpu',
      arriveAt: 0,
      workMs: 60 * MINUTE,
      maybeChunkMs: Option.some(2 * MINUTE),
    },
    {
      pid: 2,
      cwd: OTHER_TREE,
      jobClass: 'Timing',
      arriveAt: 1 * MINUTE,
      workMs: 5 * MINUTE,
      maybeChunkMs: Option.none(),
    },
    {
      pid: 3,
      cwd: '/repo',
      jobClass: 'Timing',
      arriveAt: 2 * MINUTE,
      workMs: 4 * MINUTE,
      maybeChunkMs: Option.none(),
    },
    {
      pid: 4,
      cwd: THIRD_TREE,
      jobClass: 'Cpu',
      arriveAt: 3 * MINUTE,
      workMs: 20 * MINUTE,
      maybeChunkMs: Option.some(2 * MINUTE),
    },
    {
      pid: 5,
      cwd: OTHER_TREE,
      jobClass: 'Timing',
      arriveAt: 7 * MINUTE,
      workMs: 3 * MINUTE,
      maybeChunkMs: Option.some(MINUTE),
    },
    {
      pid: 6,
      cwd: THIRD_TREE,
      jobClass: 'Timing',
      arriveAt: 30 * MINUTE,
      workMs: 2 * MINUTE,
      maybeChunkMs: Option.none(),
    },
  ]

  test('a job that arrives mid-chunk starts at the next chunk boundary', () => {
    const waits = runQueue(BUSY_HOUR)
    // NOTE: pid 2 arrived 1 minute into a 2 minute chunk.
    expect(waits.get(2)?.[0]).toBe(1 * MINUTE)
  })

  test('no job waits more than 15 minutes, and every job finishes', () => {
    const waits = runQueue(BUSY_HOUR)
    expect(globalThis.Array.from(waits.keys()).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    expect(Math.max(...allWaits(waits))).toBeLessThanOrEqual(15 * MINUTE)
  })

  test('an unchunked hour would make the same jobs wait far longer', () => {
    const waits = runQueue(
      Array.map(BUSY_HOUR, job =>
        job.pid === 1 ? { ...job, maybeChunkMs: Option.none() } : job,
      ),
    )
    expect(Math.max(...allWaits(waits))).toBeGreaterThan(15 * MINUTE)
  })
})

describe('backfill', () => {
  // NOTE: a nightly balance batch holds the solo lock with 4 workers, and a
  // splash timing run has waited 30 seconds for it. A screenshot job
  // arrives now.
  const NIGHTLY: LockHolder = {
    ...BALANCE,
    command: 'bun tools/balance/nightly.ts',
    cost: 4,
  }
  const SPLASH: LockHolder = {
    ...PERF,
    pid: 4400,
    command: 'bun tools/audit/splash.ts',
    startedAt: NOW - 30_000,
  }
  const SHOT_BESIDE_NIGHTLY: Snapshot = {
    ...SHARED,
    cost: 1,
    lock: LockState.cases.Held.make({ holder: NIGHTLY }),
    waiters: [SPLASH],
  }

  test('a Shared job that fits starts beside the CPU job, ahead of a Timing waiter', () => {
    const decision = decide(SHOT_BESIDE_NIGHTLY)
    expect(isRun(decision)).toBe(true)
    expect(Decision.isAnyOf(['Run'])(decision) && decision.notes).toEqual([
      'Backfill: starting beside the CPU job ahead of pid 4400: bun tools/audit/splash.ts, which waits for that job anyway.',
    ])
  })

  test('also passes a CPU job waiting for the running one', () => {
    expect(
      isRun(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          waiters: [{ ...BALANCE, pid: 4500, startedAt: NOW - 30_000 }],
        }),
      ),
    ).toBe(true)
  })

  test('stops once the waiter has waited the grace period', () => {
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          waiters: [{ ...SPLASH, startedAt: NOW - BACKFILL_GRACE_MS }],
        }),
      ),
    ).toBe(true)
  })

  test('never passes a waiter that waits only for Shared jobs to drain', () => {
    // NOTE: the batch yielded; the splash run now waits for the shots that
    // backfilled, and later shots queue behind it.
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          lock: LockState.cases.Free.make({}),
          shared: [held(1, SHOTS)],
        }),
      ),
    ).toBe(true)
  })

  test('never runs beside a Timing holder', () => {
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          lock: LockState.cases.Held.make({ holder: PERF }),
        }),
      ),
    ).toBe(true)
  })

  test('still has to fit the budget', () => {
    expect(isWait(decide({ ...SHOT_BESIDE_NIGHTLY, load: 8 }))).toBe(true)
  })

  test('is only for Shared jobs: a later Timing job still waits its turn', () => {
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          jobClass: JobClass.cases.Timing.make({}),
        }),
      ),
    ).toBe(true)
  })
})

describe('screenshot waits in a typical mix', () => {
  // NOTE: the nightly suite runs for an hour in 30 second chunks. A splash
  // timing run arrives at 1 minute and yields between its three 1 minute
  // profiles. Two worktrees queue a 1 minute screenshot job every 2
  // minutes.
  const shots = (
    cwd: string,
    firstPid: number,
    offset: number,
  ): ReadonlyArray<ModelJob> =>
    Array.makeBy(25, index => ({
      pid: firstPid + index,
      cwd,
      jobClass: 'Shared',
      arriveAt: offset + index * 2 * MINUTE,
      workMs: MINUTE,
      maybeChunkMs: Option.none(),
    }))
  const MIX: ReadonlyArray<ModelJob> = [
    {
      pid: 1,
      cwd: '/repo',
      jobClass: 'Cpu',
      arriveAt: 0,
      workMs: 60 * MINUTE,
      maybeChunkMs: Option.some(MINUTE / 2),
    },
    {
      pid: 2,
      cwd: OTHER_TREE,
      jobClass: 'Timing',
      arriveAt: MINUTE,
      workMs: 3 * MINUTE,
      maybeChunkMs: Option.some(MINUTE),
    },
    ...shots(OTHER_TREE, 100, 20_000),
    ...shots(THIRD_TREE, 200, 50_000),
  ]

  test('screenshot jobs wait about a minute at most, and the timing run still gets its turns', () => {
    const waits = runQueue(MIX)
    const shotWaits = Array.flatMap(
      Array.makeBy(25, index => index),
      index => [
        ...(waits.get(100 + index) ?? []),
        ...(waits.get(200 + index) ?? []),
      ],
    )
    expect(shotWaits).toHaveLength(50)
    // NOTE: a shot that arrives as a timing profile starts waits out that
    // minute alone; every other wait is far shorter.
    expect(Math.max(...shotWaits)).toBeLessThanOrEqual(MINUTE + TICK_MS)
    expect(Number.sumAll(shotWaits) / shotWaits.length).toBeLessThan(15_000)
    expect(waits.get(2)).toHaveLength(3)
    expect(Math.max(...(waits.get(2) ?? []))).toBeLessThanOrEqual(5 * MINUTE)
  })
})
