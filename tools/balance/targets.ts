// The balance targets from GAME_DESIGN.md, as data. The nightly suite and
// the model's tests both read them. Change a target here and in the design
// doc together.

import { Option } from 'effect'

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

// NOTE: the incoming health a second at a peak, against the player's damage
// a second, as the analytical model measures it on Hard. Since 2026-10-31
// Easy and Normal scale the waves down for the human bot, whose misses the
// model's hit shares leave out, so the waves' sawtooth is held on Hard.
export const PEAK_RATIO_TARGET: Readonly<{ min: number; max: number }> = {
  min: 1.5,
  max: 2.5,
}
// Since the kitchen made the campaign ten waves long, wave 8 is a breather
// after the Ankle Biters and wave 9 a test before the finale, so the peaks
// are held on waves 5 to 7 and the finale.
export const PEAK_RATIO_WAVES: ReadonlyArray<number> = [5, 6, 7, 10]

// NOTE: the longest a wave should run, in seconds of the bot's median time
// in the snapshot pass. The model plays faster than the bot, so its own
// wave lengths are held to the same ceilings.
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

// NOTE: dead air: the seconds a wave leaves the room empty with nothing at
// a door while spawns are still to come, on the mean run, and the longest
// such stretch in any snapshot run.
const QUIET_TARGET: Readonly<{
  meanMaxSeconds: number
  longestMaxSeconds: number
}> = {
  meanMaxSeconds: 3,
  longestMaxSeconds: 1.2,
}

const PORTRAIT = 'Portrait play: Balance'

// NOTE: each portrait pass plays a landscape job's bot in the 390x844
// phone's window (135 by 180 of the room), so it is held to that job's win
// target and compared with that job's numbers. Normal is the level the
// targets are tuned on, and Easy covers the gentlest level. SWAP=1,
// Hard, and Nightmare stay landscape only to keep the nightly short: each
// pass costs over two minutes, and the Hard and Nightmare win shares sit
// near the noise of 200 runs, so a gap there would say little.
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

// NOTE: how far a portrait pass's wins may fall from, or rise above, its
// landscape twin's before the report calls out the gap. Two shares of 200
// runs near 20% differ by about 4 points from noise alone, so 8 is about
// two of those.
export const PORTRAIT_GAP_TOLERANCE = 0.08

// NOTE: Easy and Normal are held on the human bot, Hard and Nightmare on
// AIM=sharp (decided 2026-10-31, see suite.ts's jobs).
const WIN_TARGETS: ReadonlyArray<Target> = [
  between(
    'normal.wins',
    'Normal wins (default bot)',
    0.2,
    0.35,
    TARGETS_SECTION,
  ),
  between(
    'normal-swap.wins',
    'Normal wins (SWAP=1)',
    0.3,
    0.45,
    TARGETS_SECTION,
  ),
  between('easy.wins', 'Easy wins', 0.6, 0.75, TARGETS_SECTION),
  between('hard.wins', 'Hard wins (AIM=sharp)', 0.05, 0.12, TARGETS_SECTION),
  between(
    'nightmare.wins',
    'Nightmare wins (AIM=sharp)',
    0.01,
    0.04,
    TARGETS_SECTION,
  ),
]

// NOTE: portrait is judged against the same win targets as landscape.
const portraitWinTargets: ReadonlyArray<Target> = PORTRAIT_PAIRS.flatMap(
  ({ portraitId, landscapeId }) =>
    WIN_TARGETS.filter(({ key }) => key === `${landscapeId}.wins`).map(
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
  atMost(
    'normal.died.w1-2',
    'Normal deaths in waves 1 and 2',
    0.03,
    TARGETS_SECTION,
  ),
  atMost(
    'normal.died.w3-4',
    'Normal deaths in waves 3 and 4',
    0.1,
    TARGETS_SECTION,
  ),
  between(
    'normal.died.w5-6',
    'Normal deaths in waves 5 and 6',
    0.25,
    0.35,
    TARGETS_SECTION,
  ),
  between(
    'normal.died.peakWave',
    'Normal wave with the most deaths',
    10,
    10,
    TARGETS_SECTION,
  ),
  between(
    'normal.medianWin',
    'Normal median win (minutes)',
    9,
    12,
    TARGETS_SECTION,
  ),
  between(
    'normal.closeCalls',
    'Normal close calls (share of wins at 1 heart)',
    0.3,
    0.5,
    TARGETS_SECTION,
  ),
  ...PEAK_RATIO_WAVES.map(wave =>
    between(
      `model.hard.peakRatio.w${wave}`,
      `Model: wave ${wave} peak incoming hp/s over player dps (Hard)`,
      PEAK_RATIO_TARGET.min,
      PEAK_RATIO_TARGET.max,
      PRINCIPLES,
    ),
  ),
  ...WAVE_LENGTH_TARGETS.flatMap(({ wave, maxSeconds }) => [
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
