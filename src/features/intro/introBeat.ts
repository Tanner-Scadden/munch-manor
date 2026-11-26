import { Array, Function, Option } from 'effect'

import type { Model } from '../../app/model'
import type { SoundEffect } from '../../shared/soundEffect'
import { ARRIVAL_MS, slamAtMs } from '../../world/run/arrival'
import { type IntroCut, Phase } from '../../world/schema/worldSchema'

export type IntroBeat =
  | 'Drive'
  | 'Driveway'
  | 'Steps'
  | 'Knock'
  | 'Coats'
  | 'Hello'
  | 'Slam'

type BeatSpan = Readonly<{ beat: IntroBeat; startMs: number }>

const BEATS: Readonly<Record<IntroCut, Array.NonEmptyReadonlyArray<BeatSpan>>> =
  {
    Full: [
      { beat: 'Drive', startMs: 0 },
      { beat: 'Driveway', startMs: 2_800 },
      { beat: 'Steps', startMs: 5_200 },
      { beat: 'Knock', startMs: 7_400 },
      { beat: 'Coats', startMs: 10_000 },
      { beat: 'Hello', startMs: 12_000 },
      { beat: 'Slam', startMs: slamAtMs('Full') },
    ],
    Short: [
      { beat: 'Knock', startMs: 0 },
      { beat: 'Slam', startMs: slamAtMs('Short') },
    ],
  }

export const KNOCKS_MS: ReadonlyArray<number> = [250, 560]
export const KNOCK_BACK_MS = 1_700

const KNOCK_WAIT_MS = 2_300

const beatStartOf = (cut: IntroCut, beat: IntroBeat): number =>
  Option.match(
    Array.findFirst(BEATS[cut], span => span.beat === beat),
    { onNone: () => 0, onSome: ({ startMs }) => startMs },
  )

export type IntroFrame = Readonly<{
  cut: IntroCut
  beat: IntroBeat
  beatMs: number
  progress: number
  ms: number
}>

export const introFrameAt: {
  (ms: number): (cut: IntroCut) => IntroFrame
  (cut: IntroCut, ms: number): IntroFrame
} = Function.dual(2, (cut: IntroCut, ms: number): IntroFrame => {
  const spans = BEATS[cut]
  const index = Option.getOrElse(
    Array.findLastIndex(spans, span => span.startMs <= ms),
    () => 0,
  )
  const span = spans[index] ?? Array.headNonEmpty(spans)
  const endMs = Option.match(Array.get(spans, index + 1), {
    onNone: () => ARRIVAL_MS[cut],
    onSome: next => next.startMs,
  })
  const beatMs = Math.max(0, ms - span.startMs)
  return {
    cut,
    beat: span.beat,
    beatMs,
    progress: Math.min(1, beatMs / Math.max(1, endMs - span.startMs)),
    ms,
  }
})

type ArrivalClock = Readonly<{ cut: IntroCut; elapsedMs: number }>

const maybeArrivalOf = (phase: Phase): Option.Option<ArrivalClock> =>
  Phase.matchOrElse(
    phase,
    {
      Arriving: ({ cut, elapsedMs }) => Option.some({ cut, elapsedMs }),
    },
    () => Option.none(),
  )

const drawnMsOf = (model: Model, { cut, elapsedMs }: ArrivalClock): number =>
  model.introSkip === 'Skipped' && elapsedMs < slamAtMs(cut)
    ? beatStartOf(cut, 'Knock') + KNOCK_WAIT_MS
    : elapsedMs

export const maybeIntroFrameOf = (model: Model): Option.Option<IntroFrame> =>
  Option.map(maybeArrivalOf(model.phase), clock =>
    introFrameAt(clock.cut, drawnMsOf(model, clock)),
  )

export const isSkippable = (model: Model): boolean =>
  Option.exists(
    maybeArrivalOf(model.phase),
    ({ cut, elapsedMs }) =>
      model.introSkip === 'Watching' && elapsedMs < slamAtMs(cut),
  )

type Cue = Readonly<{ atMs: number; sound: SoundEffect }>

const knockCues = (cut: IntroCut): ReadonlyArray<Cue> => {
  const knockMs = beatStartOf(cut, 'Knock')
  return [
    ...Array.map(KNOCKS_MS, atMs => ({
      atMs: knockMs + atMs,
      sound: 'Knock' as const,
    })),
    { atMs: knockMs + KNOCK_BACK_MS, sound: 'KnockBack' },
  ]
}

const CUES: Readonly<Record<IntroCut, ReadonlyArray<Cue>>> = {
  Full: [
    { atMs: 0, sound: 'CarEngine' },
    { atMs: 500, sound: 'RadioStatic' },
    { atMs: 1_700, sound: 'RadioStatic' },
    { atMs: beatStartOf('Full', 'Driveway'), sound: 'CarEngine' },
    { atMs: beatStartOf('Full', 'Steps') + 300, sound: 'DoorCreak' },
    ...knockCues('Full'),
    { atMs: beatStartOf('Full', 'Coats'), sound: 'DoorCreak' },
    { atMs: slamAtMs('Full'), sound: 'DoorSlam' },
  ],
  Short: [
    ...knockCues('Short'),
    { atMs: slamAtMs('Short'), sound: 'DoorSlam' },
  ],
}

const clockEndOf = (phase: Phase, cut: IntroCut): number =>
  Option.match(maybeArrivalOf(phase), {
    onNone: () => ARRIVAL_MS[cut],
    onSome: ({ elapsedMs }) => elapsedMs,
  })

export const introSounds: {
  (after: Model): (before: Model) => ReadonlyArray<SoundEffect>
  (before: Model, after: Model): ReadonlyArray<SoundEffect>
} = Function.dual(
  2,
  (before: Model, after: Model): ReadonlyArray<SoundEffect> =>
    Option.match(
      Option.orElse(maybeArrivalOf(before.phase), () =>
        maybeArrivalOf(after.phase),
      ),
      {
        onNone: () => [],
        onSome: ({ cut }) => {
          const fromMs = Option.match(maybeArrivalOf(before.phase), {
            onNone: () => 0,
            onSome: ({ elapsedMs }) => elapsedMs,
          })
          const toMs = clockEndOf(after.phase, cut)
          const isSkipped = after.introSkip === 'Skipped'
          return Array.map(
            Array.filter(
              CUES[cut],
              cue =>
                cue.atMs >= fromMs &&
                cue.atMs < toMs &&
                (!isSkipped || cue.sound === 'DoorSlam'),
            ),
            cue => cue.sound,
          )
        },
      },
    ),
)
