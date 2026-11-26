import { Array, Effect, Function, Record, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type ApplyContext, defineMutation } from '@munch/sync-engine'

import { type SavedMastery, masteryRowsOf } from '../shared/masteryData'
import { Count, PLAYER_SCOPE_KIND } from './playerScopeParts'

export const HERO_MASTERY_TABLE = 'hero_mastery'
export const GUN_KILLS_TABLE = 'kills_by_gun'

export const HeroMasteryRow = Schema.Struct({
  hero: Schema.String,
  points: Schema.Finite,
})
export type HeroMasteryRow = typeof HeroMasteryRow.Type

export const GunKillsRow = Schema.Struct({
  gun: Schema.String,
  kills: Schema.Finite,
})
export type GunKillsRow = typeof GunKillsRow.Type

export const heroRowsOf = (
  mastery: SavedMastery,
): ReadonlyArray<HeroMasteryRow> =>
  Array.map(masteryRowsOf(mastery.heroes), ([hero, points]) => ({
    hero,
    points,
  }))

export const gunRowsOf = (mastery: SavedMastery): ReadonlyArray<GunKillsRow> =>
  Array.map(masteryRowsOf(mastery.guns), ([gun, kills]) => ({ gun, kills }))

export const masteryOfRows = ({
  heroes,
  guns,
}: Readonly<{
  heroes: ReadonlyArray<HeroMasteryRow>
  guns: ReadonlyArray<GunKillsRow>
}>): SavedMastery => ({
  heroes: Record.fromEntries(
    Array.map(heroes, (row): readonly [string, number] => [
      row.hero,
      row.points,
    ]),
  ),
  guns: Record.fromEntries(
    Array.map(guns, (row): readonly [string, number] => [row.gun, row.kills]),
  ),
})

type MasteryWrite = Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>

const addRows = (context: ApplyContext, added: SavedMastery): MasteryWrite =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* Array.match(heroRowsOf(added), {
      onEmpty: () => Effect.void,
      onNonEmpty: rows =>
        Effect.asVoid(
          sql`INSERT INTO ${context.table(HERO_MASTERY_TABLE)} ${sql.insert(rows)}
          ON CONFLICT (hero) DO UPDATE SET points = points + excluded.points`,
        ),
    })
    yield* Array.match(gunRowsOf(added), {
      onEmpty: () => Effect.void,
      onNonEmpty: rows =>
        Effect.asVoid(
          sql`INSERT INTO ${context.table(GUN_KILLS_TABLE)} ${sql.insert(rows)}
          ON CONFLICT (gun) DO UPDATE SET kills = kills + excluded.kills`,
        ),
    })
  })

export const seedMasteryRows: {
  (mastery: SavedMastery): (context: ApplyContext) => MasteryWrite
  (context: ApplyContext, mastery: SavedMastery): MasteryWrite
} = Function.dual(2, (context: ApplyContext, mastery: SavedMastery) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM ${context.table(HERO_MASTERY_TABLE)}`
    yield* sql`DELETE FROM ${context.table(GUN_KILLS_TABLE)}`
    yield* addRows(context, mastery)
  }),
)

const MAX_HERO_POINTS_PER_RUN = 5000
const MAX_GUN_KILLS_PER_RUN = 5000

export const GainedMastery = defineMutation({
  name: 'GainedMastery',
  version: 1,
  args: Schema.Struct({
    added: Schema.Struct({
      heroes: Schema.Record(
        Schema.String,
        Count.check(Schema.isLessThanOrEqualTo(MAX_HERO_POINTS_PER_RUN)),
      ),
      guns: Schema.Record(
        Schema.String,
        Count.check(Schema.isLessThanOrEqualTo(MAX_GUN_KILLS_PER_RUN)),
      ),
    }),
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ added }, context) => addRows(context, added),
})
