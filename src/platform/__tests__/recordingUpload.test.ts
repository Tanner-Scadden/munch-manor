// @vitest-environment happy-dom
import { Array, Effect, Option, Ref, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, vi } from '@effect/vitest'

import { initialModel } from '../../app/pureApp'
import { asVeteran } from '../../test/veteran'
import { focusOf } from '../../world/party/party'
import {
  type RunRecording,
  beginRecording,
  finishRecording,
} from '../recording'
import { MAX_RECORDING_BYTES, RECORDINGS_PATH } from '../recordingApi'
import { startRecordingQueue, uploadRecording } from '../recordingUpload'
import type { RoomAccess } from '../roomReplica'
import { saveOf } from '../save'
import { PlayerStore } from '../store'

const ORIGIN = 'https://api.example.test'
const TOKEN = 'signed-token'

const recording: RunRecording = Option.getOrThrow(
  finishRecording(
    beginRecording({
      world: initialModel,
      maybeVisitId: Option.some('0123456789abcdef'),
      build: 'test',
      device: 'KeyboardMouse',
      localPlayers: 1,
      botSlots: [],
      focusSlot: focusOf(initialModel).seat.slot,
    }),
  ),
)

const stubNavigator = (isOnline: boolean) => {
  vi.stubGlobal('navigator', { onLine: isOnline })
}

const fetchAnswering = (status: number) =>
  vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(null, { status })),
  )

const unused = Effect.die('the recording queue does not use this')

const signedIn: RoomAccess = {
  playerId: Effect.succeed('player'),
  token: Effect.succeed(TOKEN),
  canFollow: Effect.succeed(false),
  followRoom: () => Stream.die('unused'),
  writeRoom: () => unused,
}

// NOTE: a PlayerStore that keeps only the recording queue, in memory, a save
// with the setting, and a sync session or none.
const fakeStore = (
  queued: ReadonlyArray<string>,
  recordRuns: 'On' | 'Off',
  maybeAccess: Option.Option<RoomAccess>,
) =>
  Effect.gen(function* () {
    const waiting = yield* Ref.make(queued)
    const store = PlayerStore.of({
      load: Effect.succeedSome(
        saveOf(
          modifyFields(asVeteran(initialModel), {
            recordRuns: () => recordRuns,
          }),
        ),
      ),
      write: () => unused,
      awaitSettled: () => unused,
      events: Stream.empty,
      requestLinkCode: unused,
      redeemLinkCode: () => unused,
      roomAccess: Effect.succeed(maybeAccess),
      queueSummary: () => unused,
      takeQueuedSummary: unused,
      clearQueuedSummaries: unused,
      isRecordUnlocked: unused,
      unlockRecord: unused,
      queueRecording: body => Ref.update(waiting, all => [...all, body]),
      takeQueuedRecording: Ref.modify(waiting, all =>
        Array.match(all, {
          onEmpty: () => [Option.none<string>(), all],
          onNonEmpty: ([first, ...rest]) => [Option.some(first), rest],
        }),
      ),
      clearQueuedRecordings: Ref.set(waiting, []),
    })
    return { store, waiting }
  })

describe('recorded runs sent or queued', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect('an online run is posted, signed, to its run id', () =>
    Effect.gen(function* () {
      stubNavigator(true)
      const fetch = fetchAnswering(202)
      const fake = yield* fakeStore([], 'On', Option.some(signedIn))
      yield* uploadRecording(recording, ORIGIN).pipe(
        Effect.provideService(PlayerStore, fake.store),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      const [input, init] = fetch.mock.calls[0] ?? []
      const url = new URL(globalThis.String(input))
      expect(url.origin + url.pathname).toBe(`${ORIGIN}${RECORDINGS_PATH}`)
      expect(url.searchParams.get('run')).toBe(recording.runId)
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${TOKEN}`,
      )
      const queuedNow = yield* Ref.get(fake.waiting)
      expect(queuedNow).toEqual([])
    }),
  )

  it.effect('an offline run is queued and nothing is sent', () =>
    Effect.gen(function* () {
      stubNavigator(false)
      const fetch = fetchAnswering(202)
      const fake = yield* fakeStore([], 'On', Option.some(signedIn))
      yield* uploadRecording(recording, ORIGIN).pipe(
        Effect.provideService(PlayerStore, fake.store),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      expect(fetch).not.toHaveBeenCalled()
      const queuedNow = yield* Ref.get(fake.waiting)
      expect(queuedNow).toHaveLength(1)
    }),
  )

  it.effect('a run with no sync session yet waits in the queue', () =>
    Effect.gen(function* () {
      stubNavigator(true)
      const fetch = fetchAnswering(202)
      const fake = yield* fakeStore([], 'On', Option.none())
      yield* uploadRecording(recording, ORIGIN).pipe(
        Effect.provideService(PlayerStore, fake.store),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      expect(fetch).not.toHaveBeenCalled()
      const queuedNow = yield* Ref.get(fake.waiting)
      expect(queuedNow).toHaveLength(1)
    }),
  )

  it.effect('a refused post waits in the queue', () =>
    Effect.gen(function* () {
      stubNavigator(true)
      const fetch = fetchAnswering(429)
      const fake = yield* fakeStore([], 'On', Option.some(signedIn))
      yield* uploadRecording(recording, ORIGIN).pipe(
        Effect.provideService(PlayerStore, fake.store),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      const queuedNow = yield* Ref.get(fake.waiting)
      expect(queuedNow).toHaveLength(1)
    }),
  )

  it.effect('a build with no API origin sends and keeps nothing', () =>
    Effect.gen(function* () {
      stubNavigator(true)
      const fetch = fetchAnswering(202)
      const fake = yield* fakeStore([], 'On', Option.some(signedIn))
      yield* uploadRecording(recording, '').pipe(
        Effect.provideService(PlayerStore, fake.store),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      expect(fetch).not.toHaveBeenCalled()
      const queuedNow = yield* Ref.get(fake.waiting)
      expect(queuedNow).toEqual([])
    }),
  )

  it.effect('at start, a player who turned recording off loses the queue', () =>
    Effect.gen(function* () {
      stubNavigator(true)
      const fetch = fetchAnswering(202)
      const fake = yield* fakeStore(['{}'], 'Off', Option.some(signedIn))
      yield* startRecordingQueue(ORIGIN).pipe(
        Effect.provideService(PlayerStore, fake.store),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      expect(fetch).not.toHaveBeenCalled()
      const queuedNow = yield* Ref.get(fake.waiting)
      expect(queuedNow).toEqual([])
    }),
  )

  it('the cap fits an hour of play', () => {
    expect(MAX_RECORDING_BYTES).toBeGreaterThanOrEqual(4 * 1024 * 1024)
  })
})
