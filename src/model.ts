import { Option, Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'

import { startingLevel } from './arena'
import {
  AmmoTip,
  AudioState,
  Bot,
  Decal,
  DifficultyCard,
  FullscreenSetting,
  HintBand,
  HomeButton,
  HomeMenu,
  Input,
  InputDevice,
  InstallOffer,
  KitchenCall,
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
  SaveStatus,
  ScreenFit,
  ShopGuide,
  SurfaceRectangle,
  SyncedSaveState,
  TellWatch,
  TouchControls,
  Tour,
  TutorialReset,
  UpdateGift,
  cosmeticSeedOf,
  defaultAppearance,
  freshHomeMenu,
  freshLessons,
  idleInput,
  noRankPaid,
  noTellWatch,
} from './clientSchema'
import { DEFAULT_SEED } from './constants'
import * as Coop from './coop/model'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { Modifiers, noModifiers } from './modifiers'
import { soloState } from './party'
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
  Party,
  Phase,
  PickupKind,
  Popup,
  RunMode,
  Shake,
  ShopChatter,
  Streak,
  TrapHint,
  TrapNotice,
  Vector,
  World,
  ZombieKind,
  barePantry,
  calmPacing,
  freshLoot,
  freshStats,
  freshStove,
  initialHitStop,
  noKills,
  noPractice,
  shutFridge,
  shutValve,
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
  count: Schema.Finite,
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

// NOTE: a look for sale being tried on in the Look tab: shown on the
// figure and never worn, saved, or synced until it is bought.
const LookPreview = Schema.Struct({ part: LookPart, value: Schema.String })

const ProfilePanel = Schema.Struct({
  tab: ProfileTab,
  nameDraft: Schema.String,
  fx: ProfileFx,
  fxCount: Schema.Finite,
  closetCue: ClosetCue,
  maybePreview: Schema.Option(LookPreview),
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
  dustCooldownMs: Schema.Finite,
  tellWatch: TellWatch,
  shopDialog: DialogBlock.Model,
  shopTabs: ShopTabsBlock.Model,
  shopChatter: ShopChatter,
  shopGuide: ShopGuide,
  shake: Shake,
  popups: Schema.Array(Popup),
  streak: Streak,
  bestStreak: Schema.Finite,
  blasts: Schema.Array(Blast),
  callouts: Schema.Array(Callout),
  prizeFlight: PrizeFlight,
  counterSale: CounterSale,
  breakIdleMs: Schema.Finite,
  trapHint: TrapHint,
  ammoTip: AmmoTip,
  kitchenCall: KitchenCall,
  firstBreakQuest: Tour,
  kitchenTour: Tour,
  trapNotice: TrapNotice,
  cosmeticRngState: Schema.Finite,
  stepCarryMs: Schema.Finite,
  input: Input,
  maybeSurface: Schema.Option(SurfaceRectangle),
  lastDevice: InputDevice,
  touchControls: TouchControls,
  orientation: Orientation,
  cameraLean: Vector,
  introducedKinds: Schema.Array(ZombieKind),
  seenPowerUps: Schema.Array(PickupKind),
  hintBand: HintBand,
  screenMs: Schema.Finite,
  runRecords: Schema.Array(RunRecord),
  shareSheet: ShareSheet,
  maybeShareCopiedAtMs: Schema.Option(Schema.Finite),
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
  missedKeyDowns: Schema.Finite,
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
  localPlayers: Schema.Finite,
  // NOTE: the teammate bots seated in this run (src/bots.ts), set as the run
  // starts from the lobby's bots, so RETRY seats the same ones and a LEAVE
  // clears them.
  crewBots: Schema.Array(Bot),
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
  // NOTE: the room's modifiers, kept the same way (src/modifiers.ts).
  maybeRoomModifiers: Schema.Option(Modifiers),
  // NOTE: the online co-op run's key, the same on every client in it, kept
  // with the run so its summary has it after the room is gone (a LEAVE).
  maybeCrewRunKey: Schema.Option(Schema.String),
  loading: Loading,
  saveStatus: SaveStatus,
  tutorialReset: TutorialReset,
  syncState: SyncState,
  playerScopeStatus: PlayerScopeStatus,
  lastRunSync: LastRunSync,
  writesInFlight: Schema.Finite,
  unsavedChanges: Schema.Array(PlayerChange),
  syncedSave: SyncedSaveState,
  linkFlow: LinkFlow,
  home: HomeMenu,
})
export type Model = typeof Model.Type

const closedProfile: ProfilePanel = {
  tab: 'Look',
  nameDraft: '',
  fx: 'Still',
  fxCount: 0,
  closetCue: { part: 'Hat', value: 'None', kind: 'Still', count: 0 },
  maybePreview: Option.none(),
}

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

// NOTE: the fields a child Block owns, each started by its own init through
// its Binding (src/bindings.ts) when the root's init runs.
type ChildField =
  | 'shopDialog'
  | 'shopTabs'
  | 'homeScreenSteps'
  | 'updateGreeting'
  | 'character'
  | 'profileDialog'
  | 'profileTabs'
  | 'coop'
  | 'panelDialog'
  | 'handDialog'

// NOTE: the root's own fields as a fresh game starts them. The root's init
// (src/main.ts) returns these, and the Bindings add each child's.
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
  difficultyCard: DifficultyCard.Unseen(),
  zombies: [],
  bullets: [],
  lobs: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  tellWatch: noTellWatch,
  nextEntityId: 0,
  fridge: shutFridge,
  pantry: barePantry,
  stove: freshStove(DEFAULT_SEED),
  gasValve: shutValve,
  shopChatter: ShopChatter.Greeting(),
  shopGuide: ShopGuide.Closed(),
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
  loot: freshLoot(DEFAULT_SEED),
  callouts: [],
  prizeFlight: PrizeFlight.Grounded(),
  counterSale: CounterSale.Quiet(),
  breakIdleMs: 0,
  trapHint: TrapHint.Unseen(),
  ammoTip: AmmoTip.Unseen(),
  kitchenCall: KitchenCall.Quiet({ calledWave: 0 }),
  firstBreakQuest: Tour.Waiting(),
  kitchenTour: Tour.Waiting(),
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  ovens: [],
  rngState: DEFAULT_SEED,
  cosmeticRngState: cosmeticSeedOf(DEFAULT_SEED),
  stepCarryMs: 0,
  input: idleInput,
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
  pageVisibility: 'Visible',
  missedKeyDowns: 0,
  maybeNewerBuild: Option.none(),
  updateGift: 'Wrapped',
  installOffer: 'None',
  maybeSupportUrl: maybeSupportUrlOf(SUPPORT_URL),
  appearance: defaultAppearance,
  profile: closedProfile,
  playerName: '',
  shakeSetting: 'On',
  rotationSetting: 'Landscape',
  orientationLock: 'Unsupported',
  localPlayers: 1,
  crewBots: [],
  party: Party.Solo(),
  seats: [soloState],
  shareStats: 'On',
  cursorSetting: 'Bold',
  maybeVisitId: Option.none(),
  maybeHomeFocus: Option.none(),
  panel: 'HowToPlay',
  maybeOpenHelpCard: Option.none(),
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
  maybeRoomModifiers: Option.none(),
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
