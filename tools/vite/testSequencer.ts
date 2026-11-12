// How vitest splits the test files into CI's shards, and the order a run
// starts them in. Vitest's own shards split by file count, and its own order
// runs each project's files apart and an unknown file by its size, so one
// shard drew the 77 s pacing replay and started it last. Here a shard takes
// files by their time, and a run starts its slowest file first.

import { Array, Option, Order, Record, String } from 'effect'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

import { shuffle } from '../../src/shared/prng.ts'

// NOTE: each file's time in milliseconds, from a CI run's per-file times
// (a test job's log, the `✓ <project> <file> (n tests) <time>` lines), for
// files of 2 s or more. A file not listed counts as DEFAULT_FILE_MS. Refresh
// it when a shard runs much longer than the others: an old time only makes
// the shards uneven, never skips a file.
const FILE_MS: Readonly<Record<string, number>> = {
  'src/world/waves/__tests__/pacing.sim.test.ts': 77_300,
  'src/world/level/__tests__/pathing.flat.sim.test.ts': 56_100,
  'src/input/__tests__/couch.sim.test.ts': 32_000,
  'tools/sprites/atlas.test.ts': 21_000,
  'src/world/zombies/__tests__/horde.sim.test.ts': 15_500,
  'src/features/bots/__tests__/teammateBot.sim.test.ts': 10_600,
  'tools/balance/snapshot.sim.test.ts': 7_900,
  'tools/determinism/determinism.sim.test.ts': 7_800,
  'src/platform/__tests__/store.test.ts': 6_900,
  'src/features/profile/blocks/look/__tests__/closetSync.test.ts': 6_600,
  'src/world/gear/__tests__/traps.story.test.ts': 6_500,
  'src/features/home/__tests__/menu.scene.test.ts': 5_400,
  'src/features/hud/__tests__/mobileHud.scene.test.ts': 4_600,
  'src/app/__tests__/scene.test.ts': 4_500,
  'src/world/waves/__tests__/waves.sim.test.ts': 4_000,
  'src/features/dare/__tests__/pocketCard.scene.test.ts': 3_900,
  'src/render/__tests__/perf.scene.test.ts': 3_800,
  'src/world/zombies/__tests__/boss.story.test.ts': 3_700,
  'src/world/gear/__tests__/powerups.story.test.ts': 3_700,
  'src/features/lobby/__tests__/lobby.scene.test.ts': 3_400,
  'src/world/level/__tests__/arena.flat.test.ts': 3_400,
  'src/world/zombies/__tests__/crawler.sim.test.ts': 3_300,
  'src/world/run/__tests__/difficulty.sim.test.ts': 3_300,
  'tools/learn/replay.sim.test.ts': 3_000,
  'tools/determinism/cosmetics.test.ts': 2_900,
  'src/world/waves/__tests__/pacing.story.test.ts': 2_800,
  'src/features/profile/blocks/look/__tests__/closet.scene.test.ts': 2_700,
  'src/features/lobby/__tests__/modes.scene.test.ts': 2_600,
  'src/render/room/__tests__/roomImages.test.ts': 2_600,
  'src/features/profile/blocks/look/__tests__/scene.test.ts': 2_500,
  'src/world/zombies/__tests__/yard.sim.test.ts': 2_500,
  'src/features/profile/__tests__/profile.scene.test.ts': 2_400,
  'src/app/__tests__/story.test.ts': 2_300,
  'src/world/zombies/__tests__/bossAttacks.story.test.ts': 2_200,
  'src/features/menus/__tests__/pause.scene.test.ts': 2_200,
  'src/render/__tests__/portrait.scene.test.ts': 2_100,
  'src/world/zombies/__tests__/lastZombie.story.test.ts': 2_000,
  'src/features/support/__tests__/support.scene.test.ts': 2_000,
  'src/world/run/__tests__/modifiers.story.test.ts': 2_000,
}

// NOTE: about the mean of the files under 2 s in the same run.
const DEFAULT_FILE_MS = 400

export const fileMsOf = (file: string): number =>
  Option.getOrElse(Record.get(FILE_MS, file), () => DEFAULT_FILE_MS)

type Timed = Readonly<{ file: string; ms: number }>

// NOTE: slowest first, then by path, so every runner orders the same files
// the same way.
const slowestFirst: Order.Order<Timed> = Order.combine(
  Order.mapInput(Order.flip(Order.Number), ({ ms }: Timed) => ms),
  Order.mapInput(Order.String, ({ file }: Timed) => file),
)

const timedOf = (files: ReadonlyArray<string>): ReadonlyArray<Timed> =>
  Array.sort(
    Array.map(files, file => ({ file, ms: fileMsOf(file) })),
    slowestFirst,
  )

// NOTE: the longest first, each onto the shard with the least time so far
// (the lowest index on a tie). Each runner computes the whole split from the
// same file list and keeps its own shard, so every file lands in exactly one.
export const shardFiles = (
  split: Readonly<{
    files: ReadonlyArray<string>
    index: number
    count: number
  }>,
): ReadonlyArray<string> => {
  const [, owners] = Array.mapAccum(
    timedOf(split.files),
    Array.makeBy(split.count, () => 0),
    (totals, { file, ms }) => {
      const owner = Array.reduce(totals, 0, (best, total, shard) =>
        total < (totals[best] ?? 0) ? shard : best,
      )
      return [
        Array.map(totals, (total, shard) =>
          shard === owner ? total + ms : total,
        ),
        { file, owner },
      ] as const
    },
  )
  return Array.map(
    Array.filter(owners, ({ owner }) => owner === split.index - 1),
    ({ file }) => file,
  )
}

type Placed = Readonly<{ file: string; project: string }>

type ProjectGroup = Readonly<{
  project: string
  timed: ReadonlyArray<Timed>
  slowest: number
}>

// NOTE: each project's files stay together, as in vitest's own order, since a
// worker that moves between projects loads their modules again (the fast tier
// ran a third slower interleaved). The project holding the slowest file goes
// first, so the sim replays start at once rather than after every other
// project, and within a project the slowest file goes first.
export const runOrder = (
  placed: ReadonlyArray<Placed>,
): ReadonlyArray<string> => {
  const groups: ReadonlyArray<ProjectGroup> = Array.map(
    Record.toEntries(Array.groupBy(placed, ({ project }) => project)),
    ([project, members]) => {
      const timed = timedOf(Array.map(members, ({ file }) => file))
      return {
        project,
        timed,
        slowest: Option.getOrElse(
          Option.map(Array.head(timed), ({ ms }) => ms),
          () => 0,
        ),
      }
    },
  )
  const projectOrder: Order.Order<ProjectGroup> = Order.combine(
    Order.mapInput(
      Order.flip(Order.Number),
      ({ slowest }: ProjectGroup) => slowest,
    ),
    Order.mapInput(Order.String, ({ project }: ProjectGroup) => project),
  )
  return Array.flatMap(
    Array.sort(groups, projectOrder),
    (group: ProjectGroup): ReadonlyArray<string> =>
      Array.map(group.timed, ({ file }) => file),
  )
}

const relativeFile = (root: string, moduleId: string): string =>
  String.startsWith(`${root}/`)(moduleId)
    ? String.slice(root.length + 1)(moduleId)
    : moduleId

const inOrder = (
  specs: ReadonlyArray<TestSpecification>,
  root: string,
  files: ReadonlyArray<string>,
): Array<TestSpecification> =>
  Array.flatMap(files, file =>
    Array.filter(specs, spec => relativeFile(root, spec.moduleId) === file),
  )

// NOTE: vitest's `sequence.sequencer` (vitest.config.ts). `--sequence.shuffle`
// still shuffles the files, from `--sequence.seed`, as the nightly asks:
// with a sequencer of its own vitest no longer picks its RandomSequencer.
export class TimedSequencer extends BaseSequencer {
  override shard(specs: Array<TestSpecification>) {
    const { root, shard } = this.ctx.config
    const files = Array.dedupe(
      Array.map(specs, spec => relativeFile(root, spec.moduleId)),
    )
    return Promise.resolve(
      shard === undefined
        ? specs
        : inOrder(
            specs,
            root,
            shardFiles({ files, index: shard.index, count: shard.count }),
          ),
    )
  }

  override sort(specs: Array<TestSpecification>) {
    const { root, sequence } = this.ctx.config
    const placed = Array.dedupeWith(
      Array.map(specs, spec => ({
        file: relativeFile(root, spec.moduleId),
        project: spec.project.name,
      })),
      (a: Placed, b: Placed) => a.file === b.file,
    )
    const ordered = Array.match(placed, {
      onEmpty: () => [],
      onNonEmpty: nonEmpty =>
        sequence.shuffle === true
          ? Array.map(shuffle(sequence.seed, nonEmpty)[1], ({ file }) => file)
          : runOrder(nonEmpty),
    })
    return Promise.resolve(inOrder(specs, root, ordered))
  }
}
