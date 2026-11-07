// @vitest-environment happy-dom
import { Effect, Array as EffectArray, Option, Ref, Stream, pipe } from 'effect'

import { afterEach, describe, expect, it } from '@effect/vitest'
import { makeHub } from '@munch/sqlite-wasm-effect/in-process'
import { settle } from '@munch/sync-engine/testing'

import { noSavedRunRecords } from './playerData'
import { PlayerChange, StoreEvent, changesBetween } from './playerSync'
import { grantedVeteran, noRank } from './rank'
import {
  type PlayerSave,
  SAVE_KEY,
  SAVE_VERSION,
  readLegacySave,
  writeLegacySave,
} from './save'
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
} from './store.fixture'
import {
  type LegacySave,
  type PlayerDatabase,
  type SyncSetup,
} from './storeSqlite'
import { jsonOf } from './testing'

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
      const outbox = yield* Effect.orDie(
        sql`SELECT name FROM sync_outbox ORDER BY local_seq`,
      )
      expect(outbox).toEqual([
        { name: 'SeededPlayer' },
        { name: 'ChangedSettings' },
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

  it.effect('a player row from before the home menu gains it, unvisited', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))
      const first = yield* openOn(hub, fake.legacy)
      yield* first.load
      const sql = yield* sqlOn(hub)
      yield* pipe(
        Effect.all([
          sql`ALTER TABLE player DROP COLUMN home`,
          sql`ALTER TABLE sync_confirmed_player DROP COLUMN home`,
          sql`DELETE FROM sync_migrations WHERE id = '0003_add_home'`,
        ]),
        Effect.orDie,
      )
      const second = yield* openOn(hub, fake.legacy)
      const loaded_6 = yield* second.load
      expect(loaded_6).toEqual(
        Option.some({
          ...legacySave,
          home: { seenNewsDay: null, openedEntries: [] },
        }),
      )
    }),
  )

  it.effect(
    'a player row from before the power-ups seen gains them, none seen',
    () =>
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const sql = yield* sqlOn(hub)
        yield* pipe(
          Effect.all([
            sql`ALTER TABLE player DROP COLUMN seen_power_ups`,
            sql`ALTER TABLE sync_confirmed_player DROP COLUMN seen_power_ups`,
            sql`DELETE FROM sync_migrations WHERE id = '0004_add_seen_power_ups'`,
          ]),
          Effect.orDie,
        )
        const second = yield* openOn(hub, fake.legacy)
        const loaded_7 = yield* second.load
        expect(loaded_7).toEqual(
          Option.some({ ...legacySave, seenPowerUps: [] }),
        )
      }),
  )

  it.effect(
    'a player row from before the rotation gains it, locked to landscape',
    () =>
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const sql = yield* sqlOn(hub)
        yield* pipe(
          Effect.all([
            sql`ALTER TABLE player DROP COLUMN rotation`,
            sql`ALTER TABLE sync_confirmed_player DROP COLUMN rotation`,
            sql`DELETE FROM sync_migrations WHERE id = '0006_add_rotation'`,
          ]),
          Effect.orDie,
        )
        const second = yield* openOn(hub, fake.legacy)
        const loaded_8 = yield* second.load
        expect(loaded_8).toEqual(
          Option.some({ ...legacySave, rotation: 'Landscape' }),
        )
      }),
  )

  it.effect('a player row from before the name gains it, empty', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))
      const first = yield* openOn(hub, fake.legacy)
      yield* first.load
      const sql = yield* sqlOn(hub)
      yield* pipe(
        Effect.all([
          sql`ALTER TABLE player DROP COLUMN name`,
          sql`ALTER TABLE sync_confirmed_player DROP COLUMN name`,
          sql`DELETE FROM sync_migrations WHERE id = '0007_add_name'`,
        ]),
        Effect.orDie,
      )
      const second = yield* openOn(hub, fake.legacy)
      const loaded_9 = yield* second.load
      expect(loaded_9).toEqual(Option.some({ ...legacySave, name: '' }))
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
    'a player row from before the cursor setting gets the bold cursor',
    () =>
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const sql = yield* sqlOn(hub)
        yield* pipe(
          Effect.all([
            sql`ALTER TABLE player DROP COLUMN cursor`,
            sql`ALTER TABLE sync_confirmed_player DROP COLUMN cursor`,
            sql`DELETE FROM sync_migrations WHERE id = '0005_add_cursor'`,
          ]),
          Effect.orDie,
        )
        const second = yield* openOn(hub, fake.legacy)
        const loaded_11 = yield* second.load
        expect(loaded_11).toEqual(
          Option.some({
            ...legacySave,
            settings: { ...legacySave.settings, cursor: 'Bold' },
          }),
        )
      }),
  )

  it.effect('a row that no longer decodes reads as no save', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))
      const first = yield* openOn(hub, fake.legacy)
      yield* first.load
      const sql = yield* sqlOn(hub)
      yield* pipe(
        sql`UPDATE player SET appearance = '{"body":"Robot"}'`,
        Effect.orDie,
      )
      const loaded_12 = yield* first.load
      expect(loaded_12).toEqual(Option.none())
    }),
  )

  // NOTE: rows written before 2026-10-30 keep the old look until it next
  // changes, here and in the server's copy of the scope.
  it.effect('rows with an older look read as their closest current look', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))
      const first = yield* openOn(hub, fake.legacy)
      yield* first.load
      const sql = yield* sqlOn(hub)
      const lookAfter = (json: string) =>
        Effect.gen(function* () {
          yield* Effect.orDie(
            sql`UPDATE player SET appearance = ${json} WHERE id = 1`,
          )
          const loaded_13 = yield* first.load
          return Option.map(loaded_13, save => save.appearance)
        })
      const value_1 = yield* lookAfter(
        '{"body":"Female","hairStyle":"Long","hairColor":"Black","skinTone":"Deep","shirtColor":"Pink"}',
      )
      expect(value_1).toEqual(
        Option.some({
          body: 'Broad',
          hairStyle: 'Long',
          hairColor: 'Black',
          skinTone: 'Deep',
          shirtColor: 'Pink',
          outfit: 'Tee',
          print: 'Plain',
          beard: false,
          glasses: false,
          hat: 'None',
          gunSkin: 'Stock',
        }),
      )
      const value_2 = yield* lookAfter(
        '{"body":"Slim","hairStyle":"Bob","hairColor":"Rainbow","skinTone":"Medium","shirtColor":"Sky","outfit":"Hoodie","print":"Ace","facialHair":"Beard","makeup":"Lashes","extra":"Glasses"}',
      )
      expect(value_2).toEqual(
        Option.some({
          body: 'Slim',
          hairStyle: 'Long',
          hairColor: 'Pink',
          skinTone: 'Medium',
          shirtColor: 'Blue',
          outfit: 'Hoodie',
          print: 'Rainbow',
          beard: true,
          glasses: true,
          hat: 'None',
          gunSkin: 'Stock',
        }),
      )
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
        const outboxCount = Effect.map(
          Effect.orDie(sql`SELECT COUNT(*) AS count FROM sync_outbox`),
          rows => rows[0]?.['count'],
        )
        const before = yield* outboxCount
        // NOTE: the outbox insert fails as a full disk would, after the
        // first change of the two has already gone in.
        yield* Effect.orDie(
          sql`CREATE TRIGGER refuse_runs BEFORE INSERT ON sync_outbox
          WHEN NEW.name = 'RecordedRun'
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
        const outboxCount_1 = yield* outboxCount
        expect(outboxCount_1).toBe(before)

        yield* Effect.orDie(sql`DROP TRIGGER refuse_runs`)
        yield* database.write(after, changes)
        const loaded_15 = yield* database.load
        expect(loaded_15).toEqual(Option.some(after))
      }),
  )

  it.effect('a change the scope rejects is dropped, and the rest go in', () =>
    Effect.gen(function* () {
      const hub = yield* makeHub()
      const fake = yield* makeLegacy(Option.some(legacySave))
      const database = yield* openOn(hub, fake.legacy)
      yield* database.load
      const changed = muted(legacySave)
      yield* database.write(changed, [
        PlayerChange.RecordedRun({
          runs: 1_000,
          totalKills: 0,
          kills: {},
          bests: legacySave.bests.byDifficulty,
        }),
        ...changesBetween(legacySave, changed),
      ])
      const loaded_16 = yield* database.load
      expect(loaded_16).toEqual(Option.some(changed))
    }),
  )
})

// SYNC

describe('two devices syncing one player', () => {
  it.effect(
    'a linked device gets the look and kills, and its change comes back',
    () =>
      synced(
        Effect.gen(function* () {
          const server = yield* makeServer
          const network = yield* server.host.network()
          const setup = Option.some<SyncSetup>({
            identityApi: server.api,
            transports: [network.transport],
          })
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
                  ScopeStatus: ({ status }) => `Scope${status._tag}`,
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
          const network = yield* server.host.network()
          const setup = Option.some<SyncSetup>({
            identityApi: server.api,
            transports: [network.transport],
          })
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

  it.effect('power-ups seen on two devices at once are all kept', () =>
    synced(
      Effect.gen(function* () {
        const server = yield* makeServer
        const network = yield* server.host.network()
        const setup = Option.some<SyncSetup>({
          identityApi: server.api,
          transports: [network.transport],
        })
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
        const isEverySeen = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.seenPowerUps.length === 3 &&
              EffectArray.every(['RapidFire', 'Burp', 'Speed'], kind =>
                save.seenPowerUps.includes(kind),
              ),
          )
        const value_7 = yield* until(phone.load, isEverySeen)
        expect(isEverySeen(value_7)).toBe(true)
        const value_8 = yield* until(laptop.load, isEverySeen)
        expect(isEverySeen(value_8)).toBe(true)
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
            Normal: { furthestWave, mostKills },
          },
        })
        // NOTE: the phone sets higher records, the laptop lower ones; the
        // larger stay.
        const isHigh = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.records.Normal.furthestWave === 7 &&
              save.records.Normal.mostKills === 95,
          )
        yield* write(phone, legacySave, withNormal(7, 95))
        yield* until(laptop.load, isHigh)
        // NOTE: the laptop's Easy record marks its write as landed.
        const stale: PlayerSave = {
          ...withNormal(4, 40),
          records: {
            ...withNormal(4, 40).records,
            Easy: { furthestWave: 2, mostKills: 2 },
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
        // NOTE: two runs from the same save are increments: 60 and 100 add.
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

  it.effect('a calling picked on one linked device reaches the other', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(phone, legacySave, { ...legacySave, calling: 'TrackStar' })
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

  it.effect(
    'a finished run settles once the server confirms it, and the scope is fresh',
    () =>
      synced(
        Effect.gen(function* () {
          const server = yield* makeServer
          const network = yield* server.host.network()
          const setup = Option.some<SyncSetup>({
            identityApi: server.api,
            transports: [network.transport],
          })
          const legacy = yield* makeLegacy(Option.some(legacySave))
          const value_15 = yield* makeHub()
          const phone = yield* openSyncingOn(value_15, legacy.legacy, setup)
          const scopeStatuses = yield* Ref.make<ReadonlyArray<string>>([])
          yield* pipe(
            phone.events,
            Stream.runForEach(event =>
              event._tag === 'ScopeStatus'
                ? Ref.update(scopeStatuses, all => [
                    ...all,
                    event.status._tag === 'Ready'
                      ? `Ready ${event.status.fresh ? 'fresh' : 'cached'}`
                      : event.status._tag,
                  ])
                : Effect.void,
            ),
            Effect.forkScoped,
          )
          const played: PlayerSave = {
            ...legacySave,
            bests: {
              ...legacySave.bests,
              runsPlayed: 4,
              totalKills: 70,
              killsByKind: { Shambler: 63, Runner: 7 },
            },
          }
          const maybeRunId = yield* write(phone, legacySave, played)
          expect(Option.isSome(maybeRunId)).toBe(true)
          const settled = yield* settle(
            phone.awaitSettled(Option.getOrElse(maybeRunId, () => '')),
          )
          expect(settled._tag).toBe('Confirmed')
          const seen = yield* until(Ref.get(scopeStatuses), all =>
            all.includes('Ready fresh'),
          )
          expect(seen).toContain('Loading')
          const value_16 = yield* write(phone, played, muted(played))
          expect(value_16).toEqual(Option.none())
        }),
      ),
  )

  it.effect('a build without a sync server returns no run id to wait on', () =>
    synced(
      Effect.gen(function* () {
        const legacy = yield* makeLegacy(Option.some(legacySave))
        const value_17 = yield* makeHub()
        const local = yield* openOn(value_17, legacy.legacy)
        const played: PlayerSave = {
          ...legacySave,
          bests: { ...legacySave.bests, runsPlayed: 4 },
        }
        const value_18 = yield* write(local, legacySave, played)
        expect(value_18).toEqual(Option.none())
      }),
    ),
  )
})

describe('run summaries queued with no network', () => {
  const takeAll = (database: PlayerDatabase) =>
    Effect.gen(function* () {
      const taken: Array<string> = []
      for (;;) {
        const maybeBody = yield* database.takeQueuedSummary
        if (Option.isNone(maybeBody)) {
          return taken
        }
        taken.push(maybeBody.value)
      }
    })

  it.effect('come out oldest first, and each only once', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const value_19 = yield* makeHub()
      const local = yield* openOn(value_19, legacy.legacy)
      yield* local.queueSummary('first')
      yield* local.queueSummary('second')
      const takeQueuedSummary_1 = yield* local.takeQueuedSummary
      expect(takeQueuedSummary_1).toEqual(Option.some('first'))
      const value_20 = yield* takeAll(local)
      expect(value_20).toEqual(['second'])
      const takeQueuedSummary_2 = yield* local.takeQueuedSummary
      expect(takeQueuedSummary_2).toEqual(Option.none())
    }),
  )

  it.effect('wait through a reload, on the same device', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const hub = yield* makeHub()
      const before = yield* openOn(hub, legacy.legacy)
      yield* before.queueSummary('flight home')
      const after = yield* openOn(hub, legacy.legacy)
      const value_21 = yield* takeAll(after)
      expect(value_21).toEqual(['flight home'])
    }),
  )

  it.effect('keep only the newest few when a trip is long', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const value_22 = yield* makeHub()
      const local = yield* openOn(value_22, legacy.legacy)
      yield* Effect.forEach(EffectArray.range(1, 25), run =>
        local.queueSummary(`run ${run}`),
      )
      const taken = yield* takeAll(local)
      expect(taken).toHaveLength(20)
      expect(taken[0]).toBe('run 6')
      expect(taken[19]).toBe('run 25')
    }),
  )

  it.effect('can all be cleared', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const value_23 = yield* makeHub()
      const local = yield* openOn(value_23, legacy.legacy)
      yield* local.queueSummary('one')
      yield* local.queueSummary('two')
      yield* local.clearQueuedSummaries
      const value_24 = yield* takeAll(local)
      expect(value_24).toEqual([])
    }),
  )
})

// THE LIVE SAVE

// NOTE: the save the live game keeps today, exactly as it writes it to
// localStorage: version 4, with the home menu and no shareStats.
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
      shop: 'Learned',
      swap: 'Pending',
      pickup: 'Learned',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
    },
    trapHint: 'Seen',
    ammoTip: 'Unseen',
    introducedKinds: ['Shambler', 'Runner', 'Tank'],
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
  name: '',
  records: noSavedRunRecords,
  rank: noRank,
  calling: 'You',
  boughtCosmetics: [],
  seenUnlocks: [],
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
          const network = yield* server.host.network()
          const setup = Option.some<SyncSetup>({
            identityApi: server.api,
            transports: [network.transport],
          })
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
