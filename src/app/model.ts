import { Option, Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'
import { NetStats } from '@munch/netcode'

import { BeatMyRun, noBeatMyRun } from '../domain/beatLink'
import {
  AudioState,
  Bot,
  CaseCard,
  ClocheLift,
  DareHint,
  DeathTip,
  DifficultyCard,
  HintBand,
  HomeMenu,
  IntroSkip,
  JournalRun,
  KitchenCall,
  LevelCallout,
  type LoadStep,
  Loading,
  MasteryRun,
  PlayerBests,
  PocketCard,
  PrizeFlight,
  QuestTour,
  RankGain,
  RankPaid,
  RattlesIntro,
  RunRecord,
  RunTally,
  SaveStatus,
  SyncedSaveState,
  Tour,
  UpdateGift,
  cosmeticSeedOf,
  defaultAppearance,
  freshHomeMenu,
  freshLessons,
  noJournalRun,
  noMasteryRun,
  noRankPaid,
  quietDareHint,
} from '../domain/clientSchema'
import * as Coop from '../features/coop/model'
import { ShareSheet } from '../features/end/share'
import { HomeButton, MenuPanel } from '../features/home/homeSchema'
import * as Lobby from '../features/lobby/model'
import { HelpCard } from '../features/menus/message'
import {
  MissionGain,
  MissionRun,
  noMissionRun,
} from '../features/missions/missionSchema'
import * as Munchopedia from '../features/munchopedia/model'
import * as Profile from '../features/profile/model'
import * as ProofShelf from '../features/proof/model'
import {
  Input,
  InputDevice,
  Orientation,
  SurfaceRectangle,
  TouchControls,
  idleInput,
} from '../input/inputSchema'
import {
  FullscreenSetting,
  InstallOffer,
  OrientationLock,
  PageVisibility,
  ScreenFit,
} from '../platform/deviceSchema'
import {
  LastRunSync,
  PlayerChange,
  PlayerScopeStatus,
  SyncState,
} from '../platform/playerSync'
import { RunRecorder } from '../platform/recording'
import { SUPPORT_URL, maybeSupportUrlOf } from '../platform/support'
import {
  ActionWatch,
  CameraGlide,
  Decal,
  Finisher,
  Particle,
  STILL_GLIDE,
  TellWatch,
  noActionWatch,
  noTellWatch,
} from '../render/renderSchema'
import { DEFAULT_SEED } from '../shared/constants'
import { SavedDareMarks, noDareMarks } from '../shared/dareMarkData'
import { DayStamp } from '../shared/dayStamp'
import { SavedJournal, noJournal } from '../shared/journalData'
import { SavedMastery, noMastery } from '../shared/masteryData'
import { SavedMissions, noMissions } from '../shared/missionData'
import {
  Appearance,
  Calling,
  CursorSetting,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  RecordRunsSetting,
  RecordUnlock,
  RotationSetting,
  RumbleSetting,
  RunEnding,
  SavedBonuses,
  SavedBoughtCosmetics,
  SavedRank,
  SavedSeenUnlocks,
  SavedTrapHint,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
  noBonuses,
} from '../shared/playerData'
import { SavedProof, noProof } from '../shared/proofData'
import { DareKind } from '../world/dare/dareSchema'
import { rollCases } from '../world/feats/cases'
import { noRank } from '../world/heroes/rank'
import { startingLevel } from '../world/level/arena'
import { soloState } from '../world/party/party'
import { Modifiers, noModifiers } from '../world/run/modifiers'
import {
  Blast,
  Boss,
  Callout,
  DebutCard,
  type DifficultyBests,
  Party,
  Phase,
  PickupKind,
  Popup,
  RunMode,
  Shake,
  Streak,
  TrapHint,
  TrapNotice,
  Vector,
  World,
  ZombieKind,
  barePantry,
  calmPacing,
  freshCrates,
  freshDare,
  freshKeys,
  freshLoot,
  freshStats,
  freshStove,
  idleStations,
  initialHitStop,
  noKills,
  noPractice,
  shutFridge,
  shutValve,
  stillShake,
} from '../world/schema/worldSchema'

export * from '../domain/clientSchema'
export * from '../world/schema/worldSchema'

// NOTE: the save and sync's state: the splash's loading, the save's read and
// writes, the player scope's sync, and a synced save waiting to be taken.
const Saving = Schema.Struct({
  loading: Loading,
  saveStatus: SaveStatus,
  syncState: SyncState,
  playerScopeStatus: PlayerScopeStatus,
  lastRunSync: LastRunSync,
  writesInFlight: Schema.Finite,
  unsavedChanges: Schema.Array(PlayerChange),
  syncedSave: SyncedSaveState,
})
type Saving = typeof Saving.Type

const freshSaving: Saving = {
  loading: Loading.Loaded(),
  saveStatus: 'Unread',
  syncState: SyncState.LocalOnly(),
  playerScopeStatus: PlayerScopeStatus.Idle(),
  lastRunSync: LastRunSync.NoRun(),
  writesInFlight: 0,
  unsavedChanges: [],
  syncedSave: 'Current',
}

// NOTE: an online co-op run's own record, kept with the run so its summary
// has it after the room is gone (a LEAVE).
export const RoomRun = Schema.Struct({
  // NOTE: the room's difficulty while an online co-op run is drawn.
  maybeRoomDifficulty: Schema.Option(Difficulty),
  // NOTE: the room's modifiers, kept the same way (src/world/run/modifiers.ts).
  maybeRoomModifiers: Schema.Option(Modifiers),
  // NOTE: the room's dare mark, kept the same way (src/world/run/dareLadder.ts).
  maybeRoomDareMark: Schema.Option(Schema.Finite),
  // NOTE: the online co-op run's key, the same on every client in it.
  maybeCrewRunKey: Schema.Option(Schema.String),
  // NOTE: the online co-op run's network numbers as this client measured
  // them (packages/netcode NetStats.ts), copied from the room each frame.
  maybeRunNet: Schema.Option(NetStats.ClientNet),
})
export type RoomRun = typeof RoomRun.Type

export const freshRoomRun: RoomRun = {
  maybeRoomDifficulty: Option.none(),
  maybeRoomModifiers: Option.none(),
  maybeRoomDareMark: Option.none(),
  maybeCrewRunKey: Option.none(),
  maybeRunNet: Option.none(),
}

// NOTE: what this run pays and gathers: its tally and rank pay, and toward
// the daily missions (src/features/missions/missions.ts), the Dare Journal
// (src/domain/journal.ts), and mastery (src/domain/mastery.ts), with the
// gains the end card shows.
export const RunGains = Schema.Struct({
  runTally: RunTally,
  rankPaid: RankPaid,
  maybeRankGain: Schema.Option(RankGain),
  missionRun: MissionRun,
  maybeMissionGain: Schema.Option(MissionGain),
  journalRun: JournalRun,
  masteryRun: MasteryRun,
})
export type RunGains = typeof RunGains.Type

export const freshRunGains: RunGains = {
  runTally: RunTally.Uncounted(),
  rankPaid: noRankPaid,
  maybeRankGain: Option.none(),
  missionRun: noMissionRun,
  maybeMissionGain: Option.none(),
  journalRun: noJournalRun,
  masteryRun: noMasteryRun,
}

// NOTE: the end card's own state: SHARE's sheet and copy, the card's drop,
// and Rattles' death tip.
const EndCard = Schema.Struct({
  shareSheet: ShareSheet,
  maybeShareCopiedAtMs: Schema.Option(Schema.Finite),
  isRunCardDropped: Schema.Boolean,
  maybeDeathTip: Schema.Option(DeathTip),
})
type EndCard = typeof EndCard.Type

const freshEndCard: EndCard = {
  shareSheet: 'Unavailable',
  maybeShareCopiedAtMs: Option.none(),
  isRunCardDropped: false,
  maybeDeathTip: Option.none(),
}

// NOTE: the build and how it reaches the player: a newer build waiting, the
// update gift, the install offer, and the tip jar's link.
const Release = Schema.Struct({
  maybeNewerBuild: Schema.Option(Schema.String),
  updateGift: UpdateGift,
  installOffer: InstallOffer,
  maybeSupportUrl: Schema.Option(Schema.String),
})
type Release = typeof Release.Type

const freshRelease: Release = {
  maybeNewerBuild: Option.none(),
  updateGift: 'Wrapped',
  installOffer: 'None',
  maybeSupportUrl: maybeSupportUrlOf(SUPPORT_URL),
}

// NOTE: what this run started from: the seed and the things its dare list
// rolled from, for beat my run's link (src/domain/beatMyRun.ts), and the
// teammate bots seated in it (src/domain/bots.ts), set as the run starts
// from the lobby's bots, so RETRY seats the same ones and a LEAVE clears
// them.
const RunStart = Schema.Struct({
  runSeed: Schema.Finite,
  runPool: Schema.Array(DareKind),
  crewBots: Schema.Array(Bot),
})
type RunStart = typeof RunStart.Type

const freshRunStart: RunStart = {
  runSeed: DEFAULT_SEED,
  runPool: [],
  crewBots: [],
}

// NOTE: the player's settings, saved and synced (saveOf and restoreSave in
// src/platform/save.ts), plus the screen's fit and full screen, which this
// device measures.
const Settings = Schema.Struct({
  soundSetting: SoundSetting,
  musicSetting: MusicSetting,
  screenFit: ScreenFit,
  fullscreen: FullscreenSetting,
  shakeSetting: ShakeSetting,
  rotationSetting: RotationSetting,
  rumbleSetting: RumbleSetting,
  recordRuns: RecordRunsSetting,
  shareStats: ShareStatsSetting,
  cursorSetting: CursorSetting,
})
type Settings = typeof Settings.Type

const freshSettings: Settings = {
  soundSetting: 'On',
  musicSetting: 'On',
  screenFit: 'Unknown',
  fullscreen: 'Off',
  shakeSetting: 'On',
  rotationSetting: 'Landscape',
  rumbleSetting: 'On',
  recordRuns: 'Off',
  shareStats: 'On',
  cursorSetting: 'Bold',
}

// NOTE: what the frame makes for drawing alone, from the World's events and
// its own random stream, never read by the step: particles, decals,
// popups, blasts, callouts, the hero tells' and actions' watches, a
// prize's flight, the cloche's lift, and the trap notice.
export const Cosmetics = Schema.Struct({
  particles: Schema.Array(Particle),
  decals: Schema.Array(Decal),
  dustCooldownMs: Schema.Finite,
  tellWatch: TellWatch,
  actionWatch: ActionWatch,
  popups: Schema.Array(Popup),
  blasts: Schema.Array(Blast),
  callouts: Schema.Array(Callout),
  levelCallouts: Schema.Array(LevelCallout),
  prizeFlight: PrizeFlight,
  clocheLift: ClocheLift,
  trapNotice: TrapNotice,
  cosmeticRngState: Schema.Finite,
})
export type Cosmetics = typeof Cosmetics.Type

export const freshCosmetics: Cosmetics = {
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  tellWatch: noTellWatch,
  actionWatch: noActionWatch,
  popups: [],
  blasts: [],
  callouts: [],
  levelCallouts: [],
  prizeFlight: PrizeFlight.Grounded(),
  clocheLift: ClocheLift.Resting(),
  trapNotice: TrapNotice.Quiet(),
  cosmeticRngState: cosmeticSeedOf(DEFAULT_SEED),
}

export const Model = Schema.Struct({
  ...World.fields,
  difficultyCard: DifficultyCard,
  shake: Shake,
  streak: Streak,
  bestStreak: Schema.Finite,
  maybeBreakIdleSinceMs: Schema.Option(Schema.Finite),
  trapHint: TrapHint,
  // NOTE: whether this device has watched the intro whole, saved, so later
  // runs open on the knock (src/world/run/arrival.ts).
  introSeen: SavedTrapHint,
  introSkip: IntroSkip,
  pocketCard: PocketCard,
  // NOTE: the dare's things the satchel on the opened card has shown, so
  // the ones found since drop in (src/features/dare/pocketCard.ts).
  dareSatchel: Schema.Array(DareKind),
  caseCard: CaseCard,
  kitchenCall: KitchenCall,
  dareHint: DareHint,
  firstBreakQuest: QuestTour,
  rattlesIntro: RattlesIntro,
  kitchenTour: Tour,
  stepCarryMs: Schema.Finite,
  input: Input,
  maybeSurface: Schema.Option(SurfaceRectangle),
  lastDevice: InputDevice,
  touchControls: TouchControls,
  orientation: Orientation,
  cameraLean: Vector,
  maybeFinisher: Schema.Option(Finisher),
  cameraGlide: CameraGlide,
  introducedKinds: Schema.Array(ZombieKind),
  seenPowerUps: Schema.Array(PickupKind),
  hintBand: HintBand,
  screenMs: Schema.Finite,
  runRecords: Schema.Array(RunRecord),
  audio: AudioState,
  homeScreenTip: HomeScreenTip,
  homeScreenSteps: DialogBlock.Model,
  pageVisibility: PageVisibility,
  // NOTE: keys whose keyup came with no keydown: a browser extension took
  // them first (see src/input/keyGrab.ts).
  missedKeyDowns: Schema.Finite,
  updateGreeting: DialogBlock.Model,
  appearance: Appearance,
  profile: Profile.Model,
  lobby: Lobby.Model,
  munchopedia: Munchopedia.Model,
  proofShelf: ProofShelf.Model,
  profileDialog: DialogBlock.Model,
  playerName: PlayerName,
  coop: Coop.Model,
  // NOTE: RECORD MY RUNS (src/platform/recording.ts): whether this device
  // shows it, and the run being recorded. The synced setting is in
  // `settings`.
  recordUnlock: RecordUnlock,
  recorder: RunRecorder,
  orientationLock: OrientationLock,
  // NOTE: players sharing this keyboard, from a dev-only `?local=N` link
  // (MULTIPLAYER.md, "What Phase 1 built"). 1 in every shipped build.
  localPlayers: Schema.Finite,
  // NOTE: beat my run (src/domain/beatMyRun.ts): a friend's dare from a
  // SHARE link, offered on the home menu or taken into the lobby. What this
  // run started from, for its own link, is in `runStart`.
  beatMyRun: BeatMyRun,
  maybeVisitId: Schema.Option(Schema.String),
  maybeHomeFocus: Schema.Option(HomeButton),
  panel: MenuPanel,
  maybeOpenHelpCard: Schema.Option(HelpCard),
  panelDialog: DialogBlock.Model,
  handDialog: DialogBlock.Model,
  bests: PlayerBests,
  rank: SavedRank,
  // NOTE: the Bones bonuses had once (src/world/heroes/rank.ts), saved and synced.
  bonuses: SavedBonuses,
  // NOTE: today's UTC day, from the Today Subscription
  // (src/platform/today.ts), so `update` never reads the clock. None until
  // the first arrives.
  maybeToday: Schema.Option(DayStamp),
  // NOTE: how the last run ended, saved and synced, and the line your
  // friends in the car say at this run's intro (src/features/intro/carLine.ts),
  // kept after it so the next is never the same line twice in a row.
  lastRunEnding: RunEnding,
  maybeCarLine: Schema.Option(Schema.String),
  // NOTE: the daily missions (src/features/missions/missions.ts): the
  // player's record of the day, saved and synced. What this run tallies
  // toward them, and the bars the end card shows, are in `runGains`.
  missions: SavedMissions,
  // NOTE: the Proof Shelf (src/features/proof/proof.ts): a slot per dare
  // thing per difficulty, each with the first run that found it, saved and
  // synced.
  proof: SavedProof,
  // NOTE: the Dare Journal (src/domain/journal.ts): the milestones reached
  // and what the journal's pages read, saved and synced. What this run
  // gathers toward it is in `runGains`.
  journal: SavedJournal,
  // NOTE: hero and gun mastery (src/domain/mastery.ts): each hero's points
  // and each gun's kills across every run, saved and synced. What this run
  // has paid into them and opened is in `runGains`.
  mastery: SavedMastery,
  // NOTE: the dare ladder (src/domain/dareMarks.ts): the best mark opened on
  // each difficulty, saved and synced. The mark picked for the next run is
  // the World's `dareMark`.
  dareMarks: SavedDareMarks,
  // NOTE: the calling picked for the next run (src/features/heroes/callingPick.ts). A run
  // starts with it only if its rank is reached.
  calling: Calling,
  // NOTE: the looks bought with Bones, by cosmetic id (src/domain/closet.ts). A gift
  // is owned by rank and is never here.
  boughtCosmetics: SavedBoughtCosmetics,
  // NOTE: the unlocks the player has seen (src/domain/unlocks.ts), saved and synced,
  // and the ones that wear a NEW badge right now: those reached and unseen
  // when the Look tab or the character picker last opened.
  seenUnlocks: SavedSeenUnlocks,
  freshUnlocks: Schema.Array(Schema.String),
  home: HomeMenu,
  saving: Saving,
  roomRun: RoomRun,
  runGains: RunGains,
  endCard: EndCard,
  release: Release,
  runStart: RunStart,
  settings: Settings,
  cosmetics: Cosmetics,
})
export type Model = typeof Model.Type

export const LOAD_STEPS: ReadonlyArray<LoadStep> = [
  'Save',
  'Styles',
  'Fonts',
  'FirstFrame',
  'Sprites',
]

const noDifficultyBests: DifficultyBests = {
  maybeFastestWinMs: Option.none(),
  maybeBestEndlessWave: Option.none(),
  maybeFurthestWave: Option.none(),
  maybeMostKills: Option.none(),
  maybeBestRun: Option.none(),
}

export const noBests: PlayerBests = {
  runsPlayed: 0,
  totalKills: 0,
  killsByKind: noKills,
  byDifficulty: {
    Easy: noDifficultyBests,
    Normal: noDifficultyBests,
    Hard: noDifficultyBests,
    Nightmare: noDifficultyBests,
  },
}

// NOTE: the fields a child Block owns, each started by its own init through
// its Binding (src/app/bindings.ts) when the root's init runs.
type ChildField =
  | 'homeScreenSteps'
  | 'updateGreeting'
  | 'profile'
  | 'lobby'
  | 'munchopedia'
  | 'proofShelf'
  | 'profileDialog'
  | 'coop'
  | 'panelDialog'
  | 'handDialog'

// NOTE: the root's own fields as a fresh game starts them. The root's init
// (src/app/main.ts) returns these, and the Bindings add each child's.
export type OwnModel = Omit<Model, ChildField>

export const initialModel: OwnModel = {
  phase: Phase.Ready(),
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  mode: RunMode.Campaign(),
  difficulty: { chosen: 'Normal', nightmare: 'Locked' },
  modifiers: noModifiers,
  easyBreakSeconds: 0,
  dareMark: 0,
  difficultyCard: DifficultyCard.Unseen(),
  zombies: [],
  bullets: [],
  lobs: [],
  nextEntityId: 0,
  fridge: shutFridge,
  pantry: barePantry,
  stove: freshStove(DEFAULT_SEED),
  crates: freshCrates(DEFAULT_SEED),
  keys: freshKeys(DEFAULT_SEED),
  dare: freshDare(DEFAULT_SEED),
  dareThings: [],
  gasValve: shutValve,
  stations: idleStations,
  cases: rollCases(DEFAULT_SEED, 'Normal'),
  elapsedMs: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  shake: stillShake,
  streak: Streak.Cold(),
  bestStreak: 0,
  traps: [],
  pickups: [],
  loot: freshLoot(DEFAULT_SEED),
  maybeBreakIdleSinceMs: Option.none(),
  trapHint: TrapHint.Unseen(),
  introSeen: 'Unseen',
  introSkip: 'Watching',
  pocketCard: PocketCard.Pocketed(),
  dareSatchel: [],
  caseCard: CaseCard.Hidden(),
  kitchenCall: KitchenCall.Quiet({ calledWave: 0 }),
  dareHint: quietDareHint,
  firstBreakQuest: QuestTour.Waiting(),
  rattlesIntro: RattlesIntro.Waiting(),
  kitchenTour: Tour.Waiting(),
  level: startingLevel,
  ovens: [],
  rngState: DEFAULT_SEED,
  stepCarryMs: 0,
  input: idleInput,
  maybeSurface: Option.none(),
  lastDevice: 'KeyboardMouse',
  touchControls: 'Allowed',
  orientation: 'Landscape',
  cameraLean: { x: 0, y: 0 },
  maybeFinisher: Option.none(),
  cameraGlide: STILL_GLIDE,
  lessons: freshLessons,
  practice: noPractice,
  debutCard: DebutCard.Hidden(),
  introducedKinds: [],
  seenPowerUps: [],
  hintBand: 'Top',
  stats: freshStats,
  screenMs: 0,
  runRecords: [],
  audio: AudioState.Locked(),
  homeScreenTip: 'Unseen',
  pageVisibility: 'Visible',
  missedKeyDowns: 0,
  appearance: defaultAppearance,
  playerName: '',
  recordUnlock: 'Locked',
  recorder: RunRecorder.Idle(),
  orientationLock: 'Unsupported',
  localPlayers: 1,
  beatMyRun: noBeatMyRun,
  party: Party.Solo(),
  seats: [soloState],
  maybeVisitId: Option.none(),
  maybeHomeFocus: Option.none(),
  panel: 'HowToPlay',
  maybeOpenHelpCard: Option.none(),
  bests: noBests,
  rank: noRank,
  bonuses: noBonuses,
  maybeToday: Option.none(),
  lastRunEnding: 'NoRunYet',
  maybeCarLine: Option.none(),
  missions: noMissions,
  proof: noProof,
  journal: noJournal,
  mastery: noMastery,
  dareMarks: noDareMarks,
  calling: 'You',
  boughtCosmetics: [],
  seenUnlocks: [],
  freshUnlocks: [],
  home: freshHomeMenu,
  saving: freshSaving,
  roomRun: freshRoomRun,
  runGains: freshRunGains,
  endCard: freshEndCard,
  release: freshRelease,
  runStart: freshRunStart,
  settings: freshSettings,
  cosmetics: freshCosmetics,
}
