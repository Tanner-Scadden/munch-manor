import { Array, Effect, String } from 'effect'

import { describe, expect, it, test } from '@effect/vitest'

import {
  KILL_SWITCH_SOURCE,
  SHELL_URL,
  precacheDrift,
  precacheList,
  serviceWorkerSource,
} from '../precache'

// NOTE: the shape of a real build: what Vite emits (the shell, chunks, the
// lazy SQLite chunk, the store worker and its SQLite worker files, the wasm,
// the stylesheet, version.json) and what it copies from public/.
const EMITTED = [
  'index.html',
  'version.json',
  'assets/index-Bvy6TB5D.js',
  'assets/brand-C1hLZlsc.js',
  'assets/Browser-hbO1EBZW.js',
  'assets/storeSqlite-9yfL3jtL.js',
  'assets/store.worker-BLF2VwIW.js',
  'assets/sqlite3-worker1--76YIBzr.js',
  'assets/sqlite3-opfs-async-proxy-DeAec6oc.js',
  'assets/sqlite3-k2cTanUO.wasm',
  'assets/index-BTGXsY4X.css',
]

const PUBLIC = [
  '_headers',
  'apple-touch-icon.png',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'manifest.webmanifest',
  'og-image.png',
]

describe('the precache list', () => {
  const list = precacheList(EMITTED, PUBLIC)

  test('holds every emitted asset, the shell under the root URL', () => {
    const emittedAssets = Array.filter(EMITTED, file =>
      String.startsWith('assets/')(file),
    )
    expect(list).toEqual(expect.arrayContaining(emittedAssets))
    expect(list).toContain(SHELL_URL)
    expect(list).not.toContain('index.html')
  })

  test('holds the icons and the manifest', () => {
    expect(list).toEqual(
      expect.arrayContaining([
        'apple-touch-icon.png',
        'favicon.svg',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'manifest.webmanifest',
      ]),
    )
  })

  test('leaves out version.json, the worker, _headers, and the og image', () => {
    expect(list).not.toContain('version.json')
    expect(list).not.toContain('sw.js')
    expect(list).not.toContain('_headers')
    expect(list).not.toContain('og-image.png')
  })

  test('leaves out source maps and the Vite manifest', () => {
    expect(
      precacheList(
        ['assets/index-a.js', 'assets/index-a.js.map', '.vite/manifest.json'],
        [],
      ),
    ).toStrictEqual(['assets/index-a.js'])
  })

  test('is sorted and has no repeats, so one build writes one worker', () => {
    expect(list).toStrictEqual([...list].sort())
    expect(new Set(list).size).toBe(list.length)
    expect(precacheList([...EMITTED].reverse(), PUBLIC)).toStrictEqual(list)
  })
})

describe('the drift check', () => {
  const list = precacheList(EMITTED, PUBLIC)
  const deployed = [...EMITTED, ...PUBLIC, 'sw.js']

  test('a sound build has no drift', () => {
    expect(precacheDrift(deployed, list)).toStrictEqual({
      missing: [],
      extra: [],
    })
  })

  test('a deployed file the list misses is caught', () => {
    expect(
      precacheDrift([...deployed, 'assets/late-chunk-X1.js'], list).missing,
    ).toStrictEqual(['assets/late-chunk-X1.js'])
  })

  test('a listed file that was not deployed is caught', () => {
    expect(
      precacheDrift(
        Array.filter(deployed, file => file !== 'assets/sqlite3-k2cTanUO.wasm'),
        list,
      ).extra,
    ).toStrictEqual(['assets/sqlite3-k2cTanUO.wasm'])
  })
})

describe('the worker source', () => {
  it.effect(
    'starts with the build id and the list, and is a classic script',
    () =>
      Effect.gen(function* () {
        const source = yield* serviceWorkerSource(
          'abc123',
          ['./', 'assets/a.js'],
          'export {};\nconst CACHE = 1;\n',
        )
        expect(Array.take(String.split(source, '\n'), 2)).toStrictEqual([
          'const BUILD = "abc123";',
          'const PRECACHE = ["./","assets/a.js"];',
        ])
        expect(source).not.toMatch(/^export/m)
        expect(source).toContain('const CACHE = 1;')
      }),
  )

  test('the kill switch unregisters and clears the caches', () => {
    expect(KILL_SWITCH_SOURCE).toContain('skipWaiting')
    expect(KILL_SWITCH_SOURCE).toContain('unregister')
    expect(KILL_SWITCH_SOURCE).toContain('caches.delete')
  })
})
