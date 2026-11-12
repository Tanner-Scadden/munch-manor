import type { SoundEffect } from '../shared/soundEffect'
import { type Recipe, at, envelope } from './soundRecipe'

// NOTE: the hands-on actions' own sounds (src/render/actionPose.ts), joined
// into RECIPES, each soft and short so a long revive or mend never nags.
export const ACTION_RECIPES = {
  // NOTE: one push of CPR on a downed teammate's chest: a low, soft thump.
  ChestPush: {
    variationCents: 60,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 150), at(0.09, 80)],
        envelope: envelope(0.12, 0.004, 0.1),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 700), at(0.06, 250)],
        envelope: envelope(0.05, 0.002, 0.05),
      },
    ],
  },
  // NOTE: a hammer coming down on a board: a woody knock with a little
  // ring of the nail.
  HammerTap: {
    variationCents: 140,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 420), at(0.06, 300)],
        envelope: envelope(0.1, 0.001, 0.06),
      },
      {
        wave: 'square',
        pitch: [at(0, 1650), at(0.05, 1600)],
        envelope: envelope(0.02, 0.001, 0.05),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 1.4,
        cutoff: [at(0, 2400), at(0.03, 1500)],
        envelope: envelope(0.06, 0.001, 0.03),
      },
    ],
  },
} satisfies Partial<Record<SoundEffect, Recipe>>
