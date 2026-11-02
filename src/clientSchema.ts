// The client's own Schemas beside the World's: input devices, particles and
// decals, the home menu, loading, the bests, hints, and the dialog ids.
// src/model.ts re-exports them; the co-op room never imports this module.

import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Appearance, Calling } from './playerData'
import { MillisNumber } from './wireNumber'
import {
  DifficultyBests,
  KillCounts,
  Lesson,
  type Lessons,
  ParticleKind,
  RunMode,
  Vector,
  WeaponKind,
  ZombieKind,
} from './worldSchema'

export const SurfaceRectangle = Schema.Struct({
  left: Schema.Number,
  top: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type SurfaceRectangle = typeof SurfaceRectangle.Type

export const Stick = defineTaggedUnion({
  Idle: {},
  Active: {
    pointerId: Schema.Number,
    originX: Schema.Number,
    originY: Schema.Number,
    currentX: Schema.Number,
    currentY: Schema.Number,
  },
})
export type Stick = typeof Stick.Type

export const MouseButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Number },
})
export type MouseButton = typeof MouseButton.Type

// NOTE: a finger holding the touch HUD's hold-to-buy button, by its pointer,
// so lifting that finger lets go and no other finger does.
export const HoldButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Number },
})
export type HoldButton = typeof HoldButton.Type

export const PointerDevice = Schema.Literals(['Mouse', 'Touch'])
export type PointerDevice = typeof PointerDevice.Type

export const InputDevice = Schema.Literals(['KeyboardMouse', 'Touch'])
export type InputDevice = typeof InputDevice.Type

export const TouchControls = Schema.Literals(['Allowed', 'Blocked'])
export type TouchControls = typeof TouchControls.Type

export const Orientation = Schema.Literals(['Landscape', 'Portrait'])
export type Orientation = typeof Orientation.Type

// NOTE: what the click after a press on a HUD gun or knife slot does. A
// mouse press there mid-wave is a shot at the world beneath, so its click
// passes through; a touch, or a mouse outside a wave, acts on the slot.
export const SlotClick = Schema.Literals(['Acts', 'PassesThrough'])
export type SlotClick = typeof SlotClick.Type

export const Input = Schema.Struct({
  pressedKeys: Schema.Array(Schema.String),
  maybeMouseInView: Schema.Option(Vector),
  mouseButton: MouseButton,
  moveStick: Stick,
  aimStick: Stick,
  holdButton: HoldButton,
  slotClick: SlotClick,
})
export type Input = typeof Input.Type

export const Particle = Schema.Struct({
  kind: ParticleKind,
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number,
  velocityX: Schema.Number,
  velocityY: Schema.Number,
  velocityZ: Schema.Number,
  size: Schema.Number,
  remainingMs: MillisNumber,
})
export type Particle = typeof Particle.Type

export const DecalKind = Schema.Literals([
  'Blood',
  'Meat',
  'Rot',
  'Shell',
  'Hull',
  'Bone',
  'Hide',
  'Goo',
  'Scorch',
  'Wood',
  'Clip',
  'GreenLimb',
  'GreenScalp',
  'HairScalp',
  'BlueLimb',
  'BlueChunk',
  'BombShard',
  'LimeLimb',
  'RedCap',
  'PinkLimb',
  'PinkChunk',
  'TealLimb',
  'TealScalp',
  'PaleScalp',
  'PotLid',
  'StopSign',
  'Bucket',
])
export type DecalKind = typeof DecalKind.Type

export const Decal = Schema.Struct({
  kind: DecalKind,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type Decal = typeof Decal.Type

// NOTE: a cosmetic: a fridge weapon the player just took, flying from the
// fridge's door (`from`, in the world) into its HUD gun slot, which then
// pulses (src/fridgeReveal.ts). Never part of the World.
export const PrizeFlight = defineTaggedUnion({
  Grounded: {},
  Flying: { prize: WeaponKind, from: Vector, ageMs: Schema.Number },
})
export type PrizeFlight = typeof PrizeFlight.Type

export const AudioState = defineTaggedUnion({
  Locked: {},
  Unlocking: {},
  Suspended: {},
  Ready: {},
  Unavailable: {},
})
export type AudioState = typeof AudioState.Type

// NOTE: whether this device can lock how the page turns: a touch screen
// whose browser has screen.orientation.lock. Desktops and iPhones cannot.
export const OrientationLock = Schema.Literals(['Supported', 'Unsupported'])
export type OrientationLock = typeof OrientationLock.Type

export const ScreenFit = Schema.Literals([
  'Unknown',
  'Fullscreen',
  'HomeScreen',
  'Installed',
  'Unavailable',
])
export type ScreenFit = typeof ScreenFit.Type

// NOTE: whether the browser offered to install the game: Chrome's
// beforeinstallprompt, held by src/install.ts until the install tile asks.
export const InstallOffer = Schema.Literals(['None', 'Ready', 'Installed'])
export type InstallOffer = typeof InstallOffer.Type

export const InstallOutcome = Schema.Literals([
  'Accepted',
  'Dismissed',
  'Unavailable',
])
export type InstallOutcome = typeof InstallOutcome.Type

// NOTE: the update gift on the home menu, wrapped until a tap unwraps it
// and the page reloads onto the newer build.
export const UpdateGift = Schema.Literals(['Wrapped', 'Unwrapping'])
export type UpdateGift = typeof UpdateGift.Type

export const FullscreenSetting = Schema.Literals(['Off', 'On'])
export type FullscreenSetting = typeof FullscreenSetting.Type

export const HomeButton = Schema.Literals([
  'Play',
  'Coop',
  'Manor',
  'Support',
  'Settings',
])
export type HomeButton = typeof HomeButton.Type

// NOTE: the cards the MANOR button deals. Code links to the game's public
// source on GitHub. The tip jar's coffee is not a card: it stands in the
// home menu's corner (HomeButton Support).
export const HandCard = Schema.Literals([
  'Character',
  'Munchopedia',
  'WhatsNew',
  'HowToPlay',
  'Code',
])
export type HandCard = typeof HandCard.Type

export const MenuPanel = Schema.Literals([
  'HowToPlay',
  'LeaveRun',
  'Difficulty',
  'Calling',
  'WhatsNew',
  'Munchopedia',
])
export type MenuPanel = typeof MenuPanel.Type

// NOTE: the bests are kept in the on-device save (src/save.ts): one set for
// each difficulty, plus the runs played and the zombies splatted in all and
// per kind. They are plain data on purpose: they move into the SQLite player
// scope from PLATFORM.md as personal bests.
export const PlayerBests = Schema.Struct({
  runsPlayed: Schema.Number,
  totalKills: Schema.Number,
  killsByKind: KillCounts,
  byDifficulty: Schema.Struct({
    Easy: DifficultyBests,
    Normal: DifficultyBests,
    Hard: DifficultyBests,
    Nightmare: DifficultyBests,
  }),
})
export type PlayerBests = typeof PlayerBests.Type

// NOTE: a run is added to the bests when it ends. Counted holds the kills
// already added, so a win that goes on into endless adds only its new kills
// when it ends again.
export const RunTally = defineTaggedUnion({
  Uncounted: {},
  Counted: { kills: KillCounts },
})
export type RunTally = typeof RunTally.Type

// NOTE: what a run has already been paid in rank (src/rankRun.ts): the
// waves cleared, bosses felled, awards won, and revives made so far. A win that keeps going into
// endless is paid again when it ends, and only for what it did after.
export const RankPaid = Schema.Struct({
  wavesPaid: Schema.Number,
  bossesPaid: Schema.Number,
  awardsPaid: Schema.Number,
  revivesPaid: Schema.Number,
})
export type RankPaid = typeof RankPaid.Type

export const noRankPaid: RankPaid = {
  wavesPaid: 0,
  bossesPaid: 0,
  awardsPaid: 0,
  revivesPaid: 0,
}

// NOTE: what the run on the end card paid, for its rank strip: the total
// points before it (so the bar fills from there), the points it paid, and
// the Bones.
export const RankGain = Schema.Struct({
  pointsBefore: Schema.Number,
  gained: Schema.Number,
  bonesGained: Schema.Number,
})
export type RankGain = typeof RankGain.Type

// HOME MENU

export const HomeMode = Schema.Literals(['Campaign', 'Endless'])
export type HomeMode = typeof HomeMode.Type

// NOTE: the single player lobby PLAY opens (src/lobby.ts): the settings of
// a run before it starts. It is a screen of the home menu, so a run that
// starts or a way home leaves it Closed.
export const HomeLobby = Schema.Literals(['Closed', 'Open'])
export type HomeLobby = typeof HomeLobby.Type

// NOTE: the maps a run can be played on (src/lobby.ts). One for now.
export const MapId = Schema.Literals(['Manor'])
export type MapId = typeof MapId.Type

// NOTE: every control the lobby's arrow keys walk, in order: BACK, the hero
// card, each crew seat (a + BOT tile, or a bot's hero card with its x), the
// two modes, the four difficulties, then START.
export const LobbyControl = Schema.Literals([
  'Back',
  'Hero',
  'Bot1',
  'Drop1',
  'Bot2',
  'Drop2',
  'Bot3',
  'Drop3',
  'Campaign',
  'Endless',
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
  'Start',
])
export type LobbyControl = typeof LobbyControl.Type

// NOTE: a teammate bot of the single player lobby (src/bots.ts): a goofy
// name, the hero it plays, and the look it wears. Bots are seats in the
// run's World, driven by src/teammateBot.ts.
export const Bot = Schema.Struct({
  name: Schema.String,
  calling: Calling,
  look: Appearance,
})
export type Bot = typeof Bot.Type

export const MunchopediaPage = defineTaggedUnion({
  List: {},
  Entry: { kind: ZombieKind },
})
export type MunchopediaPage = typeof MunchopediaPage.Type

// NOTE: the home menu's own state. The mode toggle and the open pages last
// for the page session. The newest What's New day seen and the Munchopedia
// entries opened are kept in the on-device save (src/save.ts). newEntries are
// the kinds unlocked by the last counted run, for the NEW ENTRY pop.
export const HomeMenu = Schema.Struct({
  mode: HomeMode,
  lobby: HomeLobby,
  maybeLobbyFocus: Schema.Option(LobbyControl),
  // NOTE: the bots the lobby seats, kept for the page session, and the one
  // whose hero the open picker is choosing (an index into them).
  bots: Schema.Array(Bot),
  maybePickingBot: Schema.Option(Schema.Number),
  // NOTE: the hero for sale being tried on in the picker (its BUY pill buys
  // it), never saved.
  maybeTryingCalling: Schema.Option(Calling),
  maybeSeenNewsDay: Schema.Option(Schema.String),
  newsPage: Schema.Number,
  munchopediaPage: MunchopediaPage,
  openedEntries: Schema.Array(ZombieKind),
  newEntries: Schema.Array(ZombieKind),
})
export type HomeMenu = typeof HomeMenu.Type

export const freshHomeMenu: HomeMenu = {
  mode: 'Campaign',
  lobby: 'Closed',
  maybeLobbyFocus: Option.none(),
  bots: [],
  maybePickingBot: Option.none(),
  maybeTryingCalling: Option.none(),
  maybeSeenNewsDay: Option.none(),
  newsPage: 0,
  munchopediaPage: MunchopediaPage.List(),
  openedEntries: [],
  newEntries: [],
}

export const LoadStep = Schema.Literals([
  'Save',
  'Styles',
  'Fonts',
  'FirstFrame',
  'Sprites',
])
export type LoadStep = typeof LoadStep.Type

export const Loading = defineTaggedUnion({
  Loading: { pending: Schema.Array(LoadStep) },
  Loaded: {},
})
export type Loading = typeof Loading.Type

// NOTE: nothing is written until the save has been read, so the defaults
// from before the load never overwrite a player's save.
export const SaveStatus = Schema.Literals(['Unread', 'Read'])
export type SaveStatus = typeof SaveStatus.Type

// NOTE: a save from sync that arrived while this device was still writing
// its own change is Stale: taking it would undo that change for a moment.
// The store's view is read again once the writes land.
export const SyncedSaveState = Schema.Literals(['Current', 'Stale'])
export type SyncedSaveState = typeof SyncedSaveState.Type

export const TutorialReset = Schema.Literals(['Idle', 'Asking', 'Done'])
export type TutorialReset = typeof TutorialReset.Type

export const PageVisibility = Schema.Literals(['Visible', 'Hidden'])
export type PageVisibility = typeof PageVisibility.Type

export const LookPart = Schema.Literals([
  'Body',
  'HairStyle',
  'HairColor',
  'SkinTone',
  'ShirtColor',
  'Outfit',
  'Print',
  'Hat',
  'GunSkin',
])
export type LookPart = typeof LookPart.Type

// NOTE: the look's two on and off parts, each one tap.
export const LookToggle = Schema.Literals(['Beard', 'Glasses'])
export type LookToggle = typeof LookToggle.Type

// NOTE: the Look tab's little tabs: the body, skin, beard, and glasses; the
// hair; the outfit; and the gear, a hat and a gun skin.
export const LookSection = Schema.Literals(['Body', 'Hair', 'Outfit', 'Gear'])
export type LookSection = typeof LookSection.Type

// NOTE: the first PLAY or ENDLESS of the session asks for a difficulty.
// Asking holds the mode to start once one is picked.
export const DifficultyCard = defineTaggedUnion({
  Unseen: {},
  Asking: { mode: RunMode },
  Seen: {},
})
export type DifficultyCard = typeof DifficultyCard.Type

// NOTE: Rattles' call about ammo: the first time a gun that can run dry
// runs low, a bubble from the stall shows a coin and a box of rounds for a
// few seconds. Once seen it never shows again, saved on the device.
export const AmmoTip = defineTaggedUnion({
  Unseen: {},
  Showing: { remainingMs: MillisNumber },
  Seen: {},
})
export type AmmoTip = typeof AmmoTip.Type

// NOTE: a chapter of the guided tutorial (src/firstBreakQuest.ts, the
// first break, and src/kitchenTour.ts, the kitchen and the fridge): waiting
// for its break, running through its steps, done with its tick shown for a
// moment, or over for this session.
export const Tour = defineTaggedUnion({
  Waiting: {},
  Running: {},
  Done: { ageMs: MillisNumber },
  Over: {},
})
export type Tour = typeof Tour.Type

export const HintBand = Schema.Literals(['Top', 'Bottom'])
export type HintBand = typeof HintBand.Type

export const SHOP_DIALOG_ID = 'shop'

export const HOME_SCREEN_STEPS_ID = 'home-screen-steps'

export const UPDATE_GREETING_ID = 'update-greeting'

export const SHOP_TABS_ID = 'shop-tabs'

export const idleInput: Input = {
  pressedKeys: [],
  maybeMouseInView: Option.none(),
  mouseButton: MouseButton.Released(),
  moveStick: Stick.Idle(),
  aimStick: Stick.Idle(),
  holdButton: HoldButton.Released(),
  slotClick: 'Acts',
}

export const freshLessons: Lessons = {
  move: Lesson.Pending(),
  fire: Lesson.Pending(),
  startWave: Lesson.Pending(),
  shop: Lesson.Pending(),
  swap: Lesson.Pending(),
  pickup: Lesson.Pending(),
  timedBreaks: Lesson.Pending(),
  openBreak: Lesson.Pending(),
}

// NOTE: particles, shake, popups, coin bursts, trap dust, and the random
// look draw from their own stream, never from `rngState`, so how many
// cosmetics a frame makes never changes what spawns next. A room that makes
// none and a phone that makes fewer play the same game (MULTIPLAYER.md).
const COSMETIC_SEED_SALT = 0x0c05e71c

export const cosmeticSeedOf = (seed: number): number =>
  (seed ^ COSMETIC_SEED_SALT) >>> 0

export const defaultAppearance: Appearance = {
  body: 'Broad',
  hairStyle: 'Short',
  hairColor: 'Brown',
  skinTone: 'Light',
  shirtColor: 'Blue',
  outfit: 'Tee',
  print: 'Plain',
  beard: false,
  glasses: false,
  hat: 'None',
  gunSkin: 'Stock',
}

// NOTE: what the hero tells (src/heroTells.ts) saw of the World last frame,
// to see what changed in it: each trap's health (a rise is a repair) and
// each seat's earnings (a rise beside a kill is a kill paid). A cosmetic of
// the client's own, so the room's World needs nothing new for it.
export const TellWatch = Schema.Struct({
  traps: Schema.Array(Schema.Struct({ id: Schema.Number, hp: Schema.Number })),
  earned: Schema.Array(
    Schema.Struct({ slot: Schema.Number, earned: Schema.Number }),
  ),
})
export type TellWatch = typeof TellWatch.Type

export const noTellWatch: TellWatch = { traps: [], earned: [] }
