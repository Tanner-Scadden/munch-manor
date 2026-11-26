import { Function } from 'effect'

export type PitchPoint = Readonly<{ atSeconds: number; frequency: number }>

export type Envelope = Readonly<{
  delaySeconds: number
  peak: number
  attackSeconds: number
  decaySeconds: number
}>

export type ToneLayer = Readonly<{
  wave: OscillatorType
  pitch: ReadonlyArray<PitchPoint>
  envelope: Envelope
}>

export type NoiseLayer = Readonly<{
  filter: BiquadFilterType
  quality: number
  cutoff: ReadonlyArray<PitchPoint>
  envelope: Envelope
}>

export type Recipe = Readonly<{
  variationCents: number
  tones: ReadonlyArray<ToneLayer>
  noises: ReadonlyArray<NoiseLayer>
}>

export const envelope: {
  (attackSeconds: number, decaySeconds: number): (peak: number) => Envelope
  (peak: number, attackSeconds: number, decaySeconds: number): Envelope
} = Function.dual(
  3,
  (peak: number, attackSeconds: number, decaySeconds: number): Envelope => ({
    delaySeconds: 0,
    peak,
    attackSeconds,
    decaySeconds,
  }),
)

export const delayedEnvelope: {
  (
    attackSeconds: number,
    decaySeconds: number,
    delaySeconds: number,
  ): (peak: number) => Envelope
  (
    peak: number,
    attackSeconds: number,
    decaySeconds: number,
    delaySeconds: number,
  ): Envelope
} = Function.dual(
  4,
  (
    peak: number,
    attackSeconds: number,
    decaySeconds: number,
    delaySeconds: number,
  ): Envelope => ({ delaySeconds, peak, attackSeconds, decaySeconds }),
)

export const at: {
  (frequency: number): (atSeconds: number) => PitchPoint
  (atSeconds: number, frequency: number): PitchPoint
} = Function.dual(2, (atSeconds: number, frequency: number): PitchPoint => ({
  atSeconds,
  frequency,
}))
