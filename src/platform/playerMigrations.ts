import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { ScopeMigration } from '@munch/sync-engine'

export const PLAYER_MIGRATIONS: Readonly<Record<string, ScopeMigration>> = {
  '0001_create_player': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('player'))} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sound TEXT NOT NULL,
        music TEXT NOT NULL,
        shake TEXT NOT NULL,
        share_stats TEXT NOT NULL,
        appearance TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        difficulty_card TEXT NOT NULL,
        nightmare TEXT NOT NULL,
        onboarding TEXT NOT NULL,
        home_screen_tip TEXT NOT NULL,
        runs_played INTEGER NOT NULL,
        total_kills INTEGER NOT NULL,
        difficulty_bests TEXT NOT NULL
      )`
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('kills_by_kind'))} (
        kind TEXT PRIMARY KEY,
        kills INTEGER NOT NULL
      )`
    }),
  '0002_create_linked_devices': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('linked_devices'))} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        count INTEGER NOT NULL
      )`
    }),
  '0003_add_home': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN home TEXT NOT NULL
        DEFAULT '{"seenNewsDay":null,"openedEntries":[]}'`
    }),
  '0004_add_seen_power_ups': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN seen_power_ups TEXT NOT NULL DEFAULT '[]'`
    }),
  '0005_add_cursor': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN cursor TEXT NOT NULL DEFAULT 'Bold'`
    }),
  '0006_add_rotation': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN rotation TEXT NOT NULL DEFAULT 'Landscape'`
    }),
  '0007_add_name': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN name TEXT NOT NULL DEFAULT ''`
    }),
  '0008_add_run_records': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN run_records TEXT NOT NULL
        DEFAULT '{"Easy":{"furthestWave":null,"mostKills":null},"Normal":{"furthestWave":null,"mostKills":null},"Hard":{"furthestWave":null,"mostKills":null},"Nightmare":{"furthestWave":null,"mostKills":null}}'`
    }),
  '0009_add_rank': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN rank_points INTEGER NOT NULL DEFAULT 0`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN rank_bones INTEGER NOT NULL DEFAULT 0`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN veteran_points INTEGER NOT NULL DEFAULT 0`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN veteran_bones INTEGER NOT NULL DEFAULT 0`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN veteran_granted INTEGER NOT NULL DEFAULT 0`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN spent_bones INTEGER NOT NULL DEFAULT 0`
    }),
  '0010_add_calling': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN calling TEXT NOT NULL DEFAULT 'You'`
    }),
  '0011_closet': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('bought_cosmetics'))} (
        id TEXT PRIMARY KEY
      )`
    }),
  '0012_add_seen_unlocks': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN seen_unlocks TEXT NOT NULL DEFAULT '["*"]'`
    }),
  '0013_add_rumble': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN rumble TEXT NOT NULL DEFAULT 'On'`
    }),
  '0014_add_record_runs': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN record_runs TEXT NOT NULL DEFAULT 'Off'`
    }),
  '0015_add_record_unlock': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN record_unlock TEXT NOT NULL DEFAULT 'Locked'`
    }),
  '0016_add_bonuses': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN doubled_day TEXT`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN escaped_on TEXT NOT NULL DEFAULT '[]'`
    }),
  '0017_add_last_run': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN last_run TEXT NOT NULL DEFAULT 'NoRunYet'`
    }),
  '0018_add_missions': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN missions TEXT NOT NULL
        DEFAULT '{"day":null,"rolled":[],"progress":{},"claimed":[],"reroll":null,"stampedDays":[],"hasPlayedCoop":false}'`
    }),
  '0019_add_proof': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('proof'))} (
        thing TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        wave INTEGER NOT NULL,
        hero TEXT NOT NULL,
        crew TEXT NOT NULL,
        day TEXT,
        ending TEXT NOT NULL,
        PRIMARY KEY (thing, difficulty)
      )`
    }),
  '0020_add_journal': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN journal TEXT NOT NULL
        DEFAULT '{"milestones":[],"roomsOpened":[],"roomsFoundIn":[],"heroesPlayed":[],"thingsFound":0}'`
    }),
  '0021_add_purses': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN purses TEXT NOT NULL DEFAULT '[]'`
    }),
  '0022_add_mastery': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('hero_mastery'))} (
        hero TEXT PRIMARY KEY,
        points INTEGER NOT NULL
      )`
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('kills_by_gun'))} (
        gun TEXT PRIMARY KEY,
        kills INTEGER NOT NULL
      )`
    }),
  '0023_add_dare_marks': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN dare_marks TEXT NOT NULL
        DEFAULT '{"Easy":0,"Normal":0,"Hard":0,"Nightmare":0}'`
    }),
}
