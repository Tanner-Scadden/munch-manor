import type { Array, Record } from 'effect'

import type { Gun } from './modelGuns'

// ASSUMPTIONS

// NOTE: the share of fired damage that lands is a guess at the bot's aim,
// not a measurement: its hand shake, the SMG's wobble, and the shotgun's
// spray at range. They are the knobs to recalibrate against the bot's shot
// stats if the model and the bot drift apart.
export type Assumptions = Readonly<{
  hitShare: Readonly<Record<Gun, number>>
  gnomeHitShare: number
  seeds: Array.NonEmptyReadonlyArray<number>
  stepMs: number
  peakWindowMs: number
  maxWaveMs: number
  upkeepPerVisit: number
  reserve: number
  caseGunWave: number
}>

export const ASSUMPTIONS: Assumptions = {
  hitShare: { Pistol: 0.75, Shotgun: 0.6, Smg: 0.6 },
  gnomeHitShare: 0.7,
  seeds: [1, 7920, 15839, 23758, 31677, 39596],
  stepMs: 100,
  peakWindowMs: 5000,
  maxWaveMs: 300_000,
  upkeepPerVisit: 0,
  reserve: 0,
  // NOTE: the bot opens its first display case gun (a near case's 20 kills
  // or 15 pistol kills) in the break before wave 3 on the median run.
  caseGunWave: 3,
}
