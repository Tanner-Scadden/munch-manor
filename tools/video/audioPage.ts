import { Array, Effect, MutableRef, Order, Schema, pipe } from 'effect'
import { TestClock } from 'effect/testing'

import { acquireAudioEngine, playMusic, playSound } from '../../src/audio/audio'
import type {} from '../audit/page'
import { type Cue, SoundtrackRequestJson } from './soundtrackRequest'

const SCHEDULER_SECONDS = 0.04
const CHANNELS = 2

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

AudioNode.prototype.disconnect = () => undefined

window.__renderAudio = (json: string): Promise<string> =>
  Effect.runPromise(
    Effect.flatMap(Schema.decodeEffect(SoundtrackRequestJson)(json), request =>
      render(request.cues, request.seconds, request.sampleRate),
    ).pipe(Effect.provide(TestClock.layer())),
  )
