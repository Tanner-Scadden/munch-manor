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

export const DareMarksJson = Schema.fromJsonString(SavedDareMarks)

const DareMarksRow = Schema.Struct({ dare_marks: DareMarksJson })

const encodeDareMarks = Schema.encodeEffect(DareMarksJson)

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
