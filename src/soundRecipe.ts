// NOTE: how a sound is written: tone and noise layers, each with its pitch
// points and envelope. src/audioRecipes.ts and src/zombieRecipes.ts write
// the game's sounds in it, and src/audio.ts plays them.

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

export const envelope = (
  peak: number,
  attackSeconds: number,
  decaySeconds: number,
  delaySeconds = 0,
): Envelope => ({ delaySeconds, peak, attackSeconds, decaySeconds })

export const at = (atSeconds: number, frequency: number): PitchPoint => ({
  atSeconds,
  frequency,
})
