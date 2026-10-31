import {
  Array,
  Data,
  Effect,
  MutableRef,
  Schema,
  type Scope,
  pipe,
} from 'effect'

import { RECIPES } from './audioRecipes'
import { describeError } from './describeError'
import {
  type MusicCue,
  type MusicDeck,
  SILENCE,
  cueMusic,
  makeMusicDeck,
  runMusicScheduler,
} from './music'
import { generateMany, nextRandom } from './prng'
import type { SoundEffect } from './soundEffect'
import type {
  Envelope,
  NoiseLayer,
  PitchPoint,
  Recipe,
  ToneLayer,
} from './soundRecipe'

// SOUND

export { SoundEffect } from './soundEffect'

export const Playback = Schema.Literals(['Running', 'Suspended'])
export type Playback = typeof Playback.Type

export const PlayOutcome = Schema.Literals([
  'Played',
  'DroppedAtVoiceLimit',
  'DroppedWhileSuspended',
])
export type PlayOutcome = typeof PlayOutcome.Type

// ENGINE

export type AudioEngine = Readonly<{
  context: AudioContext
  output: GainNode
  noise: AudioBuffer
  activeVoices: MutableRef.MutableRef<number>
  music: MusicDeck
}>

export class AudioEngineError extends Data.TaggedError('AudioEngineError')<{
  readonly reason: string
}> {}

const MASTER_VOLUME = 0.55
const NOISE_SECONDS = 0.5
const NOISE_SEED = 0x2f6b9d13
const MAX_VOICES = 10
const STOP_PADDING_SECONDS = 0.02
const RESUME_TIMEOUT = '600 millis'

const whiteNoise = (sampleCount: number): Float32Array<ArrayBuffer> => {
  const [_nextState, samples] = generateMany(
    NOISE_SEED,
    sampleCount,
    drawState => {
      const { value, nextState } = nextRandom(drawState)
      return [nextState, value * 2 - 1]
    },
  )
  return Float32Array.from(samples)
}

const buildEngine = (): AudioEngine => {
  const context = new AudioContext({ latencyHint: 'interactive' })
  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -14
  compressor.knee.value = 12
  compressor.ratio.value = 4
  compressor.attack.value = 0.002
  compressor.release.value = 0.12
  compressor.connect(context.destination)

  const output = context.createGain()
  output.gain.value = MASTER_VOLUME
  output.connect(compressor)

  const sampleCount = Math.floor(context.sampleRate * NOISE_SECONDS)
  const noise = context.createBuffer(1, sampleCount, context.sampleRate)
  noise.copyToChannel(whiteNoise(sampleCount), 0)

  return {
    context,
    output,
    noise,
    activeVoices: MutableRef.make(0),
    music: makeMusicDeck(context, compressor, noise),
  }
}

export const acquireAudioEngine: Effect.Effect<
  AudioEngine,
  AudioEngineError,
  Scope.Scope
> = pipe(
  Effect.try({
    try: buildEngine,
    catch: error => new AudioEngineError({ reason: describeError(error) }),
  }),
  Effect.tap(engine => Effect.forkScoped(runMusicScheduler(engine.music))),
)

export const releaseAudioEngine = (engine: AudioEngine): Effect.Effect<void> =>
  pipe(
    Effect.tryPromise(() => engine.context.close()),
    Effect.ignore,
  )

const currentPlayback = (engine: AudioEngine): Playback =>
  engine.context.state === 'running' ? 'Running' : 'Suspended'

export const resumeAudio = (
  engine: AudioEngine,
): Effect.Effect<Playback, AudioEngineError> =>
  currentPlayback(engine) === 'Running'
    ? Effect.succeed(currentPlayback(engine))
    : pipe(
        Effect.tryPromise({
          try: () => engine.context.resume(),
          catch: error =>
            new AudioEngineError({ reason: describeError(error) }),
        }),
        Effect.timeoutOption(RESUME_TIMEOUT),
        Effect.map(() => currentPlayback(engine)),
      )

// SYNTHESIS

type Chain = Readonly<{
  source: AudioScheduledSourceNode
  nodes: ReadonlyArray<AudioNode>
  stopAt: number
}>

const envelopeEnd = (
  startAt: number,
  { delaySeconds, attackSeconds, decaySeconds }: Envelope,
): number =>
  startAt + delaySeconds + attackSeconds + decaySeconds + STOP_PADDING_SECONDS

const applyEnvelope = (
  gain: AudioParam,
  startAt: number,
  { delaySeconds, peak, attackSeconds, decaySeconds }: Envelope,
): void => {
  const attackStart = startAt + delaySeconds
  gain.setValueAtTime(SILENCE, startAt)
  gain.setValueAtTime(SILENCE, attackStart)
  gain.exponentialRampToValueAtTime(peak, attackStart + attackSeconds)
  gain.exponentialRampToValueAtTime(
    SILENCE,
    attackStart + attackSeconds + decaySeconds,
  )
}

const applyPitch = (
  param: AudioParam,
  startAt: number,
  points: ReadonlyArray<PitchPoint>,
): void => {
  Array.forEach(points, ({ atSeconds, frequency }, index) => {
    if (index === 0) {
      param.setValueAtTime(frequency, startAt + atSeconds)
    } else {
      param.exponentialRampToValueAtTime(frequency, startAt + atSeconds)
    }
  })
}

const toneChain = (
  engine: AudioEngine,
  startAt: number,
  detuneCents: number,
  layer: ToneLayer,
): Chain => {
  const oscillator = engine.context.createOscillator()
  const gain = engine.context.createGain()
  oscillator.type = layer.wave
  oscillator.detune.value = detuneCents
  applyPitch(oscillator.frequency, startAt, layer.pitch)
  applyEnvelope(gain.gain, startAt, layer.envelope)
  oscillator.connect(gain)
  gain.connect(engine.output)
  return {
    source: oscillator,
    nodes: [oscillator, gain],
    stopAt: envelopeEnd(startAt, layer.envelope),
  }
}

const noiseChain = (
  engine: AudioEngine,
  startAt: number,
  detuneCents: number,
  layer: NoiseLayer,
): Chain => {
  const source = engine.context.createBufferSource()
  const filter = engine.context.createBiquadFilter()
  const gain = engine.context.createGain()
  source.buffer = engine.noise
  source.loop = true
  filter.type = layer.filter
  filter.Q.value = layer.quality
  filter.detune.value = detuneCents
  applyPitch(filter.frequency, startAt, layer.cutoff)
  applyEnvelope(gain.gain, startAt, layer.envelope)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(engine.output)
  return {
    source,
    nodes: [source, filter, gain],
    stopAt: envelopeEnd(startAt, layer.envelope),
  }
}

const startVoice = (
  engine: AudioEngine,
  recipe: Recipe,
  variation: number,
): void => {
  const startAt = engine.context.currentTime
  const detuneCents = variation * recipe.variationCents
  const chains = [
    ...Array.map(recipe.tones, layer =>
      toneChain(engine, startAt, detuneCents, layer),
    ),
    ...Array.map(recipe.noises, layer =>
      noiseChain(engine, startAt, detuneCents, layer),
    ),
  ]
  const remainingChains = MutableRef.make(chains.length)
  MutableRef.increment(engine.activeVoices)
  Array.forEach(chains, ({ source, nodes, stopAt }) => {
    source.onended = () => {
      Array.forEach(nodes, node => node.disconnect())
      source.onended = null
      if (MutableRef.decrementAndGet(remainingChains) === 0) {
        MutableRef.decrement(engine.activeVoices)
      }
    }
    source.start(startAt)
    source.stop(stopAt)
  })
}

const isAtVoiceLimit = (engine: AudioEngine): boolean =>
  MutableRef.get(engine.activeVoices) >= MAX_VOICES

export const playSound = (
  engine: AudioEngine,
  sound: SoundEffect,
  variation: number,
): Effect.Effect<PlayOutcome, AudioEngineError> =>
  Effect.suspend((): Effect.Effect<PlayOutcome, AudioEngineError> => {
    if (currentPlayback(engine) === 'Suspended') {
      return Effect.succeed('DroppedWhileSuspended')
    } else if (isAtVoiceLimit(engine)) {
      return Effect.succeed('DroppedAtVoiceLimit')
    } else {
      return Effect.try({
        try: (): PlayOutcome => {
          startVoice(engine, RECIPES[sound], variation)
          return 'Played'
        },
        catch: error => new AudioEngineError({ reason: describeError(error) }),
      })
    }
  })

// MUSIC

export const playMusic = (
  engine: AudioEngine,
  cue: MusicCue,
): Effect.Effect<void, AudioEngineError> =>
  Effect.try({
    try: () => cueMusic(engine.music, cue),
    catch: error => new AudioEngineError({ reason: describeError(error) }),
  })

// VARIATION

const VARIATION_STEPS = 9
const X_MIXER = 73
const Y_MIXER = 151

export const positionVariation = (x: number, y: number): number => {
  const bucket =
    Math.abs(Math.floor(x) * X_MIXER + Math.floor(y) * Y_MIXER) %
    VARIATION_STEPS
  return (bucket / (VARIATION_STEPS - 1)) * 2 - 1
}
