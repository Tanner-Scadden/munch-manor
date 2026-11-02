import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { MANOR, startingLevel } from './arena'
import { startingCallingOf } from './callingPick'
import { playerOfCalling } from './callingPlayer'
import { cameraFor } from './camera'
import {
  PrizeFlight,
  RunTally,
  cosmeticSeedOf,
  noRankPaid,
  noTellWatch,
} from './clientSchema'
import { ZERO_VECTOR } from './geometry'
import { deriveIntent } from './input'
import { freshOvens } from './kitchen'
import type { Model } from './model'
import { soloState } from './party'
import {
  Boss,
  CounterSale,
  DebutCard,
  Party,
  Streak,
  TrapNotice,
  calmPacing,
  freshLoot,
  freshStats,
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
  | 'cameraLean'
  | 'zombies'
  | 'bullets'
  | 'lobs'
  | 'particles'
  | 'decals'
  | 'dustCooldownMs'
  | 'tellWatch'
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
  | 'loot'
  | 'cosmeticRngState'
  | 'stepCarryMs'
  | 'callouts'
  | 'prizeFlight'
  | 'counterSale'
  | 'breakIdleMs'
  | 'trapNotice'
  | 'level'
  | 'ovens'
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
  breakIdleMs: 0,
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  ovens: freshOvens(MANOR),
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
