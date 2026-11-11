// Uncle Chunk's numbers: his entrance, each attack's reach, wind-up,
// rest, and harm, his second phase, and his guests. Read by his fight
// (src/world/zombies/boss.ts, bossFight.ts), the drawing, and the bot.

import type { BossAttack } from '../schema/worldSchema'

// RULES

export type BossRules = {
  everyWaves: number
  arriveAfterShare: number
  entranceMs: number
  firstAttackMs: number
  stompTriggerPx: number
  stompRadius: number
  stompDamage: number
  stompKnockback: number
  slamTriggerPx: number
  slamRadius: number
  slamDamage: number
  slamKnockback: number
  farPx: number
  farPace: number
  chargeLaneHalfWidth: number
  chargeSpeed: number
  chargeOvershootPx: number
  chargeDamage: number
  chargeKnockbackScale: number
  chargeShove: number
  dazedMs: number
  dazedWoundScale: number
  spitFlightMs: number
  spitRadius: number
  spitDamage: number
  puddleMs: number
  puddleRadius: number
  puddleSlow: number
  globMax: number
  volleyCount: number
  volleySpreadPx: number
  belchCount: number
  ragedBelchCount: number
  ragedBelchScale: number
  crashers: number
  crashersPerExtra: number
  crasherGapPx: number
  belchReachPx: number
  belchSpreadPx: number
  belchEveryMs: number
  firstBelchMs: number
  belchFarRate: number
  enrageShare: number
  enrageSpeedScale: number
  enrageGapScale: number
  retryMs: number
  holdMs: number
  windUpMs: Readonly<Record<BossAttack, number>>
  recoverMs: Readonly<Record<BossAttack, number>>
  cooldownMs: Readonly<Record<BossAttack, number>>
}

export const BOSS_RULES: BossRules = {
  everyWaves: 10,
  arriveAfterShare: 2 / 3,
  entranceMs: 2600,
  firstAttackMs: 2500,
  stompTriggerPx: 44,
  stompRadius: 34,
  stompDamage: 1,
  stompKnockback: 160,
  slamTriggerPx: 64,
  slamRadius: 56,
  slamDamage: 2,
  slamKnockback: 240,
  farPx: 70,
  farPace: 1.6,
  chargeLaneHalfWidth: 8,
  chargeSpeed: 190,
  chargeOvershootPx: 60,
  chargeDamage: 2,
  chargeKnockbackScale: 1.6,
  chargeShove: 260,
  dazedMs: 1800,
  dazedWoundScale: 2,
  spitFlightMs: 900,
  spitRadius: 10,
  spitDamage: 1,
  puddleMs: 4500,
  puddleRadius: 10,
  puddleSlow: 0.5,
  globMax: 9,
  volleyCount: 3,
  volleySpreadPx: 26,
  belchCount: 1,
  ragedBelchCount: 3,
  ragedBelchScale: 0.6,
  crashers: 6,
  crashersPerExtra: 3,
  crasherGapPx: 10,
  belchReachPx: 14,
  belchSpreadPx: 7,
  belchEveryMs: 15000,
  firstBelchMs: 6000,
  belchFarRate: 1.5,
  enrageShare: 1 / 2,
  enrageSpeedScale: 1.5,
  enrageGapScale: 0.55,
  retryMs: 400,
  holdMs: 5000,
  windUpMs: { Stomp: 1000, Slam: 1200, Belch: 800, Spit: 500, Charge: 800 },
  recoverMs: { Stomp: 600, Slam: 900, Belch: 400, Spit: 400, Charge: 500 },
  cooldownMs: {
    Stomp: 1600,
    Slam: 2000,
    Belch: 1200,
    Spit: 4500,
    Charge: 3000,
  },
}
