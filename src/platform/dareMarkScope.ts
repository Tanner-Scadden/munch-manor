import { Array, Effect, Option, Schema, pipe } from 'effect'
import { SqlClient } from 'effect/sql'

import { defineMutation } from '@munch/sync-engine'

import {
  Mark,
  SavedDareMarks,
  mergeDareMarks,
  noDareMarks,
} from '../shared/dareMarkData'
import { Difficulty } from '../shared/playerData'
import { PLAYER_SCOPE_KIND, toRejected } from './playerScopeParts'

// The dare ladder's column in the player scope (src/platform/playerScope.ts):
// `dare_marks`, the best mark opened on each difficulty as JSON, and the
// mutation that climbs it. Apart from the scope so its file stays one job.
// Shared with the sync Worker, like the scope, so it imports only `effect`,
// the sync engine, and src/shared/.

export const DareMarksJson = Schema.fromJsonString(SavedDareMarks)

const DareMarksRow = Schema.Struct({ dare_marks: DareMarksJson })

const encodeDareMarks = Schema.encodeEffect(DareMarksJson)

// NOTE: a mark opened on a difficulty: the scope keeps the higher of what it
// has and this, so two devices that climb offline both keep their best, in
// whatever order the server gets them. The mark's Schema caps it at the
// ladder's top.
/** @stability unstable */
export const ClimbedDareLadder = defineMutation({
  name: 'ClimbedDareLadder',
  version: 1,
  args: Schema.Struct({ difficulty: Difficulty, mark: Mark }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ difficulty, mark }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT dare_marks FROM ${context.table('player')} WHERE id = 1`
      const maybeKept = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(DareMarksRow)),
        Option.map(row => row.dare_marks),
      )
      if (Option.isNone(maybeKept) || maybeKept.value[difficulty] >= mark) {
        return
      }
      const json = yield* Effect.mapError(
        encodeDareMarks(
          mergeDareMarks(maybeKept.value, {
            ...noDareMarks,
            [difficulty]: mark,
          }),
        ),
        toRejected,
      )
      yield* sql`UPDATE ${context.table('player')} SET dare_marks = ${json} WHERE id = 1`
    }),
})
