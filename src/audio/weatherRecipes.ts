import type { SoundEffect } from '../shared/soundEffect'
import { type Recipe, at, delayedEnvelope } from './soundRecipe'

// NOTE: the storm outside the manor (src/render/iso/mood.ts), joined into
// RECIPES: far off and soft, so it sets a mood under the fight without
// covering it.
export const WEATHER_RECIPES = {
  // NOTE: thunder after a strike: a beat of quiet, then a low roll that
  // swells and dies away, with a faint crackle on top.
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
} satisfies Partial<Record<SoundEffect, Recipe>>
