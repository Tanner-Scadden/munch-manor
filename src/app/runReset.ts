import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  CaseCard,
  KitchenCall,
  PocketCard,
  RattlesIntro,
  cosmeticSeedOf,
  quietDareHint,
} from '../domain/clientSchema'
import { startingCallingOf } from '../features/heroes/callingPick'
import { deriveIntent } from '../input/input'
import { cameraFor } from '../render/camera'
import { STILL_GLIDE } from '../render/renderSchema'
import { rollCases } from '../world/feats/cases'
import { playerOfCalling } from '../world/heroes/callingPlayer'
import { freshOvens } from '../world/kitchen/kitchen'
import { START_LEVEL } from '../world/level/arena'
import { soloState } from '../world/party/party'
import {
  Boss,
  DebutCard,
  Party,
  Phase,
  Streak,
  barePantry,
  calmPacing,
  freshCrates,
  freshDare,
  freshKeys,
  freshLevel,
  freshLoot,
  freshStats,
  freshStove,
  idleStations,
  initialHitStop,
  initialPlayer,
  shutFridge,
  shutValve,
  stillShake,
} from '../world/schema/worldSchema'
import { ZERO_VECTOR } from '../world/step/geometry'
import {
  type Model,
  freshCosmetics,
  freshRoomRun,
  freshRunGains,
} from './model'

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
  | 'maybeFinisher'
  | 'cameraGlide'
  | 'zombies'
  | 'bullets'
  | 'lobs'
  | 'fridge'
  | 'pantry'
  | 'stove'
  | 'crates'
  | 'keys'
  | 'dare'
  | 'dareThings'
  | 'gasValve'
  | 'stations'
  | 'cases'
  | 'elapsedMs'
  | 'frameEvents'
  | 'hitStop'
  | 'shake'
  | 'streak'
  | 'traps'
  | 'pickups'
  | 'loot'
  | 'stepCarryMs'
  | 'kitchenCall'
  | 'dareHint'
  | 'maybeBreakIdleSinceMs'
  | 'level'
  | 'introSkip'
  | 'pocketCard'
  | 'dareSatchel'
  | 'caseCard'
  | 'ovens'
  | 'debutCard'
  | 'rattlesIntro'
  | 'hintBand'
  | 'stats'
  | 'runGains'
  | 'roomRun'
  | 'screenMs'
  | 'endCard'
  | 'runRecords'
  | 'bestStreak'
  | 'party'
  | 'seats'
  | 'runStart'
  | 'cosmetics'
>

export const freshRun = (model: Model): RunFields => ({
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  cameraLean: ZERO_VECTOR,
  maybeFinisher: Option.none(),
  cameraGlide: STILL_GLIDE,
  zombies: [],
  bullets: [],
  lobs: [],
  fridge: shutFridge,
  pantry: barePantry,
  stove: freshStove(model.rngState),
  crates: freshCrates(model.rngState),
  keys: freshKeys(model.rngState),
  dare: freshDare(model.rngState),
  dareThings: [],
  gasValve: shutValve,
  stations: idleStations,
  cases: rollCases(model.rngState, model.difficulty.chosen),
  elapsedMs: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  shake: stillShake,
  streak: Streak.Cold(),
  traps: [],
  pickups: [],
  loot: freshLoot(model.rngState),
  stepCarryMs: 0,
  kitchenCall: KitchenCall.Quiet({ calledWave: 0 }),
  dareHint: quietDareHint,
  maybeBreakIdleSinceMs: Option.none(),
  level: freshLevel(model.rngState),
  introSkip: 'Watching',
  pocketCard: PocketCard.Pocketed(),
  dareSatchel: [],
  caseCard: CaseCard.Hidden(),
  ovens: freshOvens(START_LEVEL),
  debutCard: DebutCard.Hidden(),
  rattlesIntro: RattlesIntro.Waiting(),
  hintBand: 'Top',
  stats: freshStats,
  runGains: freshRunGains,
  roomRun: freshRoomRun,
  screenMs: 0,
  // NOTE: SHARE's sheet and the death tip outlive a run; the rest of the end
  // card starts fresh.
  endCard: modifyFields(model.endCard, {
    maybeShareCopiedAtMs: () => Option.none(),
    isRunCardDropped: () => false,
  }),
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
          cameraFor(START_LEVEL, initialPlayer),
        ),
    }),
  ],
  runStart: { runSeed: model.rngState, runPool: [], crewBots: [] },
  cosmetics: modifyFields(freshCosmetics, {
    cosmeticRngState: () => cosmeticSeedOf(model.rngState),
  }),
})

// NOTE: going home ends the run, so every run field goes back to a fresh start.
export const returnHome = (model: Model): Model => ({
  ...model,
  ...freshRun(model),
  phase: Phase.Ready(),
  maybeHomeFocus: Option.none(),
})
