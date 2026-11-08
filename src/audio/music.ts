import {
  Array,
  Effect,
  Function,
  MutableRef,
  Option,
  Schedule,
  Schema,
  String,
  pipe,
} from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { toBrowserError } from '../shared/describeError'

// CUE

export const MusicMood = Schema.Literals([
  'Silence',
  'Creep',
  'Romp',
  'Stampede',
])
export type MusicMood = typeof MusicMood.Type

export const MusicLevel = Schema.Literals(['Full', 'Ducked'])
export type MusicLevel = typeof MusicLevel.Type

export const MusicStinger = Schema.Literals([
  'None',
  'Cleared',
  'Victory',
  'GameOver',
])
export type MusicStinger = typeof MusicStinger.Type

export type MusicCue = Readonly<{
  mood: MusicMood
  level: MusicLevel
  stinger: MusicStinger
}>

const LoopMood = MusicMood.pick(['Creep', 'Romp', 'Stampede'])
type LoopMood = typeof LoopMood.Type

const Fanfare = MusicStinger.pick(['Cleared', 'Victory', 'GameOver'])
type Fanfare = typeof Fanfare.Type

// NOTATION

type Instrument = 'Bass' | 'Organ' | 'Stab' | 'Spook' | 'Kick' | 'Snare' | 'Hat'

type Note = Readonly<{ instrument: Instrument; midi: number; steps: number }>

type Line = Readonly<{ instrument: Instrument; pattern: string }>

type Tune = Readonly<{
  stepSeconds: number
  swing: number
  length: number
  steps: ReadonlyArray<ReadonlyArray<Note>>
}>

const STEPS_PER_BEAT = 2
const STEPS_PER_BAR = 8
const SECONDS_PER_MINUTE = 60
const HOLD = '-'
const HIT = 'x'
const BAR_LINE = '|'
const NOTE_PATTERN = /^([A-G])([#b]?)(\d)$/
const SEMITONES_PER_OCTAVE = 12
const MIDI_OCTAVE_OFFSET = 1
const DRUM_MIDI = 0

const LETTER_SEMITONES: ReadonlyArray<readonly [string, number]> = [
  ['C', 0],
  ['D', 2],
  ['E', 4],
  ['F', 5],
  ['G', 7],
  ['A', 9],
  ['B', 11],
]

const accidentalShift = (accidental: string): number => {
  if (accidental === '#') {
    return 1
  } else if (accidental === 'b') {
    return -1
  } else {
    return 0
  }
}

const maybeLetterSemitone = (letter: string): Option.Option<number> =>
  Option.map(
    Array.findFirst(LETTER_SEMITONES, ([name]) => name === letter),
    ([, semitone]) => semitone,
  )

const maybeNamedMidi = (token: string): Option.Option<number> => {
  const match = NOTE_PATTERN.exec(token)
  if (match === null) {
    return Option.none()
  }

  const [, letter = '', accidental = '', octave = ''] = match
  return Option.map(
    maybeLetterSemitone(letter),
    semitone =>
      (Number(octave) + MIDI_OCTAVE_OFFSET) * SEMITONES_PER_OCTAVE +
      semitone +
      accidentalShift(accidental),
  )
}

const maybeMidi = (token: string): Option.Option<number> =>
  token === HIT ? Option.some(DRUM_MIDI) : maybeNamedMidi(token)

const tokensOf = (pattern: string): ReadonlyArray<string> =>
  Array.filter(
    String.split(/\s+/)(pattern),
    token => token !== '' && token !== BAR_LINE,
  )

const heldSteps = (tokens: ReadonlyArray<string>, index: number): number =>
  Array.takeWhile(Array.drop(tokens, index + 1), token => token === HOLD)
    .length + 1

const placedNotes = ({
  instrument,
  pattern,
}: Line): ReadonlyArray<readonly [number, Note]> => {
  const tokens = tokensOf(pattern)
  return pipe(
    tokens,
    Array.map((token, index) =>
      Option.map(maybeMidi(token), (midi): readonly [number, Note] => [
        index,
        { instrument, midi, steps: heldSteps(tokens, index) },
      ]),
    ),
    Array.getSomes,
  )
}

const tune = (bpm: number, swing: number, lines: ReadonlyArray<Line>): Tune => {
  const placed = Array.flatMap(lines, placedNotes)
  const length = Array.reduce(lines, 0, (longest, { pattern }) =>
    Math.max(longest, tokensOf(pattern).length),
  )
  return {
    stepSeconds: SECONDS_PER_MINUTE / bpm / STEPS_PER_BEAT,
    swing,
    length,
    steps: Array.makeBy(length, step =>
      pipe(
        placed,
        Array.filter(([at]) => at === step),
        Array.map(([, note]) => note),
      ),
    ),
  }
}

const line = (instrument: Instrument, pattern: string): Line => ({
  instrument,
  pattern,
})

// TUNES

const CREEP = tune(100, 0.34, [
  line(
    'Bass',
    'E2 . B1 . E2 . B1 . | E2 . B1 . G2 F#2 F2 . | C2 . G1 . C2 . G1 . | B1 . F#2 . B1 C2 C#2 D#2',
  ),
  line(
    'Spook',
    'B4 - - - C5 - B4 - | G4 - - - . . . . | E5 - - - D#5 - D5 - | A4 - - - F#4 - D#4 -',
  ),
  line(
    'Kick',
    'x . . . . . . . | x . . . . . . . | x . . . . . . . | x . . . . . . .',
  ),
  line(
    'Snare',
    '. . x . . . x . | . . x . . . x . | . . x . . . x . | . . x . . . x x',
  ),
  line(
    'Hat',
    '. x . x . x . x | . x . x . x . x | . x . x . x . x | . x . x . x . x',
  ),
])

const ROMP = tune(138, 0.2, [
  line(
    'Bass',
    'E2 E3 B1 B2 E2 E3 B1 B2 | G2 G3 D2 D3 G2 G3 F#2 F#3 | C2 C3 G1 G2 C2 C3 G1 G2 | B1 B2 F#2 F#3 B1 B2 D#2 D#3',
  ),
  line(
    'Organ',
    'E4 - G4 - B4 - A#4 - | B4 - - - G4 . F#4 . | E4 - G4 - C5 - B4 - | A4 - F#4 - D#4 - B3 -',
  ),
  line(
    'Stab',
    '. G3 . G3 . G3 . G3 | . B3 . B3 . A3 . A3 | . G3 . G3 . G3 . G3 | . A3 . A3 . A3 . A3',
  ),
  line(
    'Stab',
    '. B3 . B3 . B3 . B3 | . D4 . D4 . C4 . C4 | . C4 . C4 . E4 . E4 | . D#4 . D#4 . D#4 . D#4',
  ),
  line(
    'Kick',
    'x . . . x . . . | x . . . x . . . | x . . . x . . . | x . . . x . x .',
  ),
  line(
    'Snare',
    '. . x . . . x . | . . x . . . x . | . . x . . . x . | . . x . . . x x',
  ),
  line(
    'Hat',
    'x x x x x x x x | x x x x x x x x | x x x x x x x x | x x x x x x x x',
  ),
])

const STAMPEDE = tune(152, 0.12, [
  line(
    'Bass',
    'E2 E2 E3 E2 E2 E2 G2 A#2 | E2 E2 E3 E2 E2 E2 G2 A#2 | C2 C2 C3 C2 C2 C2 C3 C2 | B1 B1 B2 B1 D#2 D#2 F#2 A2',
  ),
  line(
    'Organ',
    'E5 - D#5 - E5 - B4 - | C5 - B4 - A#4 - B4 - | E5 - G5 - F#5 - E5 - | D#5 - B4 - F#4 - D#5 -',
  ),
  line(
    'Stab',
    '. G3 . G3 . G3 . G3 | . G3 . G3 . G3 . G3 | . G3 . G3 . G3 . G3 | . A3 . A3 . A3 . A3',
  ),
  line(
    'Stab',
    '. B3 . B3 . B3 . B3 | . B3 . B3 . A#3 . A#3 | . C4 . C4 . E4 . E4 | . D#4 . D#4 . D#4 . D#4',
  ),
  line(
    'Kick',
    'x . x . x . x . | x . x . x . x . | x . x . x . x . | x . x . x . x x',
  ),
  line(
    'Snare',
    '. . x . . . x . | . . x . . . x . | . . x . . . x . | . . x . x . x x',
  ),
  line(
    'Hat',
    'x x x x x x x x | x x x x x x x x | x x x x x x x x | x x x x x x x x',
  ),
])

const CLEARED = tune(150, 0, [
  line('Organ', 'E4 G4 B4 E5 - - - .'),
  line('Bass', 'E2 . . . E3 - . .'),
  line('Kick', 'x . . . x . . .'),
  line('Snare', '. . . . x . . .'),
])

const VICTORY = tune(140, 0, [
  line('Organ', 'E4 G#4 B4 E5 D#5 E5 - - | B5 - G#5 - E5 - - -'),
  line('Bass', 'E2 . B1 . E2 . B1 . | E2 - - - E3 - - -'),
  line('Kick', 'x . . . x . . . | x . . . x . . .'),
  line('Snare', '. . x . . . x x | x . . . . . . .'),
])

const GAME_OVER = tune(120, 0, [
  line('Organ', 'B4 - - A#4 - - A4 - | G#4 - - - - - - .'),
  line('Spook', 'B3 - - A#3 - - A3 - | G#3 - - - - - - .'),
  line('Bass', 'E2 - - D#2 - - D2 - | C#2 - - - - - - .'),
  line('Kick', 'x . . x . . x . | x . . . . . . .'),
])

const LOOPS: Readonly<Record<LoopMood, Tune>> = {
  Creep: CREEP,
  Romp: ROMP,
  Stampede: STAMPEDE,
}

const STINGERS: Readonly<Record<Fanfare, Tune>> = {
  Cleared: CLEARED,
  Victory: VICTORY,
  GameOver: GAME_OVER,
}

// DECK

type Request = Readonly<{
  mood: MusicMood
  maybeStinger: Option.Option<Fanfare>
}>

const Motion = defineTaggedUnion({
  Looping: { mood: LoopMood, step: Schema.Finite, stepAt: Schema.Finite },
  Stinging: { stinger: Fanfare, step: Schema.Finite, stepAt: Schema.Finite },
})
type Motion = typeof Motion.Type

export type MusicDeck = Readonly<{
  context: AudioContext
  bus: GainNode
  noise: AudioBuffer
  vibrato: GainNode
  wobble: GainNode
  track: MutableRef.MutableRef<GainNode>
  request: MutableRef.MutableRef<Request>
  maybeMotion: MutableRef.MutableRef<Option.Option<Motion>>
}>

const MUSIC_VOLUME = 0.26
const DUCKED_SHARE = 0.3
const LEVEL_TIME_CONSTANT = 0.08
const LFO_HERTZ = 5.2
const VIBRATO_CENTS = 9
const WOBBLE_CENTS = 38
const LOOKAHEAD_SECONDS = 0.2
const START_DELAY_SECONDS = 0.05
const STOP_TIME_CONSTANT = 0.03
const TRACK_RELEASE_SECONDS = 0.3
const SCHEDULER_INTERVAL = '40 millis'
export const SILENCE = 0.0001
const TAIL_SECONDS = 0.03

const LEVEL_GAIN: Readonly<Record<MusicLevel, number>> = {
  Full: MUSIC_VOLUME,
  Ducked: MUSIC_VOLUME * DUCKED_SHARE,
}

const freshTrack = (context: AudioContext, bus: GainNode): GainNode => {
  const track = context.createGain()
  track.connect(bus)
  return track
}

export const makeMusicDeck: {
  (
    destination: AudioNode,
    noise: AudioBuffer,
  ): (context: AudioContext) => MusicDeck
  (context: AudioContext, destination: AudioNode, noise: AudioBuffer): MusicDeck
} = Function.dual(
  3,
  (
    context: AudioContext,
    destination: AudioNode,
    noise: AudioBuffer,
  ): MusicDeck => {
    const bus = context.createGain()
    bus.gain.value = MUSIC_VOLUME
    bus.connect(destination)

    const lfo = context.createOscillator()
    lfo.frequency.value = LFO_HERTZ
    const vibrato = context.createGain()
    vibrato.gain.value = VIBRATO_CENTS
    const wobble = context.createGain()
    wobble.gain.value = WOBBLE_CENTS
    lfo.connect(vibrato)
    lfo.connect(wobble)
    lfo.start()

    return {
      context,
      bus,
      noise,
      vibrato,
      wobble,
      track: MutableRef.make(freshTrack(context, bus)),
      request: MutableRef.make<Request>({
        mood: 'Silence',
        maybeStinger: Option.none(),
      }),
      maybeMotion: MutableRef.make(Option.none<Motion>()),
    }
  },
)

// INSTRUMENTS

type Voice = Readonly<{
  sources: Array.NonEmptyReadonlyArray<AudioScheduledSourceNode>
  nodes: ReadonlyArray<AudioNode>
  output: AudioNode
  modulations: ReadonlyArray<readonly [AudioNode, AudioParam]>
  stopAt: number
}>

const A4_MIDI = 69
const A4_HERTZ = 440

const hertzOf = (midi: number): number =>
  A4_HERTZ * 2 ** ((midi - A4_MIDI) / SEMITONES_PER_OCTAVE)

const pluck = (
  gain: AudioParam,
  at: number,
  peak: number,
  decaySeconds: number,
): number => {
  gain.setValueAtTime(SILENCE, at)
  gain.exponentialRampToValueAtTime(peak, at + 0.004)
  gain.exponentialRampToValueAtTime(SILENCE, at + decaySeconds)
  return at + decaySeconds + TAIL_SECONDS
}

const hold = (
  gain: AudioParam,
  at: number,
  peak: number,
  seconds: number,
  releaseSeconds: number,
): number => {
  gain.setValueAtTime(SILENCE, at)
  gain.exponentialRampToValueAtTime(peak, at + 0.012)
  gain.linearRampToValueAtTime(peak * 0.7, at + seconds)
  gain.exponentialRampToValueAtTime(SILENCE, at + seconds + releaseSeconds)
  return at + seconds + releaseSeconds + TAIL_SECONDS
}

const oscillator = (
  deck: MusicDeck,
  wave: OscillatorType,
  hertz: number,
): OscillatorNode => {
  const node = deck.context.createOscillator()
  node.type = wave
  node.frequency.value = hertz
  return node
}

const noiseSource = (deck: MusicDeck): AudioBufferSourceNode => {
  const source = deck.context.createBufferSource()
  source.buffer = deck.noise
  source.loop = true
  return source
}

const filter = (
  deck: MusicDeck,
  type: BiquadFilterType,
  hertz: number,
  quality: number,
): BiquadFilterNode => {
  const node = deck.context.createBiquadFilter()
  node.type = type
  node.frequency.value = hertz
  node.Q.value = quality
  return node
}

const bass = (
  deck: MusicDeck,
  at: number,
  seconds: number,
  midi: number,
): Voice => {
  const source = oscillator(deck, 'square', hertzOf(midi))
  const lowpass = filter(deck, 'lowpass', 1800, 5)
  const gain = deck.context.createGain()
  lowpass.frequency.setValueAtTime(1800, at)
  lowpass.frequency.exponentialRampToValueAtTime(420, at + 0.14)
  source.connect(lowpass).connect(gain)
  return {
    sources: [source],
    nodes: [source, lowpass, gain],
    output: gain,
    modulations: [],
    stopAt: pluck(gain.gain, at, 0.42, Math.min(seconds * 0.9 + 0.05, 0.42)),
  }
}

const organ = (
  deck: MusicDeck,
  at: number,
  seconds: number,
  midi: number,
): Voice => {
  const reed = oscillator(deck, 'square', hertzOf(midi))
  const flute = oscillator(deck, 'sine', hertzOf(midi) * 2)
  const gain = deck.context.createGain()
  reed.connect(gain)
  flute.connect(gain)
  deck.vibrato.connect(reed.detune)
  deck.vibrato.connect(flute.detune)
  return {
    sources: [reed, flute],
    nodes: [reed, flute, gain],
    output: gain,
    modulations: [
      [deck.vibrato, reed.detune],
      [deck.vibrato, flute.detune],
    ],
    stopAt: hold(gain.gain, at, 0.11, seconds * 0.85, 0.06),
  }
}

const stab = (
  deck: MusicDeck,
  at: number,
  _seconds: number,
  midi: number,
): Voice => {
  const source = oscillator(deck, 'square', hertzOf(midi))
  const gain = deck.context.createGain()
  source.connect(gain)
  return {
    sources: [source],
    nodes: [source, gain],
    output: gain,
    modulations: [],
    stopAt: pluck(gain.gain, at, 0.06, 0.09),
  }
}

const spook = (
  deck: MusicDeck,
  at: number,
  seconds: number,
  midi: number,
): Voice => {
  const hertz = hertzOf(midi)
  const source = oscillator(deck, 'sine', hertz)
  const gain = deck.context.createGain()
  source.frequency.setValueAtTime(hertz * 0.92, at)
  source.frequency.exponentialRampToValueAtTime(hertz, at + 0.15)
  source.connect(gain)
  deck.wobble.connect(source.detune)
  return {
    sources: [source],
    nodes: [source, gain],
    output: gain,
    modulations: [[deck.wobble, source.detune]],
    stopAt: hold(gain.gain, at, 0.3, seconds * 0.9, 0.25),
  }
}

const kick = (deck: MusicDeck, at: number): Voice => {
  const source = oscillator(deck, 'sine', 160)
  const gain = deck.context.createGain()
  source.frequency.setValueAtTime(160, at)
  source.frequency.exponentialRampToValueAtTime(42, at + 0.12)
  source.connect(gain)
  return {
    sources: [source],
    nodes: [source, gain],
    output: gain,
    modulations: [],
    stopAt: pluck(gain.gain, at, 0.75, 0.16),
  }
}

const noiseHit =
  (type: BiquadFilterType, hertz: number, peak: number, decaySeconds: number) =>
  (deck: MusicDeck, at: number): Voice => {
    const source = noiseSource(deck)
    const shape = filter(deck, type, hertz, 0.9)
    const gain = deck.context.createGain()
    source.connect(shape).connect(gain)
    return {
      sources: [source],
      nodes: [source, shape, gain],
      output: gain,
      modulations: [],
      stopAt: pluck(gain.gain, at, peak, decaySeconds),
    }
  }

const snare = noiseHit('bandpass', 1900, 0.32, 0.11)
const hat = noiseHit('highpass', 7500, 0.1, 0.035)

const INSTRUMENTS: Readonly<
  Record<
    Instrument,
    (deck: MusicDeck, at: number, seconds: number, midi: number) => Voice
  >
> = {
  Bass: bass,
  Organ: organ,
  Stab: stab,
  Spook: spook,
  Kick: kick,
  Snare: snare,
  Hat: hat,
}

const startVoice = (deck: MusicDeck, voice: Voice, at: number): void => {
  const [first] = voice.sources
  voice.output.connect(MutableRef.get(deck.track))
  first.onended = () => {
    Array.forEach(voice.modulations, ([modulator, param]) =>
      modulator.disconnect(param),
    )
    Array.forEach(voice.nodes, node => node.disconnect())
    first.onended = null
  }
  Array.forEach(voice.sources, source => {
    source.start(at)
    source.stop(voice.stopAt)
  })
}

// SCHEDULER

type Position = readonly [Option.Option<Motion>, Request]

const tuneOf = (motion: Motion): Tune =>
  Motion.match(motion, {
    Looping: ({ mood }) => LOOPS[mood],
    Stinging: ({ stinger }) => STINGERS[stinger],
  })

const fromRequest = (request: Request, stepAt: number): Position =>
  Option.match(request.maybeStinger, {
    onSome: (stinger): Position => [
      Option.some(Motion.Stinging({ stinger, step: 0, stepAt })),
      { mood: request.mood, maybeStinger: Option.none() },
    ],
    onNone: (): Position => [
      request.mood === 'Silence'
        ? Option.none()
        : Option.some(Motion.Looping({ mood: request.mood, step: 0, stepAt })),
      request,
    ],
  })

const turn = (motion: Motion, request: Request): Position =>
  Motion.match(motion, {
    Looping: ({ mood, step, stepAt }): Position => {
      if (Option.isSome(request.maybeStinger) && step % STEPS_PER_BEAT === 0) {
        return fromRequest(request, stepAt)
      } else if (request.mood !== mood && step % STEPS_PER_BAR === 0) {
        return fromRequest(request, stepAt)
      } else {
        return [Option.some(motion), request]
      }
    },
    Stinging: ({ stinger, step, stepAt }): Position =>
      step >= STINGERS[stinger].length
        ? fromRequest(request, stepAt)
        : [Option.some(motion), request],
  })

const stepForward = (motion: Motion, count: number): Motion => {
  const { stepSeconds, length } = tuneOf(motion)
  return Motion.match(motion, {
    Looping: ({ mood, step, stepAt }) =>
      Motion.Looping({
        mood,
        step: (step + count) % length,
        stepAt: stepAt + count * stepSeconds,
      }),
    Stinging: ({ stinger, step, stepAt }) =>
      Motion.Stinging({
        stinger,
        step: step + count,
        stepAt: stepAt + count * stepSeconds,
      }),
  })
}

const catchUp = (motion: Motion, now: number): Motion => {
  const { stepSeconds } = tuneOf(motion)
  const behind = Math.floor((now - motion.stepAt) / stepSeconds)
  return behind > 1 ? stepForward(motion, behind) : motion
}

const playStep = (deck: MusicDeck, motion: Motion, now: number): void => {
  const { stepSeconds, swing, steps } = tuneOf(motion)
  const at = motion.stepAt + (motion.step % 2 === 1 ? swing * stepSeconds : 0)
  if (at < now) {
    return
  }

  Array.forEach(
    Option.getOrElse(Array.get(steps, motion.step), () => []),
    note => {
      const voice = INSTRUMENTS[note.instrument](
        deck,
        at,
        note.steps * stepSeconds,
        note.midi,
      )
      startVoice(deck, voice, at)
    },
  )
}

const advance = (
  deck: MusicDeck,
  motion: Motion,
  request: Request,
  now: number,
  horizon: number,
): Position => {
  const [maybeTurned, nextRequest] = turn(catchUp(motion, now), request)
  return Option.match(maybeTurned, {
    onNone: (): Position => [maybeTurned, nextRequest],
    onSome: (turned): Position => {
      if (turned.stepAt >= horizon) {
        return [maybeTurned, nextRequest]
      }

      playStep(deck, turned, now)
      return advance(deck, stepForward(turned, 1), nextRequest, now, horizon)
    },
  })
}

const hasSomethingToPlay = (request: Request): boolean =>
  request.mood !== 'Silence' || Option.isSome(request.maybeStinger)

const startingPosition = (
  maybeMotion: Option.Option<Motion>,
  request: Request,
  now: number,
): Position => {
  if (Option.isSome(maybeMotion) || !hasSomethingToPlay(request)) {
    return [maybeMotion, request]
  } else {
    return fromRequest(request, now + START_DELAY_SECONDS)
  }
}

const scheduleAhead = (deck: MusicDeck): void => {
  if (deck.context.state !== 'running') {
    return
  }

  const now = deck.context.currentTime
  const [maybeStarted, request] = startingPosition(
    MutableRef.get(deck.maybeMotion),
    MutableRef.get(deck.request),
    now,
  )
  const [maybeNextMotion, nextRequest] = Option.match(maybeStarted, {
    onNone: (): Position => [maybeStarted, request],
    onSome: started =>
      advance(deck, started, request, now, now + LOOKAHEAD_SECONDS),
  })
  MutableRef.set(deck.maybeMotion, maybeNextMotion)
  MutableRef.set(deck.request, nextRequest)
}

export const runMusicScheduler = (deck: MusicDeck): Effect.Effect<void> =>
  pipe(
    Effect.try({ try: () => scheduleAhead(deck), catch: toBrowserError }),
    Effect.ignore,
    Effect.repeat(Schedule.spaced(SCHEDULER_INTERVAL)),
    Effect.asVoid,
  )

// CUEING

const releaseTrack = (deck: MusicDeck, track: GainNode, now: number): void => {
  const timer = deck.context.createConstantSource()
  timer.offset.value = 0
  timer.connect(track)
  timer.onended = () => {
    timer.disconnect()
    track.disconnect()
    timer.onended = null
  }
  timer.start(now)
  timer.stop(now + TRACK_RELEASE_SECONDS)
}

const stopNow = (deck: MusicDeck): void => {
  const now = deck.context.currentTime
  const track = MutableRef.get(deck.track)
  track.gain.setTargetAtTime(0, now, STOP_TIME_CONSTANT)
  releaseTrack(deck, track, now)
  MutableRef.set(deck.track, freshTrack(deck.context, deck.bus))
  MutableRef.set(deck.maybeMotion, Option.none())
}

const nextStinger = (
  request: Request,
  cue: MusicCue,
  isHardStop: boolean,
): Option.Option<Fanfare> => {
  if (cue.stinger !== 'None') {
    return Option.some(cue.stinger)
  } else if (isHardStop) {
    return Option.none()
  } else {
    return request.maybeStinger
  }
}

export const cueMusic: {
  (cue: MusicCue): (deck: MusicDeck) => void
  (deck: MusicDeck, cue: MusicCue): void
} = Function.dual(2, (deck: MusicDeck, cue: MusicCue): void => {
  deck.bus.gain.setTargetAtTime(
    LEVEL_GAIN[cue.level],
    deck.context.currentTime,
    LEVEL_TIME_CONSTANT,
  )
  const isHardStop = cue.mood === 'Silence' && cue.stinger === 'None'
  MutableRef.update(deck.request, (request): Request => ({
    mood: cue.mood,
    maybeStinger: nextStinger(request, cue, isHardStop),
  }))
  if (isHardStop && Option.isSome(MutableRef.get(deck.maybeMotion))) {
    stopNow(deck)
  }
})
