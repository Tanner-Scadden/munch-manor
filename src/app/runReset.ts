import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  KitchenCall,
  PrizeFlight,
  RunTally,
  cosmeticSeedOf,
  noRankPaid,
} from '../domain/clientSchema'
import { startingCallingOf } from '../features/heroes/callingPick'
import { deriveIntent } from '../input/input'
import { cameraFor } from '../render/camera'
import { noTellWatch } from '../render/renderSchema'
import { playerOfCalling } from '../world/heroes/callingPlayer'
import { freshOvens } from '../world/kitchen/kitchen'
import { MANOR, startingLevel } from '../world/level/arena'
import { soloState } from '../world/party/party'
import {
  Boss,
  CounterSale,
  DebutCard,
  Party,
  Phase,
  Streak,
  TrapNotice,
  barePantry,
  calmPacing,
  freshLoot,
  freshStats,
  freshStove,
  initialHitStop,
  initialPlayer,
  shutFridge,
  shutValve,
  stillShake,
} from '../world/schema/worldSchema'
import { ZERO_VECTOR } from '../world/step/geometry'
import type { Model } from './model'

// NOTE: every field that belongs to one run, set as a new run starts. Starting
// a run and going home both spread this record, so neither can leave a stale
// field behind. The phase, the mode, and the lessons are each caller's own.
export type RunFields = Pick<
  Model,
  | 'pacing'
  | 'boss'
  | 'frenzyPacks'
  | 'intensity'
  | 'cameraLean'
  | 'zombies'
  | 'bullets'
  | 'lobs'
  | 'particles'
  | 'decals'
  | 'dustCooldownMs'
  | 'tellWatch'
  | 'fridge'
  | 'pantry'
  | 'stove'
  | 'gasValve'
  | 'elapsedMs'
  | 'frameEvents'
  | 'hitStop'
  | 'shake'
  | 'popups'
  | 'streak'
  | 'blasts'
  | 'traps'
  | 'pickups'
  | 'loot'
  | 'cosmeticRngState'
  | 'stepCarryMs'
  | 'callouts'
  | 'prizeFlight'
  | 'counterSale'
  | 'kitchenCall'
  | 'breakIdleMs'
  | 'trapNotice'
  | 'level'
  | 'introSkip'
  | 'ovens'
  | 'debutCard'
  | 'hintBand'
  | 'stats'
  | 'runTally'
  | 'rankPaid'
  | 'maybeRankGain'
  | 'maybeRoomDifficulty'
  | 'maybeRoomModifiers'
  | 'maybeCrewRunKey'
  | 'screenMs'
  | 'maybeShareCopiedAtMs'
  | 'isRunCardDropped'
  | 'runRecords'
  | 'bestStreak'
  | 'party'
  | 'seats'
  | 'crewBots'
>

export const freshRun = (model: Model): RunFields => ({
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  cameraLean: ZERO_VECTOR,
  zombies: [],
  bullets: [],
  lobs: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  tellWatch: noTellWatch,
  fridge: shutFridge,
  pantry: barePantry,
  stove: freshStove(model.rngState),
  gasValve: shutValve,
  elapsedMs: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  shake: stillShake,
  popups: [],
  streak: Streak.Cold(),
  blasts: [],
  traps: [],
  pickups: [],
  loot: freshLoot(model.rngState),
  cosmeticRngState: cosmeticSeedOf(model.rngState),
  stepCarryMs: 0,
  callouts: [],
  prizeFlight: PrizeFlight.Grounded(),
  counterSale: CounterSale.Quiet(),
  kitchenCall: KitchenCall.Quiet({ calledWave: 0 }),
  breakIdleMs: 0,
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  introSkip: 'Watching',
  ovens: freshOvens(MANOR),
  debutCard: DebutCard.Hidden(),
  hintBand: 'Top',
  stats: freshStats,
  runTally: RunTally.Uncounted(),
  rankPaid: noRankPaid,
  maybeRankGain: Option.none(),
  maybeRoomDifficulty: Option.none(),
  maybeRoomModifiers: Option.none(),
  maybeCrewRunKey: Option.none(),
  screenMs: 0,
  maybeShareCopiedAtMs: Option.none(),
  isRunCardDropped: false,
  runRecords: [],
  bestStreak: 0,
  party: Party.Solo(),
  seats: [
    modifyFields(soloState, {
      player: () => playerOfCalling(startingCallingOf(model)),
      intent: () =>
        deriveIntent(
          model.input,
          initialPlayer,
          cameraFor(MANOR, initialPlayer),
        ),
    }),
  ],
  crewBots: [],
})

// NOTE: going home ends the run, so every run field goes back to a fresh start.
export const returnHome = (model: Model): Model => ({
  ...model,
  ...freshRun(model),
  phase: Phase.Ready(),
  maybeHomeFocus: Option.none(),
})
