import { Array } from 'effect'

import { FRIDGE_SPIN_STEPS_MS, MS_PER_SECOND } from './constants'
import type { SoundEffect } from './soundEffect'
import { type Recipe, type ToneLayer, at, envelope } from './soundRecipe'
import { ZOMBIE_RECIPES } from './zombieRecipes'

const PICKUP_CHIRP: ReadonlyArray<ToneLayer> = [
  {
    wave: 'square',
    pitch: [at(0, 880), at(0.06, 1760)],
    envelope: envelope(0.12, 0.002, 0.07),
  },
  {
    wave: 'triangle',
    pitch: [at(0, 1760), at(0.08, 2637)],
    envelope: envelope(0.1, 0.002, 0.09, 0.03),
  },
]

const JINGLE_START_SECONDS = 0.08

// NOTE: one click for each face of the fridge's spin, on the faces' own
// beat, then a thunk where it lands.
const SPIN_CLICK_STARTS: ReadonlyArray<number> = Array.map(
  Array.makeBy(FRIDGE_SPIN_STEPS_MS.length, index =>
    Array.reduce(
      Array.take(FRIDGE_SPIN_STEPS_MS, index),
      0,
      (sum, stepMs) => sum + stepMs,
    ),
  ),
  startMs => startMs / MS_PER_SECOND,
)

const SPIN_LAND_SECONDS =
  Array.reduce(FRIDGE_SPIN_STEPS_MS, 0, (sum, stepMs) => sum + stepMs) /
  MS_PER_SECOND

export const RECIPES: Readonly<Record<SoundEffect, Recipe>> = {
  ...ZOMBIE_RECIPES,
  Shot: {
    variationCents: 70,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 620), at(0.07, 95)],
        envelope: envelope(0.22, 0.002, 0.08),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 0.9,
        cutoff: [at(0, 2600), at(0.05, 900)],
        envelope: envelope(0.5, 0.001, 0.05),
      },
    ],
  },
  ShotgunBlast: {
    variationCents: 60,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 260), at(0.16, 42)],
        envelope: envelope(0.3, 0.002, 0.18),
      },
      {
        wave: 'sine',
        pitch: [at(0, 120), at(0.2, 38)],
        envelope: envelope(0.55, 0.002, 0.22),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 3800), at(0.22, 260)],
        envelope: envelope(0.85, 0.001, 0.24),
      },
    ],
  },
  SmgShot: {
    variationCents: 90,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 980), at(0.035, 240)],
        envelope: envelope(0.16, 0.001, 0.04),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 0.7,
        cutoff: [at(0, 3400), at(0.03, 1600)],
        envelope: envelope(0.36, 0.001, 0.03),
      },
    ],
  },
  DryClick: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1900), at(0.012, 1100)],
        envelope: envelope(0.12, 0.001, 0.012),
      },
      {
        wave: 'square',
        pitch: [at(0, 1500), at(0.012, 900)],
        envelope: envelope(0.1, 0.001, 0.012, 0.06),
      },
    ],
    noises: [],
  },
  AmmoTick: {
    variationCents: 0,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 420), at(0.03, 300)],
        envelope: envelope(0.14, 0.001, 0.035),
      },
    ],
    noises: [],
  },
  MagOut: {
    variationCents: 60,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 620), at(0.05, 260)],
        envelope: envelope(0.12, 0.002, 0.06),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 180), at(0.08, 120)],
        envelope: envelope(0.2, 0.002, 0.08, 0.05),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.06, 1200)],
        envelope: envelope(0.22, 0.002, 0.06),
      },
    ],
  },
  MagIn: {
    variationCents: 60,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1300), at(0.015, 700)],
        envelope: envelope(0.14, 0.001, 0.02),
      },
      {
        wave: 'square',
        pitch: [at(0, 1700), at(0.015, 900)],
        envelope: envelope(0.16, 0.001, 0.025, 0.07),
      },
      {
        wave: 'sine',
        pitch: [at(0, 160), at(0.06, 90)],
        envelope: envelope(0.3, 0.001, 0.07, 0.07),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 0.8,
        cutoff: [at(0, 3600), at(0.02, 2200)],
        envelope: envelope(0.18, 0.001, 0.02, 0.07),
      },
    ],
  },
  Swap: {
    variationCents: 0,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 420), at(0.03, 380)],
        envelope: envelope(0.22, 0.002, 0.04),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 640), at(0.03, 700)],
        envelope: envelope(0.22, 0.002, 0.05, 0.06),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 4200), at(0.02, 2600)],
        envelope: envelope(0.2, 0.001, 0.02, 0.06),
      },
    ],
  },
  PlayerHurt: {
    variationCents: 50,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 190), at(0.05, 240), at(0.22, 60)],
        envelope: envelope(0.7, 0.006, 0.24),
      },
      {
        wave: 'sine',
        pitch: [at(0, 90), at(0.14, 42)],
        envelope: envelope(0.6, 0.003, 0.16),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 700), at(0.06, 200)],
        envelope: envelope(0.4, 0.002, 0.06),
      },
    ],
  },
  Start: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 330), at(0.06, 330)],
        envelope: envelope(0.14, 0.004, 0.08),
      },
      {
        wave: 'square',
        pitch: [at(0, 440), at(0.06, 440)],
        envelope: envelope(0.14, 0.004, 0.08, 0.09),
      },
      {
        wave: 'square',
        pitch: [at(0, 660), at(0.05, 880)],
        envelope: envelope(0.16, 0.004, 0.18, 0.18),
      },
    ],
    noises: [],
  },
  ShopBell: {
    variationCents: 0,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 1046), at(0.4, 1040)],
        envelope: envelope(0.22, 0.003, 0.42),
      },
      {
        wave: 'sine',
        pitch: [at(0, 1568), at(0.4, 1560)],
        envelope: envelope(0.16, 0.003, 0.46, 0.1),
      },
    ],
    noises: [],
  },
  Purchase: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1318), at(0.05, 1318)],
        envelope: envelope(0.12, 0.002, 0.06, 0.07),
      },
      {
        wave: 'square',
        pitch: [at(0, 1760), at(0.2, 1760)],
        envelope: envelope(0.14, 0.002, 0.26, 0.13),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.06, 1400)],
        envelope: envelope(0.5, 0.001, 0.06),
      },
      {
        filter: 'highpass',
        quality: 3,
        cutoff: [at(0, 7000), at(0.24, 5200)],
        envelope: envelope(0.18, 0.002, 0.24, 0.13),
      },
    ],
  },
  PowerUp: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 523), at(0.18, 523)],
        envelope: envelope(0.1, 0.002, 0.06, 0.12),
      },
      {
        wave: 'square',
        pitch: [at(0, 659), at(0.24, 659)],
        envelope: envelope(0.1, 0.002, 0.06, 0.18),
      },
      {
        wave: 'square',
        pitch: [at(0, 784), at(0.3, 784)],
        envelope: envelope(0.1, 0.002, 0.06, 0.24),
      },
      {
        wave: 'triangle',
        pitch: [at(0.3, 1046), at(0.6, 1568)],
        envelope: envelope(0.14, 0.004, 0.3, 0.3),
      },
    ],
    noises: [],
  },
  Denied: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 180), at(0.16, 140)],
        envelope: envelope(0.16, 0.004, 0.16),
      },
    ],
    noises: [],
  },
  Payday: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 988), at(0.05, 988)],
        envelope: envelope(0.12, 0.002, 0.06),
      },
      {
        wave: 'square',
        pitch: [at(0, 1318), at(0.05, 1318)],
        envelope: envelope(0.12, 0.002, 0.06, 0.07),
      },
      {
        wave: 'square',
        pitch: [at(0, 1976), at(0.2, 1976)],
        envelope: envelope(0.13, 0.002, 0.24, 0.14),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 3,
        cutoff: [at(0, 6800), at(0.3, 5000)],
        envelope: envelope(0.16, 0.002, 0.3, 0.14),
      },
    ],
  },
  TurretShot: {
    variationCents: 140,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 900), at(0.05, 420)],
        envelope: envelope(0.1, 0.001, 0.05),
      },
      {
        wave: 'sine',
        pitch: [at(0, 520), at(0.04, 260)],
        envelope: envelope(0.22, 0.001, 0.05),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 3000), at(0.04, 1500)],
        envelope: envelope(0.18, 0.001, 0.03),
      },
    ],
  },
  Thunk: {
    variationCents: 40,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 170), at(0.12, 55)],
        envelope: envelope(0.7, 0.002, 0.14),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 320), at(0.05, 140)],
        envelope: envelope(0.25, 0.001, 0.06),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1.5,
        cutoff: [at(0, 1400), at(0.1, 200)],
        envelope: envelope(0.5, 0.001, 0.1),
      },
    ],
  },
  Crack: {
    variationCents: 160,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 240), at(0.06, 110)],
        envelope: envelope(0.16, 0.001, 0.07),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1.2,
        cutoff: [at(0, 2600), at(0.08, 900)],
        envelope: envelope(0.7, 0.001, 0.08),
      },
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 700), at(0.1, 300)],
        envelope: envelope(0.4, 0.002, 0.1, 0.03),
      },
    ],
  },
  Crash: {
    variationCents: 90,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 180), at(0.3, 50)],
        envelope: envelope(0.25, 0.003, 0.32),
      },
      {
        wave: 'sine',
        pitch: [at(0, 110), at(0.25, 40)],
        envelope: envelope(0.6, 0.002, 0.28),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 4200), at(0.4, 300)],
        envelope: envelope(0.9, 0.002, 0.42),
      },
      {
        filter: 'bandpass',
        quality: 4,
        cutoff: [at(0, 1200), at(0.15, 500)],
        envelope: envelope(0.5, 0.004, 0.16, 0.08),
      },
    ],
  },
  DinnerBell: {
    variationCents: 0,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.12, 1560)],
        envelope: envelope(0.24, 0.002, 0.14),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.12, 1560)],
        envelope: envelope(0.24, 0.002, 0.14, 0.16),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.3, 1550)],
        envelope: envelope(0.26, 0.002, 0.34, 0.32),
      },
      {
        wave: 'sawtooth',
        pitch: [at(0, 82), at(0.3, 118), at(0.8, 64)],
        envelope: envelope(0.16, 0.1, 0.7, 0.3),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 340), at(0.4, 560), at(0.9, 260)],
        envelope: envelope(0.22, 0.1, 0.7, 0.3),
      },
    ],
  },
  LootPop: {
    variationCents: 90,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 300), at(0.05, 900), at(0.12, 700)],
        envelope: envelope(0.2, 0.003, 0.12),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 2093), at(0.1, 2637)],
        envelope: envelope(0.07, 0.002, 0.12, 0.05),
      },
    ],
    noises: [],
  },
  GrabHotSauce: {
    variationCents: 0,
    tones: [
      ...PICKUP_CHIRP,
      {
        wave: 'square',
        pitch: [at(0, 659), at(0.05, 659)],
        envelope: envelope(0.1, 0.002, 0.05, JINGLE_START_SECONDS),
      },
      {
        wave: 'square',
        pitch: [at(0, 988), at(0.05, 988)],
        envelope: envelope(0.1, 0.002, 0.05, JINGLE_START_SECONDS + 0.06),
      },
      {
        wave: 'square',
        pitch: [at(0, 1319), at(0.2, 1397)],
        envelope: envelope(0.12, 0.002, 0.22, JINGLE_START_SECONDS + 0.12),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 4200), at(0.4, 6800)],
        envelope: envelope(0.16, 0.02, 0.4, JINGLE_START_SECONDS),
      },
    ],
  },
  GrabMeanBeans: {
    variationCents: 0,
    tones: [
      ...PICKUP_CHIRP,
      {
        wave: 'sawtooth',
        pitch: [at(0, 98), at(0.18, 196)],
        envelope: envelope(0.2, 0.01, 0.22, JINGLE_START_SECONDS),
      },
      {
        wave: 'square',
        pitch: [at(0, 196), at(0.12, 392)],
        envelope: envelope(0.1, 0.004, 0.14, JINGLE_START_SECONDS + 0.12),
      },
      {
        wave: 'square',
        pitch: [at(0, 392), at(0.2, 392)],
        envelope: envelope(0.1, 0.004, 0.2, JINGLE_START_SECONDS + 0.24),
      },
    ],
    noises: [],
  },
  GrabZoomySocks: {
    variationCents: 0,
    tones: [
      ...PICKUP_CHIRP,
      {
        wave: 'sine',
        pitch: [at(0, 392), at(0.3, 1568)],
        envelope: envelope(0.18, 0.01, 0.32, JINGLE_START_SECONDS),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 600), at(0.32, 4200)],
        envelope: envelope(0.3, 0.04, 0.3, JINGLE_START_SECONDS),
      },
    ],
  },
  GrabKebullets: {
    variationCents: 0,
    tones: [
      ...PICKUP_CHIRP,
      {
        wave: 'triangle',
        pitch: [at(0, 1976), at(0.16, 1960)],
        envelope: envelope(0.14, 0.002, 0.16, JINGLE_START_SECONDS),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 2637), at(0.24, 2620)],
        envelope: envelope(0.14, 0.002, 0.26, JINGLE_START_SECONDS + 0.1),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 8,
        cutoff: [at(0, 5200), at(0.12, 7600)],
        envelope: envelope(0.24, 0.002, 0.12, JINGLE_START_SECONDS),
      },
      {
        filter: 'bandpass',
        quality: 8,
        cutoff: [at(0, 6000), at(0.14, 8400)],
        envelope: envelope(0.22, 0.002, 0.14, JINGLE_START_SECONDS + 0.1),
      },
    ],
  },
  GrabBurp: {
    variationCents: 0,
    tones: [
      ...PICKUP_CHIRP,
      {
        wave: 'sawtooth',
        pitch: [
          at(0, 150),
          at(0.08, 118),
          at(0.16, 140),
          at(0.26, 104),
          at(0.4, 82),
          at(0.55, 70),
        ],
        envelope: envelope(0.32, 0.03, 0.55, JINGLE_START_SECONDS),
      },
      {
        wave: 'square',
        pitch: [at(0, 75), at(0.5, 52)],
        envelope: envelope(0.16, 0.03, 0.5, JINGLE_START_SECONDS),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 6,
        cutoff: [at(0, 700), at(0.3, 420), at(0.6, 200)],
        envelope: envelope(0.4, 0.03, 0.6, JINGLE_START_SECONDS),
      },
    ],
  },
  GrabHeart: {
    variationCents: 0,
    tones: [
      ...PICKUP_CHIRP,
      {
        wave: 'sine',
        pitch: [at(0, 784), at(0.12, 784)],
        envelope: envelope(0.2, 0.004, 0.14, JINGLE_START_SECONDS),
      },
      {
        wave: 'sine',
        pitch: [at(0, 1046), at(0.3, 1046)],
        envelope: envelope(0.22, 0.004, 0.34, JINGLE_START_SECONDS + 0.12),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.3, 1568)],
        envelope: envelope(0.1, 0.004, 0.3, JINGLE_START_SECONDS + 0.12),
      },
    ],
    noises: [],
  },
  PowerDown: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 784), at(0.28, 196)],
        envelope: envelope(0.09, 0.004, 0.3),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 392), at(0.32, 98)],
        envelope: envelope(0.12, 0.004, 0.34, 0.04),
      },
    ],
    noises: [],
  },
  Pop: {
    variationCents: 120,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 520), at(0.04, 1400), at(0.16, 200)],
        envelope: envelope(0.18, 0.002, 0.18),
      },
      {
        wave: 'sine',
        pitch: [at(0, 140), at(0.2, 45)],
        envelope: envelope(0.6, 0.002, 0.22),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 3600), at(0.2, 700)],
        envelope: envelope(0.6, 0.001, 0.2),
      },
    ],
  },
  Clang: {
    variationCents: 160,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 620), at(0.25, 590)],
        envelope: envelope(0.16, 0.001, 0.3),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1530), at(0.3, 1490)],
        envelope: envelope(0.22, 0.001, 0.38),
      },
      {
        wave: 'sine',
        pitch: [at(0, 2470), at(0.2, 2400)],
        envelope: envelope(0.14, 0.001, 0.22),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 3800), at(0.05, 2600)],
        envelope: envelope(0.45, 0.001, 0.05),
      },
    ],
  },
  // NOTE: the knife: a quick, thin swish through the air, and a wet chop
  // when it meets a zombie.
  Swish: {
    variationCents: 140,
    tones: [],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 1800), at(0.06, 5200), at(0.12, 2400)],
        envelope: envelope(0.32, 0.01, 0.11),
      },
    ],
  },
  Stab: {
    variationCents: 120,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 520), at(0.06, 180)],
        envelope: envelope(0.35, 0.001, 0.08),
      },
      {
        wave: 'sine',
        pitch: [at(0, 140), at(0.1, 60)],
        envelope: envelope(0.5, 0.001, 0.1),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 1.5,
        cutoff: [at(0, 2600), at(0.08, 500)],
        envelope: envelope(0.45, 0.001, 0.09),
      },
    ],
  },
  Whoosh: {
    variationCents: 90,
    tones: [],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 500), at(0.18, 2600), at(0.4, 900)],
        envelope: envelope(0.55, 0.05, 0.35),
      },
    ],
  },
  Thud: {
    variationCents: 80,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 150), at(0.16, 48)],
        envelope: envelope(0.85, 0.002, 0.22),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 240), at(0.05, 420), at(0.2, 110)],
        envelope: envelope(0.2, 0.004, 0.2, 0.04),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 1800), at(0.2, 160)],
        envelope: envelope(0.6, 0.002, 0.22),
      },
    ],
  },
  FridgeSpin: {
    variationCents: 0,
    tones: Array.map(SPIN_CLICK_STARTS, (startSeconds, index) => ({
      wave: 'square' as const,
      pitch: [at(0, 1320 - index * 60), at(0.025, 990 - index * 50)],
      envelope: envelope(0.07, 0.001, 0.025, startSeconds),
    })),
    noises: [
      {
        filter: 'lowpass',
        quality: 3,
        cutoff: [at(0, 900), at(0.12, 160)],
        envelope: envelope(0.4, 0.003, 0.12, SPIN_LAND_SECONDS),
      },
    ],
  },
  PrizeJackpot: {
    variationCents: 0,
    tones: [
      ...Array.map([784, 988, 1175, 1568, 1976], (frequency, index) => ({
        wave: 'square' as const,
        pitch: [at(0, frequency), at(0.06, frequency)],
        envelope: envelope(0.11, 0.002, 0.07, index * 0.06),
      })),
      {
        wave: 'triangle',
        pitch: [at(0, 2349), at(0.5, 3136)],
        envelope: envelope(0.16, 0.004, 0.5, 0.3),
      },
      {
        wave: 'sine',
        pitch: [at(0, 3520), at(0.4, 4186)],
        envelope: envelope(0.06, 0.002, 0.4, 0.34),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 6000), at(0.5, 9000)],
        envelope: envelope(0.08, 0.01, 0.5, 0.3),
      },
    ],
  },
  PrizeChomp: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 220), at(0.06, 110)],
        envelope: envelope(0.16, 0.002, 0.06),
      },
      {
        wave: 'square',
        pitch: [at(0, 240), at(0.06, 120)],
        envelope: envelope(0.16, 0.002, 0.06, 0.16),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 660), at(0.1, 880)],
        envelope: envelope(0.1, 0.004, 0.12, 0.3),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.07, 700)],
        envelope: envelope(0.45, 0.001, 0.07),
      },
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2600), at(0.07, 760)],
        envelope: envelope(0.45, 0.001, 0.07, 0.16),
      },
    ],
  },
  PrizeWomp: {
    variationCents: 0,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 247), at(0.22, 233)],
        envelope: envelope(0.16, 0.01, 0.22),
      },
      {
        wave: 'sawtooth',
        pitch: [at(0, 220), at(0.5, 196), at(0.7, 185)],
        envelope: envelope(0.16, 0.01, 0.6, 0.28),
      },
    ],
    noises: [],
  },
}
