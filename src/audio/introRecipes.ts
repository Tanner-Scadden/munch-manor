import type { SoundEffect } from '../shared/soundEffect'
import {
  type NoiseLayer,
  type Recipe,
  at,
  delayedEnvelope,
  envelope,
} from './soundRecipe'

// NOTE: one rap of knuckles on old wood: a dull knock and a short click.
const KNOCK_RECIPE: Recipe = {
  variationCents: 60,
  tones: [
    {
      wave: 'sine',
      pitch: [at(0, 190), at(0.07, 90)],
      envelope: envelope(0.7, 0.001, 0.09),
    },
  ],
  noises: [
    {
      filter: 'bandpass',
      quality: 3,
      cutoff: [at(0, 1300), at(0.05, 600)],
      envelope: envelope(0.5, 0.001, 0.05),
    },
  ],
}

// NOTE: the radio between stations: hiss that swells and breaks off.
const STATIC_HISS: NoiseLayer = {
  filter: 'bandpass',
  quality: 0.7,
  cutoff: [at(0, 3200), at(0.2, 5200), at(0.45, 2400), at(0.7, 4200)],
  envelope: envelope(0.22, 0.06, 0.7),
}

// NOTE: the intro's sounds (src/features/intro/introBeat.ts), joined into
// RECIPES: the car, its radio, the knocks, the door, and the slam.
export const INTRO_RECIPES = {
  CarEngine: {
    variationCents: 0,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 46), at(0.5, 58), at(1.2, 52), at(1.8, 44)],
        envelope: envelope(0.16, 0.25, 1.6),
      },
      {
        wave: 'square',
        pitch: [at(0, 23), at(0.5, 29), at(1.8, 22)],
        envelope: envelope(0.08, 0.25, 1.6),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 300), at(0.6, 480), at(1.8, 220)],
        envelope: envelope(0.18, 0.3, 1.5),
      },
    ],
  },
  RadioStatic: {
    variationCents: 120,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 523), at(0.12, 494), at(0.22, 587)],
        envelope: envelope(0.04, 0.02, 0.28),
      },
    ],
    noises: [
      STATIC_HISS,
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 6000)],
        envelope: delayedEnvelope(0.12, 0.02, 0.2, 0.3),
      },
    ],
  },
  Knock: KNOCK_RECIPE,
  // NOTE: the one knock back, from somewhere deeper inside: lower, softer,
  // and muffled.
  KnockBack: {
    variationCents: 0,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 120), at(0.12, 52)],
        envelope: envelope(0.85, 0.002, 0.18),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 2,
        cutoff: [at(0, 700), at(0.12, 160)],
        envelope: envelope(0.5, 0.002, 0.14),
      },
    ],
  },
  DoorCreak: {
    variationCents: 80,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 310), at(0.3, 420), at(0.55, 360), at(0.9, 470)],
        envelope: envelope(0.07, 0.12, 0.85),
      },
      {
        wave: 'square',
        pitch: [at(0, 620), at(0.3, 840), at(0.9, 930)],
        envelope: delayedEnvelope(0.025, 0.1, 0.6, 0.15),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 9,
        cutoff: [at(0, 900), at(0.5, 1300), at(0.9, 1000)],
        envelope: envelope(0.12, 0.15, 0.8),
      },
    ],
  },
  DoorSlam: {
    variationCents: 0,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 130), at(0.3, 34)],
        envelope: envelope(1, 0.002, 0.5),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 260), at(0.08, 90)],
        envelope: envelope(0.35, 0.001, 0.12),
      },
      {
        wave: 'square',
        pitch: [at(0, 1800), at(0.05, 1500)],
        envelope: delayedEnvelope(0.08, 0.002, 0.08, 0.42),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.9,
        cutoff: [at(0, 3600), at(0.5, 180)],
        envelope: envelope(0.95, 0.001, 0.55),
      },
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 2400), at(0.06, 1800)],
        envelope: delayedEnvelope(0.3, 0.001, 0.06, 0.42),
      },
    ],
  },
} satisfies Partial<Record<SoundEffect, Recipe>>
