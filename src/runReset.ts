import { Option } from 'effect'

import { MANOR, startingLevel } from './arena'
import { startingCallingOf } from './callingPick'
import { playerOfCalling } from './callingPlayer'
import { cameraFor } from './camera'
import {
  PrizeFlight,
  RunTally,
  cosmeticSeedOf,
  noRankPaid,
} from './clientSchema'
import { ZERO_VECTOR } from './geometry'
import { deriveIntent } from './input'
import { freshOvens } from './kitchen'
import type { Model } from './model'
import { flowFieldToward } from './pathing'
import {
  Boss,
  CounterSale,
  DebutCard,
  FIRST_SHOP_CATEGORY,
  Party,
  Purchase,
  ShopState,
  Streak,
  TrapNotice,
  calmPacing,
  emptyTrapStock,
  emptyWallet,
  freshLoot,
  freshStats,
  idleBoosts,
  initialHitStop,
  initialPlayer,
  shutFridge,
  stillShake,
} from './worldSchema'

// NOTE: every field that belongs to one run, set as a new run starts. Starting
// a run and going home both spread this record, so neither can leave a stale
// field behind. The phase, the mode, and the lessons are each caller's own.
export type RunFields = Pick<
  Model,
  | 'pacing'
  | 'boss'
  | 'frenzyPacks'
  | 'intensity'
  | 'player'
  | 'cameraLean'
  | 'zombies'
  | 'bullets'
  | 'lobs'
  | 'particles'
  | 'decals'
  | 'dustCooldownMs'
  | 'wallet'
  | 'shop'
  | 'shopCategory'
  | 'purchase'
  | 'fridge'
  | 'elapsedMs'
  | 'frameEvents'
  | 'hitStop'
  | 'shake'
  | 'popups'
  | 'streak'
  | 'blasts'
  | 'traps'
  | 'pickups'
  | 'boosts'
  | 'loot'
  | 'cosmeticRngState'
  | 'stepCarryMs'
  | 'callouts'
  | 'prizeFlight'
  | 'counterSale'
  | 'trapStock'
  | 'selectedTrap'
  | 'laserSight'
  | 'trapNotice'
  | 'level'
  | 'ovens'
  | 'flowField'
  | 'wideFlowField'
  | 'intent'
  | 'debutCard'
  | 'hintBand'
  | 'stats'
  | 'runTally'
  | 'rankPaid'
  | 'maybeRankGain'
  | 'maybeRoomDifficulty'
  | 'maybeCrewRunKey'
  | 'screenMs'
  | 'maybeShareCopiedAtMs'
  | 'isRunCardDropped'
  | 'runRecords'
  | 'bestStreak'
  | 'party'
>

export const freshRun = (model: Model): RunFields => ({
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  player: playerOfCalling(startingCallingOf(model)),
  cameraLean: ZERO_VECTOR,
  zombies: [],
  bullets: [],
  lobs: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  wallet: emptyWallet,
  shop: ShopState.Away(),
  shopCategory: FIRST_SHOP_CATEGORY,
  purchase: Purchase.Idle(),
  fridge: shutFridge,
  elapsedMs: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  shake: stillShake,
  popups: [],
  streak: Streak.Cold(),
  blasts: [],
  traps: [],
  pickups: [],
  boosts: idleBoosts,
  loot: freshLoot(model.rngState),
  cosmeticRngState: cosmeticSeedOf(model.rngState),
  stepCarryMs: 0,
  callouts: [],
  prizeFlight: PrizeFlight.Grounded(),
  counterSale: CounterSale.Quiet(),
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  laserSight: 'None',
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  ovens: freshOvens(MANOR),
  flowField: flowFieldToward(MANOR, initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(MANOR, initialPlayer, 'Wide', []),
  intent: deriveIntent(
    model.input,
    initialPlayer,
    cameraFor(MANOR, initialPlayer),
  ),
  debutCard: DebutCard.Hidden(),
  hintBand: 'Top',
  stats: freshStats,
  runTally: RunTally.Uncounted(),
  rankPaid: noRankPaid,
  maybeRankGain: Option.none(),
  maybeRoomDifficulty: Option.none(),
  maybeCrewRunKey: Option.none(),
  screenMs: 0,
  maybeShareCopiedAtMs: Option.none(),
  isRunCardDropped: false,
  runRecords: [],
  bestStreak: 0,
  party: Party.Solo(),
})
