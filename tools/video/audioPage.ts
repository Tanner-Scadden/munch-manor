import { Array, Effect, MutableRef, Order, Schema, pipe } from 'effect'
import { TestClock } from 'effect/testing'

import { acquireAudioEngine, playMusic, playSound } from '../../src/audio/audio'
import type {} from '../audit/page'
import { type Cue, SoundtrackRequestJson } from './soundtrackRequest'

// THE SOUNDTRACK, OFFLINE
//
// NOTE: runs in headless Chrome (bundled by soundtrack.ts). The game's own
// audio engine (src/audio/audio.ts) is built around an OfflineAudioContext
// instead of a live one, and its music scheduler runs on a test clock that
// this file moves on in 40 ms steps, as the real one ticks. The context's
// clock is moved to each step and each cue in turn, so every sound starts
// on its frame and the music is the tune the game plays, all scheduled
// before one render pass.
//
// Chrome sums a node's inputs in an order of its own, so a mix can differ
// from another render of it in the last bit of a few samples.

const SCHEDULER_SECONDS = 0.04
const CHANNELS = 2

// NOTE: the engine asks for `new AudioContext()`. It gets the offline one,
// reading as running, with its clock at `clock.now`: every sound and note
// is scheduled at its moment before the render starts, so the render is
// one pass over a finished graph and the same every time. The engine only
// reads what the two contexts share.
const liveLike = (
  context: OfflineAudioContext,
  clock: { now: number },
): OfflineAudioContext =>
  new Proxy(context, {
    get: (target, key) => {
      if (key === 'state') {
        return 'running'
      } else if (key === 'currentTime') {
        return clock.now
      }
      const value: unknown = Reflect.get(target, key, target)
      if (typeof value !== 'function') {
        return value
      }
      const bound: unknown = value.bind(target)
      return bound
    },
  })

const toInt16Base64 = (buffer: AudioBuffer): string => {
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))
  const samples = new Int16Array(left.length * CHANNELS)
  for (let index = 0; index < left.length; index++) {
    samples[index * 2] = Math.round(
      Math.max(-1, Math.min(1, left[index] ?? 0)) * 32767,
    )
    samples[index * 2 + 1] = Math.round(
      Math.max(-1, Math.min(1, right[index] ?? 0)) * 32767,
    )
  }
  const bytes = new Uint8Array(samples.buffer)
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(text)
}

const render = (
  cues: ReadonlyArray<Cue>,
  seconds: number,
  sampleRate: number,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = new OfflineAudioContext({
        numberOfChannels: CHANNELS,
        length: Math.ceil(seconds * sampleRate),
        sampleRate,
      })
      const clock = { now: 0 }
      Object.assign(window, {
        AudioContext: function AudioContext() {
          return liveLike(context, clock)
        },
      })
      const engine = yield* acquireAudioEngine
      const steps = Array.makeBy(
        Math.floor(seconds / SCHEDULER_SECONDS),
        index => index * SCHEDULER_SECONDS,
      )
      const moments = pipe(
        [...steps, ...Array.map(cues, cue => cue.seconds)],
        Array.filter(at => at < seconds),
        Array.dedupe,
        Array.sort(Order.Number),
      )
      const isStep = new Set(steps)
      for (const at of moments) {
        clock.now = at
        // NOTE: no voice limit offline: which voices have ended is the
        // render's to say, and every voice is already scheduled before it.
        MutableRef.set(engine.activeVoices, 0)
        for (const cue of Array.filter(cues, each => each.seconds === at)) {
          if (cue._tag === 'Sound') {
            yield* Effect.ignore(playSound(engine, cue.sound, cue.variation))
          } else {
            yield* Effect.ignore(playMusic(engine, cue))
          }
        }
        if (isStep.has(at)) {
          yield* TestClock.adjust(`${SCHEDULER_SECONDS * 1000} millis`)
          yield* Effect.yieldNow
        }
      }
      const value_1 = yield* Effect.promise(() => context.startRendering())
      return toInt16Base64(value_1)
    }),
  )

// NOTE: the engine disconnects a voice's nodes once its source ends. That
// lands on the page's thread whenever the event arrives, so it would cut a
// filter's last, tiny tail at a different sample on every render. Offline
// the nodes stay connected; an ended voice is silent all the same.
AudioNode.prototype.disconnect = () => undefined

window.__renderAudio = (json: string): Promise<string> =>
  Effect.runPromise(
    Effect.flatMap(Schema.decodeEffect(SoundtrackRequestJson)(json), request =>
      render(request.cues, request.seconds, request.sampleRate),
    ).pipe(Effect.provide(TestClock.layer())),
  )
