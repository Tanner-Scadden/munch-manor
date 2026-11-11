import { Array } from 'effect'

import type { SoundEffect } from '../shared/soundEffect'
import { type Recipe, at, delayedEnvelope, envelope } from './soundRecipe'

// NOTE: the room tools' own sounds (src/world/stations/), joined into
// RECIPES: the gramophone's waltz and the soup pot's splosh. The other
// tools reuse sounds the game has (src/features/stations/stationView.ts).
export const ROOM_TOOL_RECIPES = {
  // NOTE: the parlour's gramophone wound up (a room tool,
  // src/world/parlour/gramophone.ts): a scratchy oom-pah-pah in three, two
  // bars of a waltz through a tin horn, with the needle's hiss under it.
  Waltz: {
    variationCents: 0,
    tones: Array.flatMap(
      [
        [196, 392, 392],
        [147, 349, 349],
      ],
      (bar, barIndex) =>
        Array.map(bar, (frequency, beat) => ({
          wave: beat === 0 ? ('triangle' as const) : ('square' as const),
          pitch: [at(0, frequency), at(0.2, frequency * 0.99)],
          envelope: delayedEnvelope(
            beat === 0 ? 0.16 : 0.05,
            0.004,
            beat === 0 ? 0.3 : 0.16,
            (barIndex * 3 + beat) * 0.3,
          ),
        })),
    ),
    noises: [
      {
        filter: 'bandpass',
        quality: 0.7,
        cutoff: [at(0, 3800), at(1.8, 3000)],
        envelope: envelope(0.04, 0.05, 1.8),
      },
    ],
  },
  // NOTE: the kitchen's soup pot tipped (a room tool,
  // src/world/kitchen/soupPot.ts): a clang of the pot, then the soup's
  // wet slap and a gurgle as it spreads.
  Splosh: {
    variationCents: 120,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 620), at(0.12, 540)],
        envelope: envelope(0.12, 0.002, 0.14),
      },
      {
        wave: 'sine',
        pitch: [at(0, 260), at(0.25, 120)],
        envelope: delayedEnvelope(0.2, 0.01, 0.25, 0.08),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1.2,
        cutoff: [at(0, 1400), at(0.4, 300)],
        envelope: delayedEnvelope(0.5, 0.004, 0.4, 0.06),
      },
    ],
  },
} satisfies Partial<Record<SoundEffect, Recipe>>
