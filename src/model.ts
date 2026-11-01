import { Option, Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'

import { MANOR, startingLevel } from './arena'
import {
  AmmoTip,
  AudioState,
  Decal,
  DifficultyCard,
  FullscreenSetting,
  HOME_SCREEN_STEPS_ID,
  HintBand,
  HomeButton,
  HomeMenu,
  Input,
  InputDevice,
  InstallOffer,
  type LoadStep,
  Loading,
  LookPart,
  LookSection,
  MenuPanel,
  Orientation,
  OrientationLock,
  PageVisibility,
  Particle,
  PlayerBests,
  PrizeFlight,
  RankGain,
  RankPaid,
  RunTally,
  SHOP_DIALOG_ID,
  SHOP_TABS_ID,
  SaveStatus,
  ScreenFit,
  SurfaceRectangle,
  SyncedSaveState,
  TouchControls,
  Tour,
  TutorialReset,
  UPDATE_GREETING_ID,
  UpdateGift,
  cosmeticSeedOf,
  defaultAppearance,
  freshHomeMenu,
  freshLessons,
  idleInput,
  noRankPaid,
} from './clientSchema'
import { DEFAULT_SEED } from './constants'
import * as Coop from './coop/model'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { flowFieldToward } from './pathing'
import {
  Appearance,
  Calling,
  CursorSetting,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  RotationSetting,
  SavedBoughtCosmetics,
  SavedRank,
  SavedSeenUnlocks,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from './playerData'
import {
  LastRunSync,
  LinkFlow,
  PlayerChange,
  PlayerScopeStatus,
  SyncState,
} from './playerSync'
import { ProfileTabsBlock } from './profile'
import { noRank } from './rank'
import { ShopTabsBlock } from './shopTabs'
import { SUPPORT_URL, maybeSupportUrlOf } from './support'
import {
  Blast,
  Boss,
  Callout,
  CounterSale,
  DebutCard,
  type DifficultyBests,
  FIRST_SHOP_CATEGORY,
  Party,
  Phase,
  PickupKind,
  Popup,
  Purchase,
  RunMode,
  Shake,
  ShopChatter,
  ShopState,
  Streak,
  TrapHint,
  TrapNotice,
  Vector,
  World,
  ZombieKind,
  calmPacing,
  emptyTrapStock,
  emptyWallet,
  freshLoot,
  freshStats,
  idleBoosts,
  idleIntent,
  initialHitStop,
  initialPlayer,
  noKills,
  noPractice,
  shutFridge,
  stillShake,
} from './worldSchema'

export * from './clientSchema'
export * from './worldSchema'

// NOTE: the Look tab: which of its little tabs is showing, and a radio
// group per part. Not saved: it opens on Body each time.
export const CharacterPicker = Schema.Struct({
  section: LookSection,
  sections: SectionRadioGroupBlock.Model,
  body: PartRadioGroupBlock.Model,
  hairStyle: PartRadioGroupBlock.Model,
  hairColor: PartRadioGroupBlock.Model,
  skinTone: PartRadioGroupBlock.Model,
  shirtColor: PartRadioGroupBlock.Model,
  outfit: PartRadioGroupBlock.Model,
  print: PartRadioGroupBlock.Model,
  hat: PartRadioGroupBlock.Model,
  gunSkin: PartRadioGroupBlock.Model,
})
export type CharacterPicker = typeof CharacterPicker.Type

// NOTE: the Profile's tabs, in order. A new tab, such as Cosmetics or
// Stats, is one more literal here and one more entry in src/profile.ts.
export const ProfileTab = Schema.Literals([
  'Look',
  'Name',
  'Account',
  'Settings',
])
export type ProfileTab = typeof ProfileTab.Type

// NOTE: the last bit of juice the Profile played: a poof for a new look
// part, a slot-machine spin for a dice roll, or nothing.
export const ProfileFx = Schema.Literals(['Still', 'Poof', 'Spin'])
export type ProfileFx = typeof ProfileFx.Type

// NOTE: the last thing a Look tab option did, for the option to play: a look
// bought (a poof), or wanted with too few Bones or not reached yet (the price
// or the padlock shakes red). The count moves on every time, and the view
// reads only its parity, so the same cue twice in a row still replays.
export const ClosetCueKind = Schema.Literals([
  'Still',
  'Bought',
  'Worn',
  'Short',
])
export type ClosetCueKind = typeof ClosetCueKind.Type

const ClosetCue = Schema.Struct({
  part: LookPart,
  value: Schema.String,
  kind: ClosetCueKind,
  count: Schema.Number,
})

// NOTE: the Profile dialog: the open tab, the name as it is being typed,
// and the last effect. The view reads fxCount only for its parity, so the
// same effect twice in a row still replays. Its Dialog and Tabs are the
// root's `profileDialog` and `profileTabs`, where their Bindings attach.
// NOTE: the How to play cards (src/pauseHelp.ts). One card at a time shows
// its line of how to do it: the one focused or tapped last, until the
// panel closes.
export const HelpCard = Schema.Literals([
  'Move',
  'Aim',
  'Reload',
  'Swap',
  'Knife',
  'Shop',
  'Traps',
  'Goodies',
  'Leftovers',
  'Charge',
])
export type HelpCard = typeof HelpCard.Type

const ProfilePanel = Schema.Struct({
  tab: ProfileTab,
  nameDraft: Schema.String,
  fx: ProfileFx,
  fxCount: Schema.Number,
  closetCue: ClosetCue,
})
type ProfilePanel = typeof ProfilePanel.Type

// NOTE: whether the browser has a share sheet (navigator.share). SHARE
// opens it where there is one and copies the post everywhere else; the
// share event counts which (src/analytics.ts, SharePath).
export const ShareSheet = Schema.Literals(['Available', 'Unavailable'])
export type ShareSheet = typeof ShareSheet.Type

// NOTE: how a tap on SHARE ended: the sheet shared it or the player closed
// it, or the post went to the clipboard (no sheet, or a refused one), or
// nothing worked. Only Copied shows: SHARE flashes COPIED!.
export const ShareOutcome = Schema.Literals([
  'Shared',
  'Cancelled',
  'Copied',
  'Failed',
])
export type ShareOutcome = typeof ShareOutcome.Type

// NOTE: a record the run that just ended broke, for its NEW BEST: the
// deepest endless wave, or the fastest win (src/endBeat.ts).
export const RunRecord = Schema.Literals(['Wave', 'Time', 'Kills'])
export type RunRecord = typeof RunRecord.Type

export const Model = Schema.Struct({
  ...World.fields,
  difficultyCard: DifficultyCard,
  particles: Schema.Array(Particle),
  decals: Schema.Array(Decal),
  dustCooldownMs: Schema.Number,
  shopDialog: DialogBlock.Model,
  shopTabs: ShopTabsBlock.Model,
  shopChatter: ShopChatter,
  shake: Shake,
  popups: Schema.Array(Popup),
  streak: Streak,
  bestStreak: Schema.Number,
  blasts: Schema.Array(Blast),
  callouts: Schema.Array(Callout),
  prizeFlight: PrizeFlight,
  counterSale: CounterSale,
  trapHint: TrapHint,
  ammoTip: AmmoTip,
  firstBreakQuest: Tour,
  kitchenTour: Tour,
  trapNotice: TrapNotice,
  cosmeticRngState: Schema.Number,
  stepCarryMs: Schema.Number,
  input: Input,
  maybeSurface: Schema.Option(SurfaceRectangle),
  lastDevice: InputDevice,
  touchControls: TouchControls,
  orientation: Orientation,
  cameraLean: Vector,
  introducedKinds: Schema.Array(ZombieKind),
  seenPowerUps: Schema.Array(PickupKind),
  hintBand: HintBand,
  screenMs: Schema.Number,
  runRecords: Schema.Array(RunRecord),
  shareSheet: ShareSheet,
  maybeShareCopiedAtMs: Schema.Option(Schema.Number),
  isRunCardDropped: Schema.Boolean,
  audio: AudioState,
  soundSetting: SoundSetting,
  musicSetting: MusicSetting,
  screenFit: ScreenFit,
  fullscreen: FullscreenSetting,
  homeScreenTip: HomeScreenTip,
  homeScreenSteps: DialogBlock.Model,
  pageVisibility: PageVisibility,
  // NOTE: keys whose keyup came with no keydown: a browser extension took
  // them first (see src/keyGrab.ts).
  missedKeyDowns: Schema.Number,
  maybeNewerBuild: Schema.Option(Schema.String),
  updateGift: UpdateGift,
  updateGreeting: DialogBlock.Model,
  installOffer: InstallOffer,
  maybeSupportUrl: Schema.Option(Schema.String),
  appearance: Appearance,
  character: CharacterPicker,
  profile: ProfilePanel,
  profileDialog: DialogBlock.Model,
  profileTabs: ProfileTabsBlock.Model,
  playerName: PlayerName,
  coop: Coop.Model,
  shakeSetting: ShakeSetting,
  rotationSetting: RotationSetting,
  orientationLock: OrientationLock,
  // NOTE: players sharing this keyboard, from a dev-only `?local=N` link
  // (MULTIPLAYER.md, "What Phase 1 built"). 1 in every shipped build.
  localPlayers: Schema.Number,
  shareStats: ShareStatsSetting,
  cursorSetting: CursorSetting,
  maybeVisitId: Schema.Option(Schema.String),
  maybeHomeFocus: Schema.Option(HomeButton),
  panel: MenuPanel,
  maybeOpenHelpCard: Schema.Option(HelpCard),
  panelDialog: DialogBlock.Model,
  handDialog: DialogBlock.Model,
  bests: PlayerBests,
  runTally: RunTally,
  rankPaid: RankPaid,
  maybeRankGain: Schema.Option(RankGain),
  rank: SavedRank,
  // NOTE: the calling picked for the next run (src/callingPick.ts). A run
  // starts with it only if its rank is reached.
  calling: Calling,
  // NOTE: the looks bought with Bones, by cosmetic id (src/closet.ts). A gift
  // is owned by rank and is never here.
  boughtCosmetics: SavedBoughtCosmetics,
  // NOTE: the unlocks the player has seen (src/unlocks.ts), saved and synced,
  // and the ones that wear a NEW badge right now: those reached and unseen
  // when the Look tab or the character picker last opened.
  seenUnlocks: SavedSeenUnlocks,
  freshUnlocks: Schema.Array(Schema.String),
  // NOTE: the room's difficulty while an online co-op run is drawn, kept
  // with the run so its summary has it after the room is gone (a LEAVE).
  maybeRoomDifficulty: Schema.Option(Difficulty),
  // NOTE: the online co-op run's key, the same on every client in it, kept
  // with the run so its summary has it after the room is gone (a LEAVE).
  maybeCrewRunKey: Schema.Option(Schema.String),
  loading: Loading,
  saveStatus: SaveStatus,
  tutorialReset: TutorialReset,
  syncState: SyncState,
  playerScopeStatus: PlayerScopeStatus,
  lastRunSync: LastRunSync,
  writesInFlight: Schema.Number,
  unsavedChanges: Schema.Array(PlayerChange),
  syncedSave: SyncedSaveState,
  linkFlow: LinkFlow,
  home: HomeMenu,
})
export type Model = typeof Model.Type

const PROFILE_DIALOG_ID = 'profile'
const PROFILE_TABS_ID = 'profile-tabs'

// NOTE: a closed Dialog, Tabs, or RadioGroup has no Commands to run, so
// the Model takes each one's initial state as it is. The Bindings in
// src/composition.ts leave these fields to the root (`init: false`).
const closedDialog = (id: string) => DialogBlock.init({ id }).model

const closedProfile: ProfilePanel = {
  tab: 'Look',
  nameDraft: '',
  fx: 'Still',
  fxCount: 0,
  closetCue: { part: 'Hat', value: 'None', kind: 'Still', count: 0 },
}

const closedCharacterPicker: CharacterPicker = {
  section: 'Body',
  sections: SectionRadioGroupBlock.init({ id: 'look-sections' }).model,
  body: PartRadioGroupBlock.init({ id: 'look-body' }).model,
  hairStyle: PartRadioGroupBlock.init({ id: 'look-hair-style' }).model,
  hairColor: PartRadioGroupBlock.init({ id: 'look-hair-color' }).model,
  skinTone: PartRadioGroupBlock.init({ id: 'look-skin-tone' }).model,
  shirtColor: PartRadioGroupBlock.init({ id: 'look-shirt-color' }).model,
  outfit: PartRadioGroupBlock.init({ id: 'look-outfit' }).model,
  print: PartRadioGroupBlock.init({ id: 'look-print' }).model,
  hat: PartRadioGroupBlock.init({ id: 'look-hat' }).model,
  gunSkin: PartRadioGroupBlock.init({ id: 'look-gun-skin' }).model,
}

const PANEL_DIALOG_ID = 'menu-panel'
const HAND_DIALOG_ID = 'manor-hand'

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

export const initialModel: Model = {
  phase: Phase.Ready(),
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  mode: RunMode.Campaign(),
  difficulty: { chosen: 'Normal', nightmare: 'Locked' },
  difficultyCard: DifficultyCard.Unseen(),
  player: initialPlayer,
  zombies: [],
  bullets: [],
  lobs: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  nextEntityId: 0,
  wallet: emptyWallet,
  shop: ShopState.Away(),
  purchase: Purchase.Idle(),
  fridge: shutFridge,
  shopDialog: closedDialog(SHOP_DIALOG_ID),
  shopCategory: FIRST_SHOP_CATEGORY,
  shopTabs: ShopTabsBlock.init({ id: SHOP_TABS_ID }).model,
  shopChatter: ShopChatter.Greeting(),
  elapsedMs: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  shake: stillShake,
  popups: [],
  streak: Streak.Cold(),
  bestStreak: 0,
  blasts: [],
  traps: [],
  pickups: [],
  boosts: idleBoosts,
  loot: freshLoot(DEFAULT_SEED),
  callouts: [],
  prizeFlight: PrizeFlight.Grounded(),
  counterSale: CounterSale.Quiet(),
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  laserSight: 'None',
  trapHint: TrapHint.Unseen(),
  ammoTip: AmmoTip.Unseen(),
  firstBreakQuest: Tour.Waiting(),
  kitchenTour: Tour.Waiting(),
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  ovens: [],
  flowField: flowFieldToward(MANOR, initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(MANOR, initialPlayer, 'Wide', []),
  rngState: DEFAULT_SEED,
  cosmeticRngState: cosmeticSeedOf(DEFAULT_SEED),
  stepCarryMs: 0,
  input: idleInput,
  intent: idleIntent,
  maybeSurface: Option.none(),
  lastDevice: 'KeyboardMouse',
  touchControls: 'Allowed',
  orientation: 'Landscape',
  cameraLean: { x: 0, y: 0 },
  lessons: freshLessons,
  practice: noPractice,
  debutCard: DebutCard.Hidden(),
  introducedKinds: [],
  seenPowerUps: [],
  hintBand: 'Top',
  stats: freshStats,
  screenMs: 0,
  runRecords: [],
  shareSheet: 'Unavailable',
  maybeShareCopiedAtMs: Option.none(),
  isRunCardDropped: false,
  audio: AudioState.Locked(),
  soundSetting: 'On',
  musicSetting: 'On',
  screenFit: 'Unknown',
  fullscreen: 'Off',
  homeScreenTip: 'Unseen',
  homeScreenSteps: closedDialog(HOME_SCREEN_STEPS_ID),
  pageVisibility: 'Visible',
  missedKeyDowns: 0,
  maybeNewerBuild: Option.none(),
  updateGift: 'Wrapped',
  updateGreeting: closedDialog(UPDATE_GREETING_ID),
  installOffer: 'None',
  maybeSupportUrl: maybeSupportUrlOf(SUPPORT_URL),
  appearance: defaultAppearance,
  character: closedCharacterPicker,
  profile: closedProfile,
  profileDialog: closedDialog(PROFILE_DIALOG_ID),
  profileTabs: ProfileTabsBlock.init({ id: PROFILE_TABS_ID }).model,
  playerName: '',
  coop: Coop.initialModel,
  shakeSetting: 'On',
  rotationSetting: 'Landscape',
  orientationLock: 'Unsupported',
  localPlayers: 1,
  party: Party.Solo(),
  shareStats: 'On',
  cursorSetting: 'Bold',
  maybeVisitId: Option.none(),
  maybeHomeFocus: Option.none(),
  panel: 'HowToPlay',
  maybeOpenHelpCard: Option.none(),
  panelDialog: closedDialog(PANEL_DIALOG_ID),
  handDialog: closedDialog(HAND_DIALOG_ID),
  bests: noBests,
  runTally: RunTally.Uncounted(),
  rankPaid: noRankPaid,
  maybeRankGain: Option.none(),
  rank: noRank,
  calling: 'You',
  boughtCosmetics: [],
  seenUnlocks: [],
  freshUnlocks: [],
  maybeRoomDifficulty: Option.none(),
  maybeCrewRunKey: Option.none(),
  loading: Loading.Loaded(),
  saveStatus: 'Unread',
  tutorialReset: 'Idle',
  syncState: SyncState.LocalOnly(),
  playerScopeStatus: PlayerScopeStatus.Idle(),
  lastRunSync: LastRunSync.NoRun(),
  writesInFlight: 0,
  unsavedChanges: [],
  syncedSave: 'Current',
  linkFlow: LinkFlow.Idle(),
  home: freshHomeMenu,
}
