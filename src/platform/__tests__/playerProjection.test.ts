import { Array, Effect, Layer, Option, Queue, Redacted, Struct } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogRemote,
  SqlEventJournal,
} from 'effect/eventlog'
import { TestClock } from 'effect/testing'

import { describe, expect, it } from '@effect/vitest'
import { type Hub, makeHub } from '@munch/sqlite-wasm-effect/in-process'

import { legacySave } from '../../test/store.fixture'
import { PLAYER_ROW_KEY, PlayerLogSchema, PlayerRow } from '../playerEvents'
import {
  PlayerHandlers,
  createPlayerTables,
  readPlayerFacts,
  readPlayerSave,
  rowOfSave,
} from '../playerProjection'

const identity: EventLog.Identity['Service'] = {
  publicKey: 'projection-test',
  privateKey: Redacted.make(new Uint8Array(32)),
}

type JournalTables = Readonly<{
  entryTable: string
  remotesTable: string
}>

const deviceOn = (hub: Hub, tables: Option.Option<JournalTables>) =>
  EventLog.layer(PlayerLogSchema, PlayerHandlers).pipe(
    Layer.provideMerge(SqlEventJournal.layer(Option.getOrUndefined(tables))),
    Layer.provide(Layer.effectDiscard(createPlayerTables)),
    Layer.provide(Layer.succeed(EventLog.Identity, identity)),
    Layer.provideMerge(hub.layer()),
  )

const openDevice = (tables: Option.Option<JournalTables>) =>
  Effect.flatMap(makeHub(), hub => Layer.build(deviceOn(hub, tables)))

type Device = Effect.Success<ReturnType<typeof openDevice>>

const on =
  (device: Device) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideContext(effect, device)

const settledOn = <A, E>(
  probe: Effect.Effect<A, E>,
  isDone: (value: A) => boolean,
): Effect.Effect<A, E> =>
  Effect.repeat(Effect.andThen(Effect.yieldNow, probe), {
    until: isDone,
  })

const feed = (device: Device, entries: ReadonlyArray<EventJournal.Entry>) =>
  on(device)(
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* EventLog.Registry
        const journal = yield* EventJournal.EventJournal
        const id = EventJournal.makeRemoteIdUnsafe()
        yield* registry.registerRemote(
          EventLogRemote.EventLogRemote.of({
            id,
            changes: () =>
              Effect.gen(function* () {
                const queue = yield* Queue.unbounded<
                  EventJournal.RemoteEntry,
                  EventLogRemote.EventLogRemoteError
                >()
                yield* Queue.offerAll(
                  queue,
                  Array.map(entries, (entry, remoteSequence) =>
                    EventJournal.RemoteEntry.make({ remoteSequence, entry }),
                  ),
                )
                return queue
              }),
            write: () => Effect.void,
            whenAuthenticated: effect => effect,
          }),
        )
        yield* settledOn(
          Effect.orDie(journal.nextRemoteSequence(id)),
          next => next >= entries.length,
        )
      }),
    ),
  )

const entriesOf = (device: Device) =>
  on(device)(Effect.orDie(EventLog.EventLog.use(log => log.entries)))

const saveOf = (device: Device) => on(device)(readPlayerSave)

const DAY = '2026-11-20'

const firstStamp = {
  wave: 7,
  hero: 'You',
  crew: [],
  day: DAY,
  ending: 'Escaped' as const,
}

const writeOnPhone = Effect.gen(function* () {
  const client = yield* EventLog.makeClient(PlayerLogSchema)
  yield* client({
    event: 'Seeded',
    payload: { save: Struct.omit(legacySave, ['version']) },
  })
  yield* client(PlayerRow.set(rowOfSave(legacySave, PLAYER_ROW_KEY)))
  yield* client({
    event: 'RecordedRun',
    payload: {
      runs: 1,
      totalKills: 20,
      kills: { Shambler: 20 },
      bests: {
        ...legacySave.bests.byDifficulty,
        Hard: { fastestWinMs: 500_000, bestEndlessWave: null },
      },
    },
  })
  yield* client({ event: 'EarnedRank', payload: { points: 120, bones: 30 } })
  yield* client({ event: 'BoughtCosmetic', payload: { id: 'Fez' } })
  yield* client({
    event: 'ShelvedProof',
    payload: {
      entry: { thing: 'Teapot', difficulty: 'Hard', stamp: firstStamp },
    },
  })
  yield* client({
    event: 'GainedMastery',
    payload: { added: { heroes: { You: 30 }, guns: { Pistol: 20 } } },
  })
  yield* client({
    event: 'ClimbedDareLadder',
    payload: { difficulty: 'Hard', mark: 3 },
  })
  yield* client({
    event: 'ProgressedMissions',
    payload: { day: DAY, progress: { SplatZombies: 20 }, coop: false },
  })
  yield* client({
    event: 'ClaimedMission',
    payload: { day: DAY, mission: 'SplatZombies' },
  })
  yield* client(PlayerRow.patch(PLAYER_ROW_KEY, { name: 'Phone Gnaw' }))
})

const writeOnLaptop = Effect.gen(function* () {
  const client = yield* EventLog.makeClient(PlayerLogSchema)
  yield* client({
    event: 'RecordedRun',
    payload: {
      runs: 1,
      totalKills: 9,
      kills: { Runner: 9 },
      bests: {
        ...legacySave.bests.byDifficulty,
        Hard: { fastestWinMs: 450_000, bestEndlessWave: 4 },
      },
    },
  })
  yield* client({ event: 'EarnedRank', payload: { points: 80, bones: 10 } })
  yield* client({ event: 'BoughtCosmetic', payload: { id: 'Fez' } })
  yield* client({
    event: 'ShelvedProof',
    payload: {
      entry: {
        thing: 'Teapot',
        difficulty: 'Hard',
        stamp: { ...firstStamp, day: '2026-11-21', wave: 9 },
      },
    },
  })
  yield* client({
    event: 'GainedMastery',
    payload: { added: { heroes: { You: 15 }, guns: { Smg: 4 } } },
  })
  yield* client({
    event: 'ClimbedDareLadder',
    payload: { difficulty: 'Hard', mark: 5 },
  })
  yield* client({ event: 'SawUnlocks', payload: { ids: ['hat:Fez'] } })
  yield* client({ event: 'UnlockedNightmare', payload: {} })
  yield* client(PlayerRow.patch(PLAYER_ROW_KEY, { music: 'Off' }))
})

const twoDevicesWrote = Effect.gen(function* () {
  const phone = yield* openDevice(Option.none())
  const laptop = yield* openDevice(Option.none())
  yield* on(phone)(writeOnPhone)
  yield* TestClock.adjust('1 second')
  yield* on(laptop)(writeOnLaptop)
  return {
    fromPhone: yield* entriesOf(phone),
    fromLaptop: yield* entriesOf(laptop),
  }
})

describe('the player projection', () => {
  it.effect(
    'two devices applied in either order, and twice, give one save',
    () =>
      Effect.gen(function* () {
        const { fromPhone, fromLaptop } = yield* twoDevicesWrote

        const phoneFirst = yield* openDevice(Option.none())
        yield* feed(phoneFirst, fromPhone)
        yield* feed(phoneFirst, fromLaptop)

        const laptopFirst = yield* openDevice(Option.none())
        yield* feed(laptopFirst, fromLaptop)
        yield* feed(laptopFirst, fromPhone)

        const hub = yield* makeHub()
        const once = yield* Layer.build(deviceOn(hub, Option.none()))
        yield* feed(once, Array.appendAll(fromLaptop, fromPhone))
        const again = yield* Layer.build(
          deviceOn(
            hub,
            Option.some({
              entryTable: 'journal_again',
              remotesTable: 'remotes_again',
            }),
          ),
        )
        yield* feed(again, Array.appendAll(fromPhone, fromLaptop))

        const expected = yield* saveOf(phoneFirst)
        expect(Option.isSome(expected)).toBe(true)
        const fromLaptopFirst = yield* saveOf(laptopFirst)
        expect(fromLaptopFirst).toEqual(expected)
        const fromAgain = yield* saveOf(again)
        expect(fromAgain).toEqual(expected)

        const save = Option.getOrThrow(expected)
        expect(save.bests.runsPlayed).toBe(legacySave.bests.runsPlayed + 2)
        expect(save.bests.totalKills).toBe(legacySave.bests.totalKills + 29)
        expect(save.bests.byDifficulty.Hard).toEqual({
          fastestWinMs: 450_000,
          bestEndlessWave: 4,
        })
        expect(save.rank.earnedPoints).toBe(200)
        expect(save.boughtCosmetics).toEqual(['Fez'])
        expect(save.proof).toEqual([
          { thing: 'Teapot', difficulty: 'Hard', stamp: firstStamp },
        ])
        expect(save.mastery).toEqual({
          heroes: { You: 45 },
          guns: { Pistol: 20, Smg: 4 },
        })
        expect(save.dareMarks.Hard).toBe(5)
        expect(save.missions.claimed).toEqual(['SplatZombies'])
        expect(save.name).toBe('Phone Gnaw')
        expect(save.settings.music).toBe('Off')
        expect(save.settings.sound).toBe(legacySave.settings.sound)
        expect(save.difficulty.nightmare).toBe('Unlocked')
        expect(save.seenUnlocks).toEqual(['hat:Fez'])
      }),
  )

  it.effect('the facts the Worker reads come off the same tables', () =>
    Effect.gen(function* () {
      const { fromPhone, fromLaptop } = yield* twoDevicesWrote
      const server = yield* openDevice(Option.none())
      yield* feed(server, Array.appendAll(fromLaptop, fromPhone))
      const facts = yield* on(server)(readPlayerFacts)
      expect(facts).toEqual({
        unlocked: true,
        milestones: [],
        marks: { Easy: 0, Normal: 0, Hard: 5, Nightmare: 0 },
      })
    }),
  )

  it.effect('a device with no seed holds no save', () =>
    Effect.gen(function* () {
      const laptop = yield* openDevice(Option.none())
      yield* on(laptop)(writeOnLaptop)
      const maybeSave = yield* saveOf(laptop)
      expect(maybeSave).toEqual(Option.none())
    }),
  )
})
