// The guns as the analytical balance model (model.ts) sees them: their
// stats, sustained damage, and time to kill.

import { Function } from 'effect'

import type { WeaponKind } from '../../src/model'
import { effectiveStats } from '../../src/weapons'

export type Gun = 'Pistol' | 'Shotgun' | 'Smg'
export type SpareGun = 'Shotgun' | 'Smg'

// NOTE: only the fields the damage math reads, so tests can hand-make one.
export type GunStats = Readonly<{
  damage: number
  pellets: number
  fireIntervalMs: number
  magazine: number
  reloadMs: number
}>

export const gunStats: {
  (tier: number): (kind: WeaponKind) => GunStats
  (kind: WeaponKind, tier: number): GunStats
} = Function.dual(2, (kind: WeaponKind, tier: number): GunStats =>
  effectiveStats(kind, tier),
)

// The damage a second a gun lands over a long fight: a magazine emptied at
// its fire rate, then a reload, with hitShare of the damage landing.
export const sustainedDps: {
  (hitShare: number): (stats: GunStats) => number
  (stats: GunStats, hitShare: number): number
} = Function.dual(
  2,
  (stats: GunStats, hitShare: number): number =>
    (stats.damage * stats.pellets * hitShare * stats.magazine) /
    ((stats.magazine * stats.fireIntervalMs + stats.reloadMs) / 1000),
)

// The expected seconds one gun takes to kill one zombie of hp, reloads
// included: the first shot lands at once.
export const timeToKill: {
  (stats: GunStats, hitShare: number): (hp: number) => number
  (hp: number, stats: GunStats, hitShare: number): number
} = Function.dual(
  3,
  (hp: number, stats: GunStats, hitShare: number): number => {
    const shots = Math.ceil(hp / (stats.damage * stats.pellets * hitShare))
    const reloads = Math.floor((shots - 1) / stats.magazine)
    return (
      ((shots - 1) * stats.fireIntervalMs + reloads * stats.reloadMs) / 1000
    )
  },
)
