import { Array, Option } from 'effect'

export type Target = Readonly<{
  key: string
  label: string
  maybeMin: Option.Option<number>
  maybeMax: Option.Option<number>
  source: string
}>

const between = (
  key: string,
  label: string,
  min: number,
  max: number,
  source: string,
): Target => ({
  key,
  label,
  maybeMin: Option.some(min),
  maybeMax: Option.some(max),
  source,
})

const atMost = (
  key: string,
  label: string,
  max: number,
  source: string,
): Target => ({
  key,
  label,
  maybeMin: Option.none(),
  maybeMax: Option.some(max),
  source,
})

const TARGETS_SECTION = 'How balance is checked: the targets'
const PRINCIPLES = 'Difficulty principles: sawtooth intensity'

export const PEAK_RATIO_TARGET: Readonly<{ min: number; max: number }> = {
  min: 1.5,
  max: 2.5,
}
export const PEAK_RATIO_WAVES: ReadonlyArray<number> = [5, 6, 7, 10]

export type WaveLengthTarget = Readonly<{ wave: number; maxSeconds: number }>

export const WAVE_LENGTH_TARGETS: ReadonlyArray<WaveLengthTarget> = [
  { wave: 1, maxSeconds: 40 },
  { wave: 2, maxSeconds: 75 },
  { wave: 3, maxSeconds: 75 },
  { wave: 4, maxSeconds: 75 },
  { wave: 5, maxSeconds: 90 },
  { wave: 6, maxSeconds: 90 },
  { wave: 7, maxSeconds: 90 },
  { wave: 8, maxSeconds: 90 },
  { wave: 9, maxSeconds: 90 },
  { wave: 10, maxSeconds: 120 },
]

const QUIET_TARGET: Readonly<{
  meanMaxSeconds: number
  longestMaxSeconds: number
}> = {
  meanMaxSeconds: 3,
  longestMaxSeconds: 1.2,
}

const PORTRAIT = 'Portrait play: Balance'

export type PortraitPair = Readonly<{
  portraitId: string
  landscapeId: string
  title: string
}>

export const PORTRAIT_PAIRS: ReadonlyArray<PortraitPair> = [
  {
    portraitId: 'portrait-normal',
    landscapeId: 'normal',
    title: 'Normal, default bot',
  },
  {
    portraitId: 'portrait-easy',
    landscapeId: 'easy',
    title: 'Easy, default bot',
  },
]

export const PORTRAIT_GAP_TOLERANCE = 0.08

const WIN_TARGETS: ReadonlyArray<Target> = [
  between(
    'normal.wins',
    'Normal escapes (default bot)',
    0.3,
    0.45,
    TARGETS_SECTION,
  ),
  between(
    'normal-swap.wins',
    'Normal escapes (SWAP=1)',
    0.3,
    0.5,
    TARGETS_SECTION,
  ),
  between('easy.wins', 'Easy escapes', 0.6, 0.8, TARGETS_SECTION),
  between('hard.wins', 'Hard escapes (AIM=sharp)', 0.1, 0.2, TARGETS_SECTION),
  between(
    'nightmare.wins',
    'Nightmare escapes (AIM=sharp)',
    0.01,
    0.06,
    TARGETS_SECTION,
  ),
]

const ESCAPE_LENGTH_TARGETS: ReadonlyArray<Target> = [
  between(
    'easy.medianWin',
    'Easy median escape (minutes)',
    8,
    14,
    TARGETS_SECTION,
  ),
  between(
    'normal.medianWin',
    'Normal median escape (minutes)',
    12,
    20,
    TARGETS_SECTION,
  ),
  between(
    'hard.medianWin',
    'Hard median escape (minutes)',
    10,
    20,
    TARGETS_SECTION,
  ),
  between(
    'normal.medianWinWave',
    'Normal median escape wave',
    8,
    10,
    TARGETS_SECTION,
  ),
]

const RAMP_WAVES: ReadonlyArray<number> = [11, 12, 13, 14, 15]

const RAMP_TARGETS: ReadonlyArray<Target> = Array.map(RAMP_WAVES, wave =>
  between(
    `endless.length.w${wave}`,
    `Endless wave ${wave} mean length (seconds)`,
    40,
    120,
    TARGETS_SECTION,
  ),
)

const portraitWinTargets: ReadonlyArray<Target> = Array.flatMap(
  PORTRAIT_PAIRS,
  ({ portraitId, landscapeId }) =>
    Array.map(
      Array.filter(WIN_TARGETS, ({ key }) => key === `${landscapeId}.wins`),
      ({ label, maybeMin, maybeMax }): Target => ({
        key: `${portraitId}.wins`,
        label: `Portrait ${label}`,
        maybeMin,
        maybeMax,
        source: PORTRAIT,
      }),
    ),
)

export const TARGETS: ReadonlyArray<Target> = [
  ...WIN_TARGETS,
  ...portraitWinTargets,
  ...ESCAPE_LENGTH_TARGETS,
  ...RAMP_TARGETS,
  atMost(
    'normal.died.w1-2',
    'Normal deaths in waves 1 and 2',
    0.03,
    TARGETS_SECTION,
  ),
  atMost(
    'normal.died.w3-4',
    'Normal deaths in waves 3 and 4',
    0.15,
    TARGETS_SECTION,
  ),
  between(
    'normal.died.w5-6',
    'Normal deaths in waves 5 and 6',
    0.15,
    0.35,
    TARGETS_SECTION,
  ),
  between(
    'normal.died.peakWave',
    'Normal wave with the most deaths',
    5,
    9,
    TARGETS_SECTION,
  ),
  between(
    'normal.closeCalls',
    'Normal close calls (share of escapes at 1 heart)',
    0.25,
    0.6,
    TARGETS_SECTION,
  ),
  ...Array.map(PEAK_RATIO_WAVES, wave =>
    between(
      `model.hard.peakRatio.w${wave}`,
      `Model: wave ${wave} peak incoming hp/s over player dps (Hard)`,
      PEAK_RATIO_TARGET.min,
      PEAK_RATIO_TARGET.max,
      PRINCIPLES,
    ),
  ),
  ...Array.flatMap(WAVE_LENGTH_TARGETS, ({ wave, maxSeconds }) => [
    atMost(
      `waves.w${wave}.medianLength`,
      `Wave ${wave} median length in the snapshot pass (seconds)`,
      maxSeconds,
      TARGETS_SECTION,
    ),
    atMost(
      `waves.w${wave}.quiet`,
      `Wave ${wave} quiet empty room mid-wave, mean (seconds)`,
      QUIET_TARGET.meanMaxSeconds,
      TARGETS_SECTION,
    ),
    atMost(
      `waves.w${wave}.worstQuiet`,
      `Wave ${wave} longest quiet empty room in any run (seconds)`,
      QUIET_TARGET.longestMaxSeconds,
      TARGETS_SECTION,
    ),
  ]),
]
