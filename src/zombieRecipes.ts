import { Array } from 'effect'

import type { SoundEffect } from './soundEffect'
import { type PitchPoint, type Recipe, at, envelope } from './soundRecipe'

const ZOMBIE_HIT_RECIPE: Recipe = {
  variationCents: 160,
  tones: [
    {
      wave: 'sine',
      pitch: [at(0, 210), at(0.07, 70)],
      envelope: envelope(0.45, 0.003, 0.08),
    },
  ],
  noises: [
    {
      filter: 'lowpass',
      quality: 4,
      cutoff: [at(0, 1600), at(0.08, 260)],
      envelope: envelope(0.6, 0.002, 0.09),
    },
  ],
}

const ZOMBIE_DEATH_RECIPE: Recipe = {
  variationCents: 220,
  tones: [
    {
      wave: 'triangle',
      pitch: [at(0, 180), at(0.05, 720), at(0.24, 85)],
      envelope: envelope(0.5, 0.008, 0.26),
    },
  ],
  noises: [
    {
      filter: 'bandpass',
      quality: 7,
      cutoff: [at(0, 2800), at(0.2, 240)],
      envelope: envelope(0.55, 0.004, 0.2, 0.02),
    },
  ],
}

const CENTS_PER_OCTAVE = 1200

const shiftPoints = (
  points: ReadonlyArray<PitchPoint>,
  factor: number,
): ReadonlyArray<PitchPoint> =>
  Array.map(points, point => at(point.atSeconds, point.frequency * factor))

const pitched = (recipe: Recipe, cents: number): Recipe => {
  const factor = 2 ** (cents / CENTS_PER_OCTAVE)
  return {
    variationCents: recipe.variationCents,
    tones: Array.map(recipe.tones, tone => ({
      wave: tone.wave,
      pitch: shiftPoints(tone.pitch, factor),
      envelope: tone.envelope,
    })),
    noises: Array.map(recipe.noises, noise => ({
      filter: noise.filter,
      quality: noise.quality,
      cutoff: shiftPoints(noise.cutoff, factor),
      envelope: noise.envelope,
    })),
  }
}

// NOTE: the zombies' and the boss's sounds, joined into RECIPES.
export const ZOMBIE_RECIPES = {
  ZombieHit: ZOMBIE_HIT_RECIPE,
  ZombieDeath: ZOMBIE_DEATH_RECIPE,
  RunnerHit: pitched(ZOMBIE_HIT_RECIPE, 700),
  RunnerDeath: pitched(ZOMBIE_DEATH_RECIPE, 600),
  TankHit: {
    variationCents: 120,
    tones: [
      ...pitched(ZOMBIE_HIT_RECIPE, -1000).tones,
      {
        wave: 'sine',
        pitch: [at(0, 90), at(0.1, 40)],
        envelope: envelope(0.5, 0.002, 0.11),
      },
    ],
    noises: pitched(ZOMBIE_HIT_RECIPE, -900).noises,
  },
  TankDeath: {
    variationCents: 80,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 140), at(0.08, 190), at(0.5, 45)],
        envelope: envelope(0.32, 0.01, 0.52),
      },
      {
        wave: 'sine',
        pitch: [at(0, 70), at(0.3, 30)],
        envelope: envelope(0.7, 0.004, 0.34, 0.18),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.3, 120)],
        envelope: envelope(0.6, 0.004, 0.3, 0.18),
      },
    ],
  },
  ExploderHit: {
    variationCents: 140,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 760), at(0.12, 690)],
        envelope: envelope(0.32, 0.002, 0.14),
      },
      {
        wave: 'square',
        pitch: [at(0, 1130), at(0.08, 1040)],
        envelope: envelope(0.08, 0.002, 0.08),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 3200), at(0.04, 1800)],
        envelope: envelope(0.4, 0.001, 0.04),
      },
    ],
  },
  ExploderFuse: {
    variationCents: 120,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1800), at(0.3, 2600)],
        envelope: envelope(0.04, 0.01, 0.3),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 3800), at(0.3, 6800)],
        envelope: envelope(0.4, 0.008, 0.32),
      },
      {
        filter: 'bandpass',
        quality: 12,
        cutoff: [at(0, 5200), at(0.06, 2400), at(0.12, 5600), at(0.2, 2800)],
        envelope: envelope(0.25, 0.002, 0.26, 0.03),
      },
    ],
  },
  Boom: {
    variationCents: 90,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 130), at(0.6, 28)],
        envelope: envelope(1, 0.003, 0.65),
      },
      {
        wave: 'square',
        pitch: [at(0, 200), at(0.16, 42)],
        envelope: envelope(0.3, 0.002, 0.18),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 60), at(0.3, 30)],
        envelope: envelope(0.6, 0.004, 0.4, 0.02),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.7,
        cutoff: [at(0, 6000), at(0.75, 120)],
        envelope: envelope(1, 0.002, 0.8),
      },
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 1800), at(0.2, 500)],
        envelope: envelope(0.45, 0.01, 0.22, 0.04),
      },
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.5, 200)],
        envelope: envelope(0.4, 0.05, 0.5, 0.12),
      },
    ],
  },
  Stomp: {
    variationCents: 60,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 80), at(0.09, 38)],
        envelope: envelope(0.5, 0.003, 0.1),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 500), at(0.08, 120)],
        envelope: envelope(0.3, 0.002, 0.08),
      },
    ],
  },
  Groan: {
    variationCents: 260,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 92), at(0.18, 128), at(0.55, 70)],
        envelope: envelope(0.2, 0.06, 0.5),
      },
      {
        wave: 'square',
        pitch: [at(0, 138), at(0.2, 190), at(0.5, 104)],
        envelope: envelope(0.07, 0.08, 0.42),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 380), at(0.25, 620), at(0.55, 300)],
        envelope: envelope(0.28, 0.05, 0.5),
      },
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.1, 250)],
        envelope: envelope(0.3, 0.002, 0.12),
      },
    ],
  },
  LimbPop: {
    variationCents: 240,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 320), at(0.03, 900), at(0.09, 180)],
        envelope: envelope(0.4, 0.001, 0.09),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 2200), at(0.08, 500)],
        envelope: envelope(0.55, 0.001, 0.08),
      },
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 1200), at(0.12, 200)],
        envelope: envelope(0.35, 0.002, 0.12, 0.04),
      },
    ],
  },
  BossRoar: {
    variationCents: 0,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 70), at(0.25, 118), at(0.9, 52), at(1.3, 40)],
        envelope: envelope(0.42, 0.12, 1.2),
      },
      {
        wave: 'square',
        pitch: [at(0, 104), at(0.3, 176), at(0.9, 78)],
        envelope: envelope(0.12, 0.15, 1),
      },
      {
        wave: 'sine',
        pitch: [at(0, 46), at(1, 30)],
        envelope: envelope(0.7, 0.05, 1.2),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 4,
        cutoff: [at(0, 300), at(0.3, 700), at(1.1, 220)],
        envelope: envelope(0.5, 0.1, 1.1),
      },
    ],
  },
  BossWindUp: {
    variationCents: 60,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 60), at(0.6, 150)],
        envelope: envelope(0.26, 0.3, 0.4),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 120), at(0.6, 300)],
        envelope: envelope(0.12, 0.3, 0.35),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 400), at(0.6, 1100)],
        envelope: envelope(0.22, 0.3, 0.35),
      },
    ],
  },
  BossStomp: {
    variationCents: 40,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 110), at(0.5, 28)],
        envelope: envelope(1, 0.002, 0.55),
      },
      {
        wave: 'square',
        pitch: [at(0, 160), at(0.15, 40)],
        envelope: envelope(0.22, 0.002, 0.16),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 2600), at(0.5, 90)],
        envelope: envelope(0.9, 0.002, 0.5),
      },
    ],
  },
  BossBelch: {
    variationCents: 120,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 95), at(0.1, 70), at(0.25, 84), at(0.5, 55)],
        envelope: envelope(0.45, 0.02, 0.5),
      },
      {
        wave: 'square',
        pitch: [at(0, 48), at(0.5, 36)],
        envelope: envelope(0.2, 0.02, 0.45),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 500), at(0.2, 300), at(0.5, 160)],
        envelope: envelope(0.45, 0.02, 0.5),
      },
    ],
  },
  BossDeath: {
    variationCents: 0,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 150), at(0.15, 210), at(1.2, 36)],
        envelope: envelope(0.4, 0.01, 1.3),
      },
      {
        wave: 'sine',
        pitch: [at(0, 80), at(0.9, 24)],
        envelope: envelope(0.9, 0.004, 1, 0.2),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.7,
        cutoff: [at(0, 4200), at(1.2, 100)],
        envelope: envelope(0.9, 0.003, 1.2, 0.15),
      },
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 1600), at(0.4, 400)],
        envelope: envelope(0.5, 0.01, 0.4),
      },
    ],
  },
  BossChargeUp: {
    variationCents: 40,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 52), at(0.7, 112)],
        envelope: envelope(0.3, 0.25, 0.55),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.1, 160)],
        envelope: envelope(0.6, 0.004, 0.12),
      },
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.1, 160)],
        envelope: envelope(0.6, 0.004, 0.12, 0.27),
      },
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.1, 160)],
        envelope: envelope(0.6, 0.004, 0.12, 0.54),
      },
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 700), at(0.15, 1400)],
        envelope: envelope(0.28, 0.02, 0.18, 0.6),
      },
    ],
  },
  BossRush: {
    variationCents: 60,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 70), at(0.5, 44)],
        envelope: envelope(0.55, 0.02, 0.5),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 300), at(0.25, 1500), at(0.55, 500)],
        envelope: envelope(0.5, 0.06, 0.5),
      },
    ],
  },
  BossBonk: {
    variationCents: 30,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 260), at(0.12, 70)],
        envelope: envelope(1, 0.002, 0.3),
      },
      {
        wave: 'square',
        pitch: [at(0, 540), at(0.08, 300), at(0.16, 420), at(0.3, 260)],
        envelope: envelope(0.14, 0.004, 0.35, 0.03),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 3000), at(0.3, 120)],
        envelope: envelope(0.8, 0.002, 0.3),
      },
    ],
  },
  BossSpit: {
    variationCents: 120,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 420), at(0.1, 180)],
        envelope: envelope(0.35, 0.004, 0.12, 0.08),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 600), at(0.08, 1300)],
        envelope: envelope(0.3, 0.03, 0.08),
      },
      {
        filter: 'bandpass',
        quality: 4,
        cutoff: [at(0, 1800), at(0.12, 700)],
        envelope: envelope(0.45, 0.003, 0.12, 0.08),
      },
    ],
  },
  BossSplat: {
    variationCents: 140,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 170), at(0.18, 55)],
        envelope: envelope(0.6, 0.003, 0.2),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1.5,
        cutoff: [at(0, 2200), at(0.25, 220)],
        envelope: envelope(0.7, 0.002, 0.28),
      },
    ],
  },
  Heave: {
    variationCents: 120,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 110), at(0.25, 160), at(0.5, 120)],
        envelope: envelope(0.22, 0.08, 0.45),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 300), at(0.3, 700)],
        envelope: envelope(0.25, 0.06, 0.4),
      },
    ],
  },
  Rumble: {
    variationCents: 60,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 46), at(0.6, 58)],
        envelope: envelope(0.18, 0.2, 0.6),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 2,
        cutoff: [at(0, 260), at(0.5, 520), at(0.9, 200)],
        envelope: envelope(0.5, 0.25, 0.65),
      },
      {
        filter: 'highpass',
        quality: 3,
        cutoff: [at(0, 3800), at(0.5, 2600)],
        envelope: envelope(0.08, 0.3, 0.4, 0.2),
      },
    ],
  },
  Burrow: {
    variationCents: 110,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 90), at(0.06, 220), at(0.24, 70)],
        envelope: envelope(0.18, 0.004, 0.26),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 1.2,
        cutoff: [at(0, 3200), at(0.25, 400)],
        envelope: envelope(0.7, 0.002, 0.3),
      },
    ],
  },
  Clutch: {
    variationCents: 140,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 330), at(0.08, 520), at(0.2, 260)],
        envelope: envelope(0.25, 0.004, 0.2),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 1400), at(0.15, 600)],
        envelope: envelope(0.35, 0.003, 0.16),
      },
    ],
  },
  Yank: {
    variationCents: 120,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 180), at(0.06, 420), at(0.12, 240)],
        envelope: envelope(0.18, 0.003, 0.13),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 600), at(0.08, 2600)],
        envelope: envelope(0.45, 0.004, 0.1),
      },
    ],
  },
  Howl: {
    variationCents: 50,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 140), at(0.25, 330), at(0.7, 210)],
        envelope: envelope(0.18, 0.06, 0.7),
      },
      {
        wave: 'square',
        pitch: [at(0, 210), at(0.25, 495), at(0.7, 315)],
        envelope: envelope(0.07, 0.08, 0.65),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 500), at(0.3, 1100), at(0.7, 600)],
        envelope: envelope(0.25, 0.06, 0.65),
      },
    ],
  },
  PackBonus: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 784), at(0.06, 784)],
        envelope: envelope(0.12, 0.002, 0.07),
      },
      {
        wave: 'square',
        pitch: [at(0, 988), at(0.06, 988)],
        envelope: envelope(0.12, 0.002, 0.07, 0.07),
      },
      {
        wave: 'square',
        pitch: [at(0, 1175), at(0.06, 1175)],
        envelope: envelope(0.12, 0.002, 0.07, 0.14),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.25, 1568)],
        envelope: envelope(0.2, 0.002, 0.25, 0.21),
      },
    ],
    noises: [],
  },
} satisfies Partial<Record<SoundEffect, Recipe>>
