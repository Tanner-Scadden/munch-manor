import { Option, Schema } from 'effect'

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
import { MunchopediaPage } from '../features/munchopedia/model'
import * as Profile from '../features/profile/model'
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
import { DialogState, closedDialog } from '../ui/dialog'
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

export const RoomRun = Schema.Struct({
  maybeRoomDifficulty: Schema.Option(Difficulty),
  maybeRoomModifiers: Schema.Option(Modifiers),
  maybeRoomDareMark: Schema.Option(Schema.Finite),
  maybeCrewRunKey: Schema.Option(Schema.String),
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
  introSeen: SavedTrapHint,
  introSkip: IntroSkip,
  pocketCard: PocketCard,
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
  homeScreenSteps: DialogState,
  pageVisibility: PageVisibility,
  missedKeyDowns: Schema.Finite,
  updateGreeting: DialogState,
  appearance: Appearance,
  profile: Profile.Model,
  lobby: Lobby.LobbyState,
  munchopediaPage: MunchopediaPage,
  profileDialog: DialogState,
  playerName: PlayerName,
  coop: Coop.Model,
  recordUnlock: RecordUnlock,
  recorder: RunRecorder,
  orientationLock: OrientationLock,
  localPlayers: Schema.Finite,
  beatMyRun: BeatMyRun,
  maybeVisitId: Schema.Option(Schema.String),
  maybeHomeFocus: Schema.Option(HomeButton),
  panel: MenuPanel,
  maybeOpenHelpCard: Schema.Option(HelpCard),
  panelDialog: DialogState,
  handDialog: DialogState,
  bests: PlayerBests,
  rank: SavedRank,
  bonuses: SavedBonuses,
  maybeToday: Schema.Option(DayStamp),
  lastRunEnding: RunEnding,
  maybeCarLine: Schema.Option(Schema.String),
  missions: SavedMissions,
  proof: SavedProof,
  journal: SavedJournal,
  mastery: SavedMastery,
  dareMarks: SavedDareMarks,
  calling: Calling,
  boughtCosmetics: SavedBoughtCosmetics,
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

export type OwnModel = Model

export const initialModel: OwnModel = {
  phase: Phase.Ready(),
  profile: Profile.initialModel,
  lobby: Lobby.initialLobby,
  homeScreenSteps: closedDialog,
  munchopediaPage: MunchopediaPage.List(),
  coop: Coop.initialModel,
  updateGreeting: closedDialog,
  profileDialog: closedDialog,
  panelDialog: closedDialog,
  handDialog: closedDialog,
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
