import type { SoundEffect } from '#shared/soundEffect.ts'

import { type Recipe, at, delayedEnvelope } from './soundRecipe.ts'

export const WEATHER_RECIPES = {
  Thunder: {
    variationCents: 200,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0.4, 52), at(2.4, 34)],
        envelope: delayedEnvelope(0.14, 0.35, 1.7, 0.4),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.5,
        cutoff: [at(0.4, 420), at(1.2, 220), at(2.6, 90)],
        envelope: delayedEnvelope(0.22, 0.5, 2, 0.4),
      },
      {
        filter: 'bandpass',
        quality: 0.9,
        cutoff: [at(0.45, 1200), at(0.9, 600)],
        envelope: delayedEnvelope(0.05, 0.08, 0.5, 0.45),
      },
    ],
  },
  Drip: {
    variationCents: 300,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 900), at(0.05, 1700)],
        envelope: delayedEnvelope(0.05, 0.002, 0.06, 0),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.06, 1400)],
        envelope: delayedEnvelope(0.015, 0.001, 0.04, 0),
      },
    ],
  },
  Wade: {
    variationCents: 250,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 320), at(0.08, 520)],
        envelope: delayedEnvelope(0.035, 0.004, 0.08, 0),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 1.4,
        cutoff: [at(0, 900), at(0.1, 1900)],
        envelope: delayedEnvelope(0.09, 0.006, 0.11, 0),
      },
    ],
  },
} satisfies Partial<Record<SoundEffect, Recipe>>
