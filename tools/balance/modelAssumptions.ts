import type { Array, Record } from 'effect'

import type { Gun } from './modelGuns'

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
  caseGunWave: 3,
}
