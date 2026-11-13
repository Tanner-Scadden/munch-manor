import { Array, Effect, Function, Option, Schema, pipe } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type ApplyContext, MutationRejected } from '@munch/sync-engine'

import { DayStamp } from '../shared/dayStamp'
import {
  CrewMate,
  ProofEnding,
  type ProofEntry,
  type SavedProof,
  isEarlierStamp,
} from '../shared/proofData'

// The Proof Shelf's rows in the player scope (src/platform/playerScope.ts):
// the `proof` table, one row per thing per difficulty, and the rule its
// mutation applies, apart from the scope so its file stays one job. Shared
// with the sync Worker, like the scope, so it imports only `effect`, the
// sync engine, and src/shared/.

export const PROOF_TABLE = 'proof'

export const ProofRow = Schema.Struct({
  thing: Schema.String,
  difficulty: Schema.String,
  wave: Schema.Finite,
  hero: Schema.String,
  crew: Schema.fromJsonString(Schema.Array(CrewMate)),
  day: Schema.NullOr(DayStamp),
  ending: ProofEnding,
})
export type ProofRow = typeof ProofRow.Type

const rowOfProof = (entry: ProofEntry): ProofRow => ({
  thing: entry.thing,
  difficulty: entry.difficulty,
  ...entry.stamp,
})

export const proofOfRow = (row: ProofRow): ProofEntry => ({
  thing: row.thing,
  difficulty: row.difficulty,
  stamp: {
    wave: row.wave,
    hero: row.hero,
    crew: row.crew,
    day: row.day,
    ending: row.ending,
  },
})

const encodeProofRows = Schema.encodeEffect(Schema.Array(ProofRow))

const decodeProofRow = Schema.decodeUnknownOption(ProofRow)

// NOTE: a shelf's rows as the scope's SQL writes them, the crew as JSON.
export const encodedProofRows = (proof: SavedProof) =>
  Effect.mapError(encodeProofRows(Array.map(proof, rowOfProof)), error =>
    MutationRejected.make({ reason: error.message }),
  )

const readSlot = (
  context: ApplyContext,
  entry: ProofEntry,
): Effect.Effect<
  Option.Option<ProofEntry>,
  SqlError.SqlError,
  SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT thing, difficulty, wave, hero, crew, day, ending
      FROM ${context.table(PROOF_TABLE)}
      WHERE thing = ${entry.thing} AND difficulty = ${entry.difficulty}`
    return pipe(
      Array.head(rows),
      Option.flatMap(decodeProofRow),
      Option.map(proofOfRow),
    )
  })

const insertRows = (context: ApplyContext, proof: SavedProof) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* encodedProofRows(proof)
    yield* Array.match(rows, {
      onEmpty: () => Effect.void,
      onNonEmpty: nonEmpty =>
        Effect.asVoid(
          sql`INSERT OR REPLACE INTO ${context.table(PROOF_TABLE)} ${sql.insert(nonEmpty)}`,
        ),
    })
  })

// NOTE: a find put on the shelf (`shelve` in src/shared/proofData.ts): an
// empty slot takes it, and a filled one keeps its stamp unless the find's
// is from an earlier day, so two devices end on the same first stamp.
/** @stability unstable */
export const shelveRow: {
  (
    entry: ProofEntry,
  ): (
    context: ApplyContext,
  ) => Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError,
    SqlClient.SqlClient
  >
  (
    context: ApplyContext,
    entry: ProofEntry,
  ): Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError,
    SqlClient.SqlClient
  >
} = Function.dual(2, (context: ApplyContext, entry: ProofEntry) =>
  Effect.gen(function* () {
    const maybeKept = yield* readSlot(context, entry)
    if (
      Option.isSome(maybeKept) &&
      !isEarlierStamp(entry.stamp, maybeKept.value.stamp)
    ) {
      return
    }
    yield* insertRows(context, [entry])
  }),
)

// NOTE: a whole shelf written into an empty scope (SeededPlayer).
/** @stability unstable */
export const seedProofRows: {
  (
    proof: SavedProof,
  ): (
    context: ApplyContext,
  ) => Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError,
    SqlClient.SqlClient
  >
  (
    context: ApplyContext,
    proof: SavedProof,
  ): Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError,
    SqlClient.SqlClient
  >
} = Function.dual(2, (context: ApplyContext, proof: SavedProof) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM ${context.table(PROOF_TABLE)}`
    yield* insertRows(context, proof)
  }),
)
