import { Array, Effect, FileSystem, Option, Path, Schema, String } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import type { Browser } from 'playwright-core'

import { FRAMES_PER_SECOND } from './shotList'
import { type ClipCue, SoundtrackRequestJson, cueAt } from './soundtrackRequest'

// THE SOUNDTRACK
//
// NOTE: renders a clip's sound and music cues with the game's own audio
// engine in headless Chrome (audioPage.ts, bundled here), offline, and
// writes the mix as a 16 bit stereo WAV.

class SoundtrackFailed extends Schema.TaggedError<
  SoundtrackFailed,
  { readonly brand: unique symbol }
>()('SoundtrackFailed', { message: Schema.String }) {}

const failedWith = (error: unknown): SoundtrackFailed =>
  SoundtrackFailed.make({ message: globalThis.String(error) })

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2
const TAIL_FADE_SECONDS = 0.25

// NOTE: what Vite gives a production build, which the bundled game code
// reads.
const PRODUCTION_ENV = '{"DEV":false,"PROD":true,"MODE":"production"}'

const bundleAudioPage = Effect.gen(function* () {
  const path = yield* Path.Path
  const entry = path.join(import.meta.dir, 'audioPage.ts')
  const result = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [entry],
        target: 'browser',
        format: 'iife',
        minify: false,
        define: {
          'import.meta.env': PRODUCTION_ENV,
        },
      }),
    catch: failedWith,
  })
  const output = result.outputs[0]
  if (!result.success || output === undefined) {
    return yield* SoundtrackFailed.make({
      message: Array.join(
        Array.map(result.logs, log => log.message),
        '\n',
      ),
    })
  }
  return yield* Effect.tryPromise({
    try: () => output.text(),
    catch: failedWith,
  })
})

const wavHeader = (dataBytes: number): Uint8Array => {
  const header = new DataView(new ArrayBuffer(44))
  const ascii = (offset: number, text: string) =>
    Array.forEach(String.split('')(text), (char, index) =>
      header.setUint8(
        offset + index,
        Option.getOrElse(String.charCodeAt(char, 0), () => 0),
      ),
    )
  ascii(0, 'RIFF')
  header.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, CHANNELS, true)
  header.setUint32(24, SAMPLE_RATE, true)
  header.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true)
  header.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true)
  header.setUint16(34, BYTES_PER_SAMPLE * 8, true)
  ascii(36, 'data')
  header.setUint32(40, dataBytes, true)
  return new Uint8Array(header.buffer)
}

// NOTE: the last quarter second fades out, so a clip never ends on a click.
const fadeTail = (pcm: Int16Array): Int16Array => {
  const frames = pcm.length / CHANNELS
  const fadeFrames = Math.min(
    frames,
    Math.round(TAIL_FADE_SECONDS * SAMPLE_RATE),
  )
  const faded = pcm.slice()
  for (let index = 0; index < fadeFrames; index++) {
    const frame = frames - fadeFrames + index
    const gain = 1 - (index + 1) / fadeFrames
    for (let channel = 0; channel < CHANNELS; channel++) {
      const at = frame * CHANNELS + channel
      faded[at] = Math.round((faded[at] ?? 0) * gain)
    }
  }
  return faded
}

// NOTE: one page in its own context for the render, closed after.
const renderInPage = (browser: Browser, script: string, request: string) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => browser.newContext(), catch: failedWith }),
    context =>
      Effect.gen(function* () {
        const page = yield* Effect.tryPromise({
          try: () => context.newPage(),
          catch: failedWith,
        })
        yield* Effect.tryPromise({
          try: () =>
            page.setContent('<!doctype html><title>soundtrack</title>'),
          catch: failedWith,
        })
        yield* Effect.tryPromise({
          try: () => page.addScriptTag({ content: script }),
          catch: failedWith,
        })
        return yield* Effect.tryPromise({
          try: () => page.evaluate(json => window.__renderAudio(json), request),
          catch: failedWith,
        })
      }),
    context => Effect.promise(() => context.close()),
  )

/** @stability unstable */
export const renderSoundtrack = ({
  browser,
  cues,
  frames,
  outPath,
}: Readonly<{
  browser: Browser
  cues: ReadonlyArray<ClipCue>
  frames: number
  outPath: string
}>): Effect.Effect<
  number,
  SoundtrackFailed | Schema.SchemaError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const script = yield* bundleAudioPage
    const seconds = frames / FRAMES_PER_SECOND
    const request = yield* Schema.encodeEffect(SoundtrackRequestJson)({
      seconds,
      sampleRate: SAMPLE_RATE,
      cues: Array.map(cues, cue => cueAt(cue, FRAMES_PER_SECOND)),
    })
    const base64 = yield* renderInPage(browser, script, request)
    const bytes = Buffer.from(base64, 'base64')
    const pcm = fadeTail(
      new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
    )
    const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const wav = new Uint8Array(44 + data.byteLength)
    wav.set(wavHeader(data.byteLength), 0)
    wav.set(data, 44)
    yield* fs.writeFile(outPath, wav)
    return seconds
  })
