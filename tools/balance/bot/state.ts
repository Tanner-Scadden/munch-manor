// The state one run of the balance bot carries from frame to frame, beside
// the game's Model: the bot's plans, its hand's random stream, and its logs.
// play makes a fresh one for every run and hands it to whatever reads or
// writes it, so nothing of one run leaks into the next.

import type { BotOptions, Model, Vector } from './basics'
import { type FridgeLog, emptyFridgeLog } from './logs'

// THE FRIDGE WEAPONS' PLAN

// How the bot fights while it carries a fridge weapon, chosen every few
// frames: whether to hold the spare or the pistol, what to aim at, and how
// long to hold a Cooker charge. The Pan is in the melee slot, so its plan
// (panPlanNow) is its own: whether to swing, and the zombie it keeps its
// distance to.
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

// THE RUN'S STATE

export type BotState = {
  // The options of the run being played.
  options: BotOptions
  fridgePlan: FridgePlan
  panPlanNow: FridgePlan
  // The hand's shake: a seeded stream, so a run replays exactly.
  botRandom: number
  // Where the bot last pointed, which the touch aim assist bends.
  maybeRawAim: Vector | undefined
  // The wave whose break the kitchen was bought in, or 0 when it never was.
  kitchenWave: number
  fridgeLog: FridgeLog
  spentOnUpgrades: number
  gnomeTries: number
  gnomesPlaced: number
  boughtLog: Array<Array<string>>
}

// A run's state before its first frame: the hand's stream starts at the
// run's seed.
export const freshState = (seed: number, options: BotOptions): BotState => ({
  options,
  fridgePlan: GUN_PLAN,
  panPlanNow: GUN_PLAN,
  botRandom: seed,
  maybeRawAim: undefined,
  kitchenWave: 0,
  fridgeLog: emptyFridgeLog(),
  spentOnUpgrades: 0,
  gnomeTries: 0,
  gnomesPlaced: 0,
  boughtLog: [],
})
