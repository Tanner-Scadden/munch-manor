import {
  Effect,
  Array as EffectArray,
  Option,
  Record,
  Ref,
  Stream,
  String,
  pipe,
} from 'effect'
import type { SqlClient } from 'effect/sql'

import { afterEach, describe, expect, it } from '@effect/vitest'
import { makeHub } from '@munch/sqlite-wasm-effect/in-process'

import { noDareMarks } from '../../shared/dareMarkData'
import { noJournal } from '../../shared/journalData'
import { noMastery } from '../../shared/masteryData'
import { noMissions } from '../../shared/missionData'
import { noBonuses, noSavedRunRecords } from '../../shared/playerData'
import { noProof } from '../../shared/proofData'
import {
  legacySave,
  linkedPair,
  makeLegacy,
  makeServer,
  muted,
  openOn,
  openSyncingOn,
  sqlOn,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { jsonOf } from '../../test/testing'
import { grantedVeteran, noRank } from '../../world/heroes/rank'
import { PlayerChange, StoreEvent, changesBetween } from '../playerSync'
import {
  type PlayerSave,
  SAVE_KEY,
  SAVE_VERSION,
  readLegacySave,
  writeLegacySave,
} from '../save'
import type { LegacySave } from '../storeSqlite'

const writeOldTables = (sql: SqlClient.SqlClient, save: PlayerSave) =>
  Effect.gen(function* () {
    const row = {
      id: 1,
      sound: save.settings.sound,
      music: save.settings.music,
      shake: save.settings.shake,
      share_stats: save.settings.shareStats,
      appearance: jsonOf(save.appearance),
      difficulty: save.difficulty.chosen,
      difficulty_card: save.difficulty.card,
      nightmare: save.difficulty.nightmare,
      onboarding: jsonOf(save.onboarding),
      home_screen_tip: save.homeScreenTip,
      runs_played: save.bests.runsPlayed,
      total_kills: save.bests.totalKills,
      difficulty_bests: jsonOf(save.bests.byDifficulty),
      home: jsonOf(save.home),
      seen_power_ups: jsonOf(save.seenPowerUps),
      seen_unlocks: jsonOf(save.seenUnlocks),
      cursor: save.settings.cursor,
      rotation: save.rotation,
      rumble: save.rumble,
      record_runs: save.recordRuns,
      record_unlock: save.recordUnlock,
      name: save.name,
      calling: save.calling,
      run_records: jsonOf(save.records),
      rank_points: save.rank.earnedPoints,
      rank_bones: save.rank.earnedBones,
      veteran_points: save.rank.veteranPoints,
      veteran_bones: save.rank.veteranBones,
      veteran_granted: save.rank.isVeteranGranted ? 1 : 0,
      spent_bones: save.rank.spentBones,
      doubled_day: save.bonuses.doubledDay,
      escaped_on: jsonOf(save.bonuses.escapedOn),
      purses: jsonOf(save.bonuses.purses),
      last_run: save.lastRun,
      missions: jsonOf(save.missions),
      journal: jsonOf(save.journal),
      dare_marks: jsonOf(save.dareMarks),
    }
    const columns = EffectArray.join(Record.keys(row), ', ')
    yield* sql.unsafe(`CREATE TABLE player (${columns})`)
    yield* sql`INSERT INTO player ${sql.insert(row)}`
    yield* sql`CREATE TABLE kills_by_kind (kind TEXT PRIMARY KEY, kills INTEGER NOT NULL)`
    yield* Effect.forEach(
      Record.toEntries(save.bests.killsByKind),
      ([kind, kills]) =>
        sql`INSERT INTO kills_by_kind ${sql.insert({ kind, kills })}`,
      { discard: true },
    )
  })

describe('the save in the player scope', () => {
  it.effect('a localStorage save is imported once and seeds the scope', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))

      const first = yield* openOn(hub, fake.legacy)
      const loaded = yield* first.load
      expect(loaded).toEqual(Option.some(legacySave))
      const reads_1 = yield* fake.reads
      expect(reads_1).toBe(1)

      const changed = muted(legacySave)
      yield* write(first, legacySave, changed)

      const second = yield* openOn(hub, fake.legacy)
      const loaded_1 = yield* second.load
      expect(loaded_1).toEqual(Option.some(changed))
      const reads_2 = yield* fake.reads
      expect(reads_2).toBe(1)
      const stored_1 = yield* fake.stored
      expect(stored_1).toEqual(Option.some(legacySave))
      const sql = yield* sqlOn(hub)
      const logged = yield* Effect.orDie(
        sql`SELECT event FROM effect_event_journal ORDER BY event`,
      )
      expect(logged).toEqual([
        { event: 'PlayerRow' },
        { event: 'PlayerRow' },
        { event: 'Seeded' },
      ])
    }),
  )

  it.effect('a device with no save imports nothing and never looks again', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.none())
      const first = yield* openOn(hub, fake.legacy)
      const loaded_2 = yield* first.load
      expect(loaded_2).toEqual(Option.none())
      yield* fake.legacy.write(legacySave)
      const second = yield* openOn(hub, fake.legacy)
      const loaded_3 = yield* second.load
      expect(loaded_3).toEqual(Option.none())
      const reads_3 = yield* fake.reads
      expect(reads_3).toBe(1)
    }),
  )

  it.effect('the first write on a new device seeds the whole save', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.none())
      const first = yield* openOn(hub, fake.legacy)
      yield* first.write(legacySave, [])
      yield* first.write(legacySave, [])
      const loaded_4 = yield* first.load
      expect(loaded_4).toEqual(Option.some(legacySave))
    }),
  )

  it.effect('a finished run adds its kills to each kind', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))
      const first = yield* openOn(hub, fake.legacy)
      yield* first.load
      const after: PlayerSave = {
        ...legacySave,
        bests: {
          ...legacySave.bests,
          runsPlayed: 4,
          totalKills: 70,
          killsByKind: { Shambler: 60, Runner: 7, Tank: 3 },
        },
      }
      expect(changesBetween(legacySave, after)).toEqual([
        PlayerChange.RecordedRun({
          runs: 1,
          totalKills: 13,
          kills: { Shambler: 10, Tank: 3 },
          bests: legacySave.bests.byDifficulty,
        }),
      ])
      yield* write(first, legacySave, after)
      const loaded_5 = yield* first.load
      expect(loaded_5).toEqual(Option.some(after))
    }),
  )

  it.effect(
    'a new name is one ChangedName mutation and lasts across a reload',
    () =>
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const renamed: PlayerSave = { ...legacySave, name: 'Dr. Chomp' }
        expect(changesBetween(legacySave, renamed)).toEqual([
          PlayerChange.ChangedName({ name: 'Dr. Chomp' }),
        ])
        yield* write(first, legacySave, renamed)
        const second = yield* openOn(hub, fake.legacy)
        const loaded_10 = yield* second.load
        expect(loaded_10).toEqual(Option.some(renamed))
      }),
  )

  it.effect(
    'a save in the old player tables moves into the log once, and the tables go',
    () =>
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.none())
        const fresh = yield* openOn(hub, fake.legacy)
        const nothing = yield* fresh.load
        expect(nothing).toEqual(Option.none())
        const sql = yield* sqlOn(hub)
        yield* Effect.orDie(writeOldTables(sql, legacySave))
        yield* Effect.orDie(
          sql`DELETE FROM store_meta WHERE key = 'player-scope-dropped'`,
        )

        const moved = yield* openOn(hub, fake.legacy)
        const loaded = yield* moved.load
        expect(loaded).toEqual(Option.some(legacySave))
        const left = yield* Effect.orDie(
          sql`SELECT name FROM sqlite_master WHERE name IN ('player', 'kills_by_kind')`,
        )
        expect(left).toEqual([])

        const reopened = yield* openOn(hub, fake.legacy)
        const again = yield* reopened.load
        expect(again).toEqual(Option.some(legacySave))
      }),
  )
})

describe('a write the database refuses', () => {
  const afterRun = (save: PlayerSave): PlayerSave => ({
    ...muted(save),
    bests: {
      ...save.bests,
      runsPlayed: save.bests.runsPlayed + 1,
      totalKills: save.bests.totalKills + 4,
      killsByKind: {
        ...save.bests.killsByKind,
        Shambler: (save.bests.killsByKind['Shambler'] ?? 0) + 4,
      },
    },
  })

  it.effect(
    'fails, leaves nothing behind, and goes in whole on the retry',
    () =>
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const database = yield* openOn(hub, fake.legacy)
        yield* database.load
        const sql = yield* sqlOn(hub)
        const journalCount = Effect.map(
          Effect.orDie(sql`SELECT COUNT(*) AS count FROM effect_event_journal`),
          rows => rows[0]?.['count'],
        )
        const before = yield* journalCount
        yield* Effect.orDie(
          sql`CREATE TRIGGER refuse_runs BEFORE INSERT ON effect_event_journal
          WHEN NEW.event = 'RecordedRun'
          BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
        )
        const after = afterRun(legacySave)
        const changes = changesBetween(legacySave, after)
        expect(Array.from(changes, change => change._tag)).toEqual([
          'ChangedSettings',
          'RecordedRun',
        ])

        const failed = yield* Effect.flip(database.write(after, changes))
        expect(failed._tag).toBe('PlayerDatabaseError')
        const loaded_14 = yield* database.load
        expect(loaded_14).toEqual(Option.some(legacySave))
        const after_1 = yield* journalCount
        expect(after_1).toBe(before)

        yield* Effect.orDie(sql`DROP TRIGGER refuse_runs`)
        yield* database.write(after, changes)
        const loaded_15 = yield* database.load
        expect(loaded_15).toEqual(Option.some(after))
      }),
  )
})

describe('two devices syncing one player', () => {
  it.effect(
    'a linked device gets the look and kills, and its change comes back',
    () =>
      synced(
        Effect.gen(function* () {
          const server = yield* makeServer
          const setup = Option.some(server.setup)
          const phoneHub = yield* makeHub()
          const laptopHub = yield* makeHub()
          const phoneLegacy = yield* makeLegacy(Option.some(legacySave))
          const laptopLegacy = yield* makeLegacy(Option.none())
          const phone = yield* openSyncingOn(
            phoneHub,
            phoneLegacy.legacy,
            setup,
          )
          const laptop = yield* openSyncingOn(
            laptopHub,
            laptopLegacy.legacy,
            setup,
          )

          const phoneEvents = yield* Ref.make<ReadonlyArray<string>>([])
          yield* pipe(
            phone.events,
            Stream.runForEach(event =>
              Ref.update(phoneEvents, all => [
                ...all,
                StoreEvent.match(event, {
                  SyncStatus: ({ state }) => state._tag,
                  SyncedSave: ({ save }) => save.settings.music,
                }),
              ]),
            ),
            Effect.forkScoped,
          )

          const restyled: PlayerSave = {
            ...legacySave,
            appearance: { ...legacySave.appearance, shirtColor: 'Purple' },
            bests: {
              ...legacySave.bests,
              runsPlayed: 4,
              totalKills: 60,
              killsByKind: { Shambler: 53, Runner: 7 },
            },
          }
          yield* write(phone, legacySave, restyled)

          const code = yield* phone.requestLinkCode
          yield* laptop.redeemLinkCode(code)
          const onLaptop = yield* until(laptop.load, maybeSave =>
            Option.exists(
              maybeSave,
              save => save.appearance.shirtColor === 'Purple',
            ),
          )
          expect(onLaptop).toEqual(Option.some(restyled))

          const quiet: PlayerSave = {
            ...restyled,
            settings: { ...restyled.settings, music: 'Off' },
            home: { ...restyled.home, openedEntries: ['Shambler', 'Runner'] },
            rotation: 'Auto',
            rumble: 'On',
          }
          yield* write(laptop, restyled, quiet)
          const onPhone = yield* until(phone.load, maybeSave =>
            Option.exists(maybeSave, save => save.settings.music === 'Off'),
          )
          expect(onPhone).toEqual(Option.some(quiet))
          const heard = yield* until(Ref.get(phoneEvents), events =>
            events.includes('Off'),
          )
          expect(heard).toContain('Synced')
        }),
      ),
  )

  it.effect(
    'a name set on one linked device shows on the other, and the last one set wins',
    () =>
      synced(
        Effect.gen(function* () {
          const server = yield* makeServer
          const setup = Option.some(server.setup)
          const value_3 = yield* makeHub()
          const phone = yield* openSyncingOn(
            value_3,
            (yield* makeLegacy(Option.some(legacySave))).legacy,
            setup,
          )
          const value_4 = yield* makeHub()
          const laptop = yield* openSyncingOn(
            value_4,
            (yield* makeLegacy(Option.none())).legacy,
            setup,
          )
          yield* phone.load
          const code = yield* phone.requestLinkCode
          yield* laptop.redeemLinkCode(code)
          yield* until(laptop.load, maybeSave =>
            Option.exists(maybeSave, save => save.name === 'Lil Gnaw'),
          )

          const onPhone: PlayerSave = { ...legacySave, name: 'Snackula' }
          yield* write(phone, legacySave, onPhone)
          const reached = yield* until(laptop.load, maybeSave =>
            Option.exists(maybeSave, save => save.name === 'Snackula'),
          )
          expect(Option.map(reached, save => save.name)).toEqual(
            Option.some('Snackula'),
          )

          const onLaptop: PlayerSave = { ...onPhone, name: 'Baron Burp' }
          yield* write(laptop, onPhone, onLaptop)
          const back = yield* until(phone.load, maybeSave =>
            Option.exists(maybeSave, save => save.name === 'Baron Burp'),
          )
          expect(back).toEqual(Option.some(onLaptop))
        }),
      ),
  )

  it.effect('power-ups seen on two devices at once end the same on both', () =>
    synced(
      Effect.gen(function* () {
        const server = yield* makeServer
        const setup = Option.some(server.setup)
        const value_5 = yield* makeHub()
        const phone = yield* openSyncingOn(
          value_5,
          (yield* makeLegacy(Option.some(legacySave))).legacy,
          setup,
        )
        const value_6 = yield* makeHub()
        const laptop = yield* openSyncingOn(
          value_6,
          (yield* makeLegacy(Option.none())).legacy,
          setup,
        )
        yield* phone.load
        const code = yield* phone.requestLinkCode
        yield* laptop.redeemLinkCode(code)
        yield* until(laptop.load, maybeSave =>
          Option.exists(maybeSave, save => save.appearance.hairColor === 'Red'),
        )

        const onPhone: PlayerSave = {
          ...legacySave,
          seenPowerUps: ['RapidFire', 'Burp'],
        }
        const onLaptop: PlayerSave = {
          ...legacySave,
          seenPowerUps: ['RapidFire', 'Speed'],
        }
        yield* Effect.all(
          [
            write(phone, legacySave, onPhone),
            write(laptop, legacySave, onLaptop),
          ],
          { concurrency: 'unbounded' },
        )
        const isSameSeen = Option.makeEquivalence(
          EffectArray.makeEquivalence(String.Equivalence),
        )
        const seenOf = (maybeSave: Option.Option<PlayerSave>) =>
          Option.map(maybeSave, save => save.seenPowerUps)
        const bothAgree = Effect.gen(function* () {
          const phoneSave = yield* phone.load
          const laptopSave = yield* laptop.load
          return {
            phoneSeen: seenOf(phoneSave),
            laptopSeen: seenOf(laptopSave),
          }
        })
        const agreed = yield* until(
          bothAgree,
          ({ phoneSeen, laptopSeen }) =>
            Option.exists(phoneSeen, seen => seen.length === 2) &&
            isSameSeen(phoneSeen, laptopSeen),
        )
        expect(agreed.phoneSeen).toEqual(agreed.laptopSeen)
      }),
    ),
  )

  it.effect('run records from two devices merge to the larger of each', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        const withNormal = (
          furthestWave: number,
          mostKills: number,
        ): PlayerSave => ({
          ...legacySave,
          records: {
            ...noSavedRunRecords,
            Normal: { furthestWave, mostKills, bestRun: null },
          },
        })
        const isHigh = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.records.Normal.furthestWave === 7 &&
              save.records.Normal.mostKills === 95,
          )
        yield* write(phone, legacySave, withNormal(7, 95))
        yield* until(laptop.load, isHigh)
        const stale: PlayerSave = {
          ...withNormal(4, 40),
          records: {
            ...withNormal(4, 40).records,
            Easy: { furthestWave: 2, mostKills: 2, bestRun: null },
          },
        }
        yield* write(laptop, legacySave, stale)
        const hasLanded = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(maybeSave, save => save.records.Easy.furthestWave === 2)
        const onPhone = yield* until(phone.load, hasLanded)
        const onLaptop = yield* until(laptop.load, hasLanded)
        expect(isHigh(onPhone)).toBe(true)
        expect(isHigh(onLaptop)).toBe(true)
      }),
    ),
  )

  it.effect('rank earned on two linked devices both count', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        const earned = (points: number, bones: number): PlayerSave => ({
          ...legacySave,
          rank: { ...noRank, earnedPoints: points, earnedBones: bones },
        })
        yield* write(phone, legacySave, earned(60, 6))
        yield* write(laptop, legacySave, earned(100, 10))
        const isBoth = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.rank.earnedPoints === 160 && save.rank.earnedBones === 16,
          )
        const value_9 = yield* until(phone.load, isBoth)
        expect(isBoth(value_9)).toBe(true)
        const value_10 = yield* until(laptop.load, isBoth)
        expect(isBoth(value_10)).toBe(true)
      }),
    ),
  )

  it.effect('recording turned on on one linked device reaches the other', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(phone, legacySave, { ...legacySave, recordRuns: 'On' })
        const isOn = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(maybeSave, save => save.recordRuns === 'On')
        const onLaptop = yield* until(laptop.load, isOn)
        expect(isOn(onLaptop)).toBe(true)
      }),
    ),
  )

  it.effect(
    'RECORD MY RUNS unlocked on one linked device unlocks the other',
    () =>
      synced(
        Effect.gen(function* () {
          const { phone, laptop } = yield* linkedPair
          yield* write(phone, legacySave, {
            ...legacySave,
            recordUnlock: 'Unlocked',
          })
          const isUnlocked = (maybeSave: Option.Option<PlayerSave>) =>
            Option.exists(maybeSave, save => save.recordUnlock === 'Unlocked')
          const onLaptop = yield* until(laptop.load, isUnlocked)
          expect(isUnlocked(onLaptop)).toBe(true)
        }),
      ),
  )

  it.effect('a calling picked on one linked device reaches the other', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(phone, legacySave, {
          ...legacySave,
          calling: 'TrackStar',
        })
        const isPicked = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(maybeSave, save => save.calling === 'TrackStar')
        const value_11 = yield* until(laptop.load, isPicked)
        expect(isPicked(value_11)).toBe(true)
        const value_12 = yield* until(phone.load, isPicked)
        expect(isPicked(value_12)).toBe(true)
      }),
    ),
  )

  it.effect(
    'the veteran grant from two linked devices keeps the larger, not the sum',
    () =>
      synced(
        Effect.gen(function* () {
          const { phone, laptop } = yield* linkedPair
          const granted = (points: number): PlayerSave => ({
            ...legacySave,
            rank: grantedVeteran(noRank, points),
          })
          yield* write(phone, legacySave, granted(300))
          yield* write(laptop, legacySave, granted(250))
          const isLarger = (maybeSave: Option.Option<PlayerSave>) =>
            Option.exists(
              maybeSave,
              save =>
                save.rank.isVeteranGranted &&
                save.rank.veteranPoints === 300 &&
                save.rank.veteranBones === 30,
            )
          const value_13 = yield* until(phone.load, isLarger)
          expect(isLarger(value_13)).toBe(true)
          const value_14 = yield* until(laptop.load, isLarger)
          expect(isLarger(value_14)).toBe(true)
        }),
      ),
  )

  it.effect('a device with a sync server says Synced once it connects', () =>
    synced(
      Effect.gen(function* () {
        const server = yield* makeServer
        const setup = Option.some(server.setup)
        const legacy = yield* makeLegacy(Option.some(legacySave))
        const hub = yield* makeHub()
        const phone = yield* openSyncingOn(hub, legacy.legacy, setup)
        const states = yield* Ref.make<ReadonlyArray<string>>([])
        yield* pipe(
          phone.events,
          Stream.runForEach(event =>
            StoreEvent.match(event, {
              SyncStatus: ({ state }) =>
                Ref.update(states, all => [...all, state._tag]),
              SyncedSave: () => Effect.void,
            }),
          ),
          Effect.forkScoped,
        )
        const heard = yield* until(Ref.get(states), all =>
          all.includes('Synced'),
        )
        expect(heard).toContain('Synced')
      }),
    ),
  )
})

const LIVE_VERSION_4_SAVE = jsonOf({
  version: 4,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Learned',
      swap: 'Pending',
      pickup: 'Learned',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
    },
    trapHint: 'Seen',
    introducedKinds: ['Shambler', 'Runner', 'Tank'],
    intro: 'Unseen',
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'On', music: 'Off', shake: 'Off' },
  appearance: {
    body: 'Male',
    hairStyle: 'Curls',
    hairColor: 'Blonde',
    skinTone: 'Tan',
    shirtColor: 'Red',
  },
  difficulty: { chosen: 'Hard', card: 'Seen', nightmare: 'Unlocked' },
  bests: {
    runsPlayed: 9,
    totalKills: 412,
    killsByKind: { Shambler: 300, Runner: 100, Tank: 12 },
    byDifficulty: {
      Easy: { fastestWinMs: null, bestEndlessWave: null },
      Normal: { fastestWinMs: 398_000, bestEndlessWave: 14 },
      Hard: { fastestWinMs: 455_000, bestEndlessWave: 8 },
      Nightmare: { fastestWinMs: null, bestEndlessWave: null },
    },
  },
  home: {
    seenNewsDay: 'October 28, 2026',
    openedEntries: ['Shambler', 'Runner'],
  },
})

const migratedLiveSave: PlayerSave = {
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      swap: 'Pending',
      pickup: 'Learned',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
      dareTour: 'Pending',
      dareKey: 'Pending',
      rattles: 'Pending',
      displayCase: 'Pending',
      dareCard: 'Pending',
      gunLevel: 'Pending',
    },
    trapHint: 'Seen',
    introducedKinds: ['Shambler', 'Runner', 'Tank'],
    intro: 'Unseen',
  },
  homeScreenTip: 'Dismissed',
  settings: {
    sound: 'On',
    music: 'Off',
    shake: 'Off',
    shareStats: 'On',
    cursor: 'Bold',
  },
  appearance: {
    body: 'Broad',
    hairStyle: 'Curly',
    hairColor: 'Blonde',
    skinTone: 'Tan',
    shirtColor: 'Red',
    outfit: 'Tee',
    print: 'Plain',
    beard: false,
    glasses: false,
    hat: 'None',
    gunSkin: 'Stock',
    propStyle: 'Stock',
  },
  difficulty: { chosen: 'Hard', card: 'Seen', nightmare: 'Unlocked' },
  bests: {
    runsPlayed: 9,
    totalKills: 412,
    killsByKind: { Shambler: 300, Runner: 100, Tank: 12 },
    byDifficulty: {
      Easy: { fastestWinMs: null, bestEndlessWave: null },
      Normal: { fastestWinMs: 398_000, bestEndlessWave: 14 },
      Hard: { fastestWinMs: 455_000, bestEndlessWave: 8 },
      Nightmare: { fastestWinMs: null, bestEndlessWave: null },
    },
  },
  home: {
    seenNewsDay: 'October 28, 2026',
    openedEntries: ['Shambler', 'Runner'],
  },
  seenPowerUps: [],
  rotation: 'Landscape',
  rumble: 'On',
  name: '',
  records: noSavedRunRecords,
  rank: noRank,
  bonuses: noBonuses,
  lastRun: 'NoRunYet',
  missions: noMissions,
  proof: noProof,
  journal: noJournal,
  mastery: noMastery,
  dareMarks: noDareMarks,
  calling: 'You',
  boughtCosmetics: [],
  seenUnlocks: [],
  recordRuns: 'Off',
  recordUnlock: 'Locked',
}

const realLegacy: LegacySave = {
  read: readLegacySave,
  write: writeLegacySave,
}

describe("the live game's version 4 save", () => {
  afterEach(() => localStorage.clear())

  it.effect(
    'moves from localStorage into SQLite and the server with nothing lost',
    () =>
      synced(
        Effect.gen(function* () {
          localStorage.setItem(SAVE_KEY, LIVE_VERSION_4_SAVE)
          const server = yield* makeServer
          const setup = Option.some(server.setup)
          const phoneHub = yield* makeHub()

          const phone = yield* openSyncingOn(phoneHub, realLegacy, setup)
          const loaded_17 = yield* phone.load
          expect(loaded_17).toEqual(Option.some(migratedLiveSave))

          localStorage.removeItem(SAVE_KEY)
          const reloaded = yield* openSyncingOn(phoneHub, realLegacy, setup)
          const loaded_18 = yield* reloaded.load
          expect(loaded_18).toEqual(Option.some(migratedLiveSave))

          const laptopLegacy = yield* makeLegacy(Option.none())
          const value_25 = yield* makeHub()
          const laptop = yield* openSyncingOn(
            value_25,
            laptopLegacy.legacy,
            setup,
          )
          const code = yield* reloaded.requestLinkCode
          yield* laptop.redeemLinkCode(code)
          const onLaptop = yield* until(laptop.load, Option.isSome)
          expect(onLaptop).toEqual(Option.some(migratedLiveSave))
        }),
      ),
  )
})
