// The balance targets from GAME_DESIGN.md, as data. The nightly suite and
// the model's tests both read them. Change a target here and in the design
// doc together.

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

// NOTE: a win is an escape (docs/ESCAPE_PLAN.md, layer 17, set with the
// owner's intent on 2026-11-10): Normal winnable by a decent person, about a
// third of the human bot's runs; Easy escaped most runs; Hard a real step up
// for a player who aims well; Nightmare a Halo Legendary achievement, a few
// percent of the sharp bot's runs. Easy and Normal are held on the human
// bot, Hard and Nightmare on AIM=sharp (decided 2026-10-31, see suite.ts's
// jobs).
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

// NOTE: how long an escape takes, the median escaped run in minutes and the
// wave it walks out on: long enough that the hunt and the ramp both bite,
// short enough for one sitting. Hard's breaks run on a clock, so its
// escape a wave later than Normal's takes about as long. Uncle Chunk's
// earliest wave
// (FINALE_RULES.chunkFromWave in src/world/dare/finale.ts) sets most of it.
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

// NOTE: past the ten tuned waves an escape (and Endless) plays the Endless
// generator's waves, the ramp. Each is held to two minutes at most on the
// Endless job, the campaign bot's mean length of the wave, and at least 40
// seconds, so the ramp keeps climbing rather than thinning out.
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

// NOTE: portrait is judged against the same win targets as landscape.
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
  // NOTE: restated for the escape on 2026-11-10. With no shop the run
  // fights on the pistol until its first case opens (about wave 3), so waves
  // 3 and 4 take a little more than the old 10%, and waves 5 and 6 (the
  // Big Lug and the Big Leaguer, the house hungrier once the list is done)
  // are the main wall before Uncle Chunk, who comes from wave 8.
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
  // NOTE: restated for the escape on 2026-11-10 from 40 to 65%: the crates'
  // hearts while hurt and the fridge's Sandwich carry more runs out with
  // hearts to spare. The ceiling keeps Normal from turning into a coin flip.
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
