// @vitest-environment happy-dom
import {
  Array,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from 'effect'
import { TestClock } from 'effect/testing'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, vi } from '@effect/vitest'

import {
  RUN_SUMMARY_VERSION,
  type RunSummary,
  RunSummaryJson,
  RunSummaryV1,
  SOLO_PARTY,
} from './analytics'
import { initialModel } from './model'
import { saveOf } from './save'
import { PlayerStore } from './store'
import { sendOrQueueRunSummary, startSummaryQueue } from './summaryQueue'
import { asVeteran } from './veteran'

const ORIGIN = 'https://api.example.test'

const summary: RunSummary = {
  version: RUN_SUMMARY_VERSION,
  visitId: '0123456789abcdef',
  build: 'test',
  mode: 'Campaign',
  difficulty: 'Hard',
  wave: 8,
  outcome: { _tag: 'Victory' },
  runMs: 200_000,
  kills: {
    Shambler: 30,
    Runner: 4,
    Tank: 0,
    Exploder: 0,
    Thrower: 0,
    Crawler: 0,
    Boss: 1,
  },
  heartsLost: 2,
  purchases: 3,
  powerUpsGrabbed: 1,
  trapsPlaced: 2,
  device: 'Touch',
  screenFit: 'Installed',
  frameTime: 'Under17Ms',
  party: SOLO_PARTY,
}

const bodyOf = (wave: number) =>
  Schema.encodeSync(RunSummaryJson)({ ...summary, wave })

const stubNavigator = (isOnline: boolean) => {
  const sendBeacon = vi.fn<Navigator['sendBeacon']>(() => true)
  vi.stubGlobal('navigator', { onLine: isOnline, sendBeacon })
  return sendBeacon
}

// NOTE: a PlayerStore that keeps only the queue, in memory, and a save that
// says whether the player shares stats. Nothing else of the store is used.
const fakeStore = (
  queued: ReadonlyArray<string>,
  shareStats: 'On' | 'Off' | 'NoSave',
) =>
  Effect.gen(function* () {
    const waiting = yield* Ref.make(queued)
    const unused = Effect.die('the summary queue does not use this')
    const layer = Layer.succeed(PlayerStore, {
      load: Effect.succeed(
        shareStats === 'NoSave'
          ? Option.none()
          : Option.some(
              saveOf(
                modifyFields(asVeteran(initialModel), {
                  shareStats: () => shareStats,
                }),
              ),
            ),
      ),
      write: () => unused,
      awaitSettled: () => unused,
      events: Stream.empty,
      requestLinkCode: unused,
      redeemLinkCode: () => unused,
      roomAccess: Effect.succeedNone,
      queueSummary: body => Ref.update(waiting, all => [...all, body]),
      takeQueuedSummary: Ref.modify(waiting, all =>
        Array.match(all, {
          onEmpty: () => [Option.none<string>(), all],
          onNonEmpty: ([first, ...rest]) => [Option.some(first), rest],
        }),
      ),
      clearQueuedSummaries: Ref.set(waiting, []),
    })
    return { layer, waiting }
  })

describe('run summaries sent or queued', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect('an online run is sent and nothing is queued', () =>
    Effect.gen(function* () {
      const sendBeacon = stubNavigator(true)
      const fake = yield* fakeStore([], 'NoSave')
      yield* sendOrQueueRunSummary(summary, ORIGIN).pipe(
        Effect.provide(fake.layer),
      )
      expect(sendBeacon).toHaveBeenCalledTimes(1)
      expect(yield* Ref.get(fake.waiting)).toEqual([])
    }),
  )

  it.effect('an offline run is queued and nothing is sent', () =>
    Effect.gen(function* () {
      const sendBeacon = stubNavigator(false)
      const fake = yield* fakeStore([], 'NoSave')
      yield* sendOrQueueRunSummary(summary, ORIGIN).pipe(
        Effect.provide(fake.layer),
      )
      expect(sendBeacon).not.toHaveBeenCalled()
      const waiting = yield* Ref.get(fake.waiting)
      expect(waiting).toHaveLength(1)
      expect(waiting).toEqual([bodyOf(8)])
    }),
  )

  it.effect('a build with no API origin queues nothing', () =>
    Effect.gen(function* () {
      stubNavigator(false)
      const fake = yield* fakeStore([], 'NoSave')
      yield* sendOrQueueRunSummary(summary, '').pipe(Effect.provide(fake.layer))
      expect(yield* Ref.get(fake.waiting)).toEqual([])
    }),
  )

  it.effect(
    'the queue goes out when the game starts, one every 11 seconds',
    () =>
      Effect.gen(function* () {
        const sendBeacon = stubNavigator(true)
        const fake = yield* fakeStore([bodyOf(1), bodyOf(2), bodyOf(3)], 'On')
        const sending = yield* Effect.forkChild(
          startSummaryQueue(ORIGIN).pipe(Effect.provide(fake.layer)),
        )
        yield* Effect.yieldNow
        expect(sendBeacon).toHaveBeenCalledTimes(1)
        yield* TestClock.adjust('11 seconds')
        expect(sendBeacon).toHaveBeenCalledTimes(2)
        yield* TestClock.adjust('11 seconds')
        expect(sendBeacon).toHaveBeenCalledTimes(3)
        yield* TestClock.adjust('11 seconds')
        yield* Fiber.join(sending)
        expect(sendBeacon).toHaveBeenCalledTimes(3)
        expect(yield* Ref.get(fake.waiting)).toEqual([])
      }),
  )

  it.effect('the queue stays put while the game is still offline', () =>
    Effect.gen(function* () {
      const sendBeacon = stubNavigator(false)
      const fake = yield* fakeStore([bodyOf(1)], 'On')
      yield* startSummaryQueue(ORIGIN).pipe(Effect.provide(fake.layer))
      expect(sendBeacon).not.toHaveBeenCalled()
      expect(yield* Ref.get(fake.waiting)).toEqual([bodyOf(1)])
    }),
  )

  it.effect(
    'a player who turned sharing off sends none, and the queue is cleared',
    () =>
      Effect.gen(function* () {
        const sendBeacon = stubNavigator(true)
        const fake = yield* fakeStore([bodyOf(1), bodyOf(2)], 'Off')
        yield* startSummaryQueue(ORIGIN).pipe(Effect.provide(fake.layer))
        expect(sendBeacon).not.toHaveBeenCalled()
        expect(yield* Ref.get(fake.waiting)).toEqual([])
      }),
  )

  it.effect(
    'a summary that can no longer be read is dropped, and the rest go',
    () =>
      Effect.gen(function* () {
        const sendBeacon = stubNavigator(true)
        const fake = yield* fakeStore(['{"version":0}', bodyOf(2)], 'On')
        const sending = yield* Effect.forkChild(
          startSummaryQueue(ORIGIN).pipe(Effect.provide(fake.layer)),
        )
        yield* Effect.yieldNow
        yield* TestClock.adjust('11 seconds')
        yield* TestClock.adjust('11 seconds')
        yield* Fiber.join(sending)
        expect(sendBeacon).toHaveBeenCalledTimes(1)
        expect(yield* Ref.get(fake.waiting)).toEqual([])
      }),
  )

  it.effect(
    'a version 1 summary a build before co-op queued still goes, as it was',
    () =>
      Effect.gen(function* () {
        const sendBeacon = stubNavigator(true)
        const { party: _party, ...older } = summary
        const olderBody = yield* Schema.encodeEffect(
          Schema.fromJsonString(RunSummaryV1),
        )({ ...older, version: 1 })
        const fake = yield* fakeStore([olderBody], 'On')
        const sending = yield* Effect.forkChild(
          startSummaryQueue(ORIGIN).pipe(Effect.provide(fake.layer)),
        )
        yield* Effect.yieldNow
        yield* TestClock.adjust('11 seconds')
        yield* Fiber.join(sending)
        expect(sendBeacon).toHaveBeenCalledTimes(1)
        const sent = sendBeacon.mock.calls[0]?.[1] ?? null
        expect(yield* Effect.promise(() => new Response(sent).text())).toBe(
          olderBody,
        )
        expect(yield* Ref.get(fake.waiting)).toEqual([])
      }),
  )
})
