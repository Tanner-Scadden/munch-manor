import { Array, Number, Order } from 'effect'
import { describe, expect, test } from 'vitest'

import { fileMsOf, runOrder, shardFiles } from './testSequencer'

const SLOW = [
  'src/world/waves/__tests__/pacing.sim.test.ts',
  'src/world/level/__tests__/pathing.flat.sim.test.ts',
  'src/input/__tests__/couch.sim.test.ts',
  'tools/sprites/atlas.test.ts',
]

const FILES = [
  ...SLOW,
  ...Array.makeBy(200, index => `src/fast/__tests__/f${index}.test.ts`),
]

const shardsOf = (files: ReadonlyArray<string>, count: number) =>
  Array.makeBy(count, index => shardFiles({ files, index: index + 1, count }))

describe('shardFiles', () => {
  test('puts every file in exactly one shard', () => {
    const shards = shardsOf(FILES, 4)
    expect(Array.sort(Array.flatten(shards), Order.String)).toEqual(
      Array.sort(FILES, Order.String),
    )
  })

  test('splits by time, each slow file on a shard of its own', () => {
    const shards = shardsOf(FILES, 4)
    const slowPerShard = Array.map(
      shards,
      shard => Array.filter(shard, file => Array.contains(SLOW, file)).length,
    )
    expect(slowPerShard).toEqual([1, 1, 1, 1])
    const totals = Array.map(shards, shard =>
      Number.sumAll(Array.map(shard, fileMsOf)),
    )
    // NOTE: the 200 fast files fill the shards under the shorter slow files,
    // so no shard runs past the slowest file by more than a fast file.
    expect(Math.max(...totals)).toBe(fileMsOf(SLOW[0] ?? ''))
  })

  test('splits the same whatever order the files come in', () => {
    const reversed = Array.reverse(FILES)
    expect(shardsOf(reversed, 4)).toEqual(shardsOf(FILES, 4))
  })
})

describe('runOrder', () => {
  test("keeps each project's files together, the slowest project first", () => {
    expect(
      runOrder([
        { file: 'src/a/__tests__/a.test.ts', project: 'game' },
        { file: 'tools/sprites/atlas.test.ts', project: 'game' },
        { file: 'src/b/__tests__/b.scene.test.ts', project: 'page' },
        { file: 'src/world/waves/__tests__/waves.sim.test.ts', project: 'sim' },
        {
          file: 'src/world/waves/__tests__/pacing.sim.test.ts',
          project: 'sim',
        },
      ]),
    ).toEqual([
      'src/world/waves/__tests__/pacing.sim.test.ts',
      'src/world/waves/__tests__/waves.sim.test.ts',
      'tools/sprites/atlas.test.ts',
      'src/a/__tests__/a.test.ts',
      'src/b/__tests__/b.scene.test.ts',
    ])
  })
})
