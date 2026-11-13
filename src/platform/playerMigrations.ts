import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { ScopeMigration } from '@munch/sync-engine'

// The player scope's migrations (src/platform/playerScope.ts), numbered and
// run in order, apart from its rows and mutations. A new column or table is
// a new numbered migration here; never edit one that has shipped. Shared
// with the sync Worker in infra/worker, like the scope.

/** @stability unstable */
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
  // NOTE: the home menu came from main after the player table shipped to
  // the preview, so it is added here with an unvisited default.
  '0003_add_home': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN home TEXT NOT NULL
        DEFAULT '{"seenNewsDay":null,"openedEntries":[]}'`
    }),
  // NOTE: the power-ups seen came after the home menu, so they are added
  // the same way, with none seen.
  '0004_add_seen_power_ups': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN seen_power_ups TEXT NOT NULL DEFAULT '[]'`
    }),
  // NOTE: the cursor setting came after the power-ups seen. A player from
  // before it gets the bold cursor, as a new player does.
  '0005_add_cursor': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN cursor TEXT NOT NULL DEFAULT 'Bold'`
    }),
  // NOTE: the rotation came after the cursor, added the same way. Every
  // player starts locked to landscape.
  '0006_add_rotation': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN rotation TEXT NOT NULL DEFAULT 'Landscape'`
    }),
  // NOTE: the display name came after the rotation. A player from before
  // it has none, and the game shows the placeholder.
  '0007_add_name': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN name TEXT NOT NULL DEFAULT ''`
    }),
  // NOTE: the run records came after the name. A player from before them
  // has none, so their first records set without a NEW BEST.
  '0008_add_run_records': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN run_records TEXT NOT NULL
        DEFAULT '{"Easy":{"furthestWave":null,"mostKills":null},"Normal":{"furthestWave":null,"mostKills":null},"Hard":{"furthestWave":null,"mostKills":null},"Nightmare":{"furthestWave":null,"mostKills":null}}'`
    }),
  // NOTE: rank came after the run records. A player from before it has
  // earned nothing and has not been granted the veteran start, so the
  // first device to load grants it. Spent Bones are for the closet.
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
  // NOTE: callings came after rank. A player from before them picks YOU.
  '0010_add_calling': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN calling TEXT NOT NULL DEFAULT 'You'`
    }),
  // NOTE: the closet came after callings. The hat is part of the look's
  // JSON (a look from before reads bare headed), so the only new thing is
  // the table of hats bought with Bones.
  '0011_closet': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('bought_cosmetics'))} (
        id TEXT PRIMARY KEY
      )`
    }),
  // NOTE: NEW badges came after the closet. A player from before them has
  // seen the baseline mark: every unlock reached by the first load.
  '0012_add_seen_unlocks': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN seen_unlocks TEXT NOT NULL DEFAULT '["*"]'`
    }),
  // NOTE: the rumble came after NEW badges, added as the rotation was.
  // Every player's controller rumbles until they turn it off.
  '0013_add_rumble': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN rumble TEXT NOT NULL DEFAULT 'On'`
    }),
  // NOTE: RECORD MY RUNS came after the rumble. A player from before it
  // records nothing.
  '0014_add_record_runs': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN record_runs TEXT NOT NULL DEFAULT 'Off'`
    }),
  // NOTE: the RECORD MY RUNS unlock came after the setting, kept on each
  // device until then. A player from before it reads as locked until a
  // device that holds its own mark writes the unlock.
  '0015_add_record_unlock': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN record_unlock TEXT NOT NULL DEFAULT 'Locked'`
    }),
  // NOTE: the Bones bonuses came after the unlock. A player from before
  // them has doubled no day and escaped on nothing since. The best runs
  // ride in run_records' JSON, read as none where missing.
  '0016_add_bonuses': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN doubled_day TEXT`
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN escaped_on TEXT NOT NULL DEFAULT '[]'`
    }),
  // NOTE: a player from before reads as no run yet, as an old save does.
  '0017_add_last_run': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN last_run TEXT NOT NULL DEFAULT 'NoRunYet'`
    }),
  // NOTE: the daily missions came after the last run's ending. A player
  // from before them has none (noMissions in src/shared/missionData.ts).
  '0018_add_missions': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN missions TEXT NOT NULL
        DEFAULT '{"day":null,"rolled":[],"progress":{},"claimed":[],"reroll":null,"stampedDays":[],"hasPlayedCoop":false}'`
    }),
  // NOTE: the Proof Shelf came after the daily missions: one row per
  // thing per difficulty, its first stamp. A player from before has an
  // empty shelf.
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
  // NOTE: the Dare Journal came after the Proof Shelf: the milestones
  // reached, the rooms opened and found in, the heroes played, and the
  // things found. A player from before starts it empty; the milestones
  // their save already meets are reached at their next run's end.
  '0020_add_journal': table =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE ${sql(table('player'))}
        ADD COLUMN journal TEXT NOT NULL
        DEFAULT '{"milestones":[],"roomsOpened":[],"roomsFoundIn":[],"heroesPlayed":[],"thingsFound":0}'`
    }),
}
