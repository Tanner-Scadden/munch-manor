import { Function } from 'effect'

import type { BotOptions, Model, Vector } from './basics'
import { type FridgeLog, type ShopVisitLog, emptyFridgeLog } from './logs'

export type Zombie = Model['zombies'][number]

export type FridgePlan = {
  useSpare: boolean
  target: Zombie | undefined
  lobMs: number
  panTarget: Zombie | undefined
}

export const GUN_PLAN: FridgePlan = {
  useSpare: false,
  target: undefined,
  lobMs: 0,
  panTarget: undefined,
}

type HumanAim = {
  targetId: number
  sinceFrame: number
  seenAt: Vector
  seenFrame: number
  velocity: Vector
  bias: number
}

export type BotState = {
  options: BotOptions
  fridgePlan: FridgePlan
  panPlanNow: FridgePlan
  botRandom: number
  maybeRawAim: Vector | undefined
  maybeHumanAim: HumanAim | undefined
  maybeAimAngle: number | undefined
  kitchenWave: number
  fridgeLog: FridgeLog
  gnomeTries: number
  breakFrames: number
  gnomesPlaced: number
  shopVisits: Array<ShopVisitLog>
}

export const freshState: {
  (options: BotOptions): (seed: number) => BotState
  (seed: number, options: BotOptions): BotState
} = Function.dual(2, (seed: number, options: BotOptions): BotState => ({
  options,
  fridgePlan: GUN_PLAN,
  panPlanNow: GUN_PLAN,
  botRandom: seed,
  maybeRawAim: undefined,
  maybeHumanAim: undefined,
  maybeAimAngle: undefined,
  kitchenWave: 0,
  fridgeLog: emptyFridgeLog(),
  gnomeTries: 0,
  breakFrames: 0,
  gnomesPlaced: 0,
  shopVisits: [],
}))
