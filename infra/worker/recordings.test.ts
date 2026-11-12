import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { describe, expect, it } from '@effect/vitest'
import { signToken } from '@munch/sync-engine'

import {
  GZIP_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  MAX_RECORDING_BYTES,
} from '../../src/platform/recordingApi.ts'
import type { RateLimiter } from './api.ts'
import { type RecordingBucket, routeRecording } from './recordings.ts'

const SECRET = 'recordings-secret'
const PLAYER = 'AAAAAAAAAAAAAAAAAAAAAA'
const RUN = '0123456789abcdef2f6b9a1d'
const URL_BASE = 'https://api.example.test/api/recordings'

type Stored = Readonly<{ key: string; size: number; contentType: string }>

const fakeBucket = () => {
  const stored: Array<Stored> = []
  const bucket: RecordingBucket = {
    put: (key, value, options) => {
      stored.push({
        key,
        size: value.byteLength,
        contentType: options.httpMetadata.contentType,
      })
      return Promise.resolve(null)
    },
  }
  return { bucket, stored }
}

const countingLimiter = (limit: number) => {
  const keys: Array<string> = []
  const limiter: RateLimiter = {
    limit: ({ key }) => {
      keys.push(key)
      return Promise.resolve({
        success: Array.filter(keys, seen => seen === key).length <= limit,
      })
    },
  }
  return { limiter, keys }
}

const setUp = (limit = 10) => {
  const { bucket, stored } = fakeBucket()
  const { limiter, keys } = countingLimiter(limit)
  return {
    env: {
      SYNC_SECRET: SECRET,
      RECORDINGS: bucket,
      RECORDINGS_BY_PLAYER: limiter,
    },
    stored,
    keys,
  }
}

const tokenOf = (playerId: string) =>
  Effect.flatMap(Clock.currentTimeMillis, nowMs =>
    signToken(SECRET, {
      playerId,
      deviceId: `${playerId}-device`,
      expiresMs: nowMs + 60_000,
    }),
  )

const post = ({
  token,
  run = RUN,
  body = new Uint8Array([0x1f, 0x8b, 1, 2, 3]),
  contentType = GZIP_CONTENT_TYPE,
}: Readonly<{
  token: string
  run?: string
  body?: Uint8Array
  contentType?: string
}>): Request =>
  new Request(`${URL_BASE}?run=${run}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
    body,
  })

const statusOf = (request: Request, env: ReturnType<typeof setUp>['env']) =>
  Effect.map(routeRecording(request, env), maybeResponse =>
    Option.match(maybeResponse, {
      onNone: () => 0,
      onSome: response => response.status,
    }),
  )

describe('POST /api/recordings', () => {
  it.effect('a signed gzip run is stored under its player and run, 202', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const token = yield* tokenOf(PLAYER)
      const status = yield* statusOf(post({ token }), setup.env)
      expect(status).toBe(202)
      expect(setup.stored).toEqual([
        {
          key: `recordings/${PLAYER}/${RUN}.json.gz`,
          size: 5,
          contentType: GZIP_CONTENT_TYPE,
        },
      ])
      expect(setup.keys).toEqual([`recording:${PLAYER}`])
    }),
  )

  it.effect('a plain JSON run is kept as .json', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const token = yield* tokenOf(PLAYER)
      const status = yield* statusOf(
        post({
          token,
          body: new TextEncoder().encode('{}'),
          contentType: `${JSON_CONTENT_TYPE}; charset=utf-8`,
        }),
        setup.env,
      )
      expect(status).toBe(202)
      expect(setup.stored[0]?.key).toBe(`recordings/${PLAYER}/${RUN}.json`)
    }),
  )

  it.effect('no token or a forged one answers 401 and stores nothing', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const forged = yield* signToken('another-secret', {
        playerId: PLAYER,
        deviceId: 'device',
        expiresMs: 60_000,
      })
      const unsigned = yield* statusOf(post({ token: '' }), setup.env)
      const forgedStatus = yield* statusOf(post({ token: forged }), setup.env)
      expect([unsigned, forgedStatus]).toEqual([401, 401])
      expect(setup.stored).toEqual([])
    }),
  )

  it.effect('a run id that is not one answers 400', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const token = yield* tokenOf(PLAYER)
      const runs = ['', '../../other', 'ABCDEF0123456789abcdef01', '0123']
      const statuses = yield* Effect.forEach(runs, run =>
        statusOf(post({ token, run }), setup.env),
      )
      expect(statuses).toEqual([400, 400, 400, 400])
      expect(setup.stored).toEqual([])
    }),
  )

  it.effect('another body type answers 415', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const token = yield* tokenOf(PLAYER)
      const status = yield* statusOf(
        post({ token, contentType: 'text/plain' }),
        setup.env,
      )
      expect(status).toBe(415)
    }),
  )

  it.effect('a run over the cap answers 413 and stores nothing', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const token = yield* tokenOf(PLAYER)
      const status = yield* statusOf(
        post({ token, body: new Uint8Array(MAX_RECORDING_BYTES + 1) }),
        setup.env,
      )
      expect(status).toBe(413)
      expect(setup.stored).toEqual([])
    }),
  )

  it.effect('a run at the cap is stored', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const token = yield* tokenOf(PLAYER)
      const status = yield* statusOf(
        post({ token, body: new Uint8Array(MAX_RECORDING_BYTES) }),
        setup.env,
      )
      expect(status).toBe(202)
    }),
  )

  it.effect('too many runs from one player answers 429, others still go', () =>
    Effect.gen(function* () {
      const setup = setUp(2)
      const token = yield* tokenOf(PLAYER)
      const other = yield* tokenOf('BBBBBBBBBBBBBBBBBBBBBB')
      const statuses = yield* Effect.forEach([1, 2, 3], () =>
        statusOf(post({ token }), setup.env),
      )
      expect(statuses).toEqual([202, 202, 429])
      const otherStatus = yield* statusOf(post({ token: other }), setup.env)
      expect(otherStatus).toBe(202)
      expect(setup.stored).toHaveLength(3)
    }),
  )

  it.effect('the preflight answers with CORS, and GET is refused', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const preflight = yield* statusOf(
        new Request(URL_BASE, { method: 'OPTIONS' }),
        setup.env,
      )
      const read = yield* statusOf(new Request(URL_BASE), setup.env)
      expect([preflight, read]).toEqual([204, 405])
    }),
  )

  it.effect('another path is not this route', () =>
    Effect.gen(function* () {
      const setup = setUp()
      const maybeResponse = yield* routeRecording(
        new Request('https://api.example.test/api/runs', { method: 'POST' }),
        setup.env,
      )
      expect(Option.isNone(maybeResponse)).toBe(true)
    }),
  )
})
