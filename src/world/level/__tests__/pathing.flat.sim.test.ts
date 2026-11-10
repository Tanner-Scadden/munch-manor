import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import { EVERY_LEVEL } from '../../../test/model.fixture'
import { CLEARANCES } from '../../../test/testing'
import { TOLL_SETS, mismatchedOrigins } from './pathing.flat.fixture'

// NOTE: every level, each house with its exits shut and open, from every
// seventh tile. A full house takes about 9 s over both clearances and both
// toll sets, so each pair is its own test, well inside the timeout on a
// busy CI runner, and the whole file runs in the full tier only.
const CASES = Array.flatMap(EVERY_LEVEL, level =>
  Array.flatMap(CLEARANCES, clearance =>
    Array.map(
      TOLL_SETS,
      ([name, tolls]) => [level.key, clearance, name, level, tolls] as const,
    ),
  ),
)

describe('the flat flow field answers as the search it replaced did', () => {
  test.each(CASES)(
    '%s: from every seventh tile, %s, %s',
    (_key, clearance, _name, level, tolls) => {
      expect(mismatchedOrigins(level, 7, clearance, tolls)).toEqual([])
    },
  )
})
