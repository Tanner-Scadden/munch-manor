// The client's own Schemas beside the World's that no one feature owns: the
// home menu's state, loading, the bests, hints, the tours, and the dialog
// ids. A feature's own Schemas live in its folder (the input's in
// src/input/inputSchema.ts, the home menu's in
// src/features/home/homeSchema.ts, ...).
// src/app/model.ts re-exports them; the co-op room never imports this module.

import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { TutorialChoice } from '../shared/nameKeys'
import { Appearance, Calling } from '../shared/playerData'
import { MillisNumber } from '../world/schema/wireNumber'
import {
  DifficultyBests,
  KillCounts,
  Lesson,
  type Lessons,
  RunMode,
  SlotRoomId,
  Vector,
  WeaponKind,
  ZombieKind,
} from '../world/schema/worldSchema'

// NOTE: a cosmetic: a fridge weapon the player just took, flying from the
// fridge's door (`from`, in the world) into its HUD gun slot, which then
// pulses (src/features/fridge/fridgeReveal.ts). Never part of the World.
export const PrizeFlight = defineTaggedUnion({
  Grounded: {},
  Flying: { prize: WeaponKind, from: Vector, ageMs: Schema.Finite },
})
export type PrizeFlight = typeof PrizeFlight.Type

// NOTE: a cosmetic: the player's gun just reached a new tier on its kills
// (src/world/gear/gunLevels.ts), its new name and what changed popping over
// where the player stood (src/render/powerupView.ts). Never part of the World.
export const LevelCallout = Schema.Struct({
  weapon: WeaponKind,
  tier: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
  ageMs: MillisNumber,
})
export type LevelCallout = typeof LevelCallout.Type

// NOTE: a cosmetic: the cloche over a slot's doorway lifting as its boards
// come down, showing which room rolled in behind it (`at`, the doorway's
// middle in the world; src/features/cloche/clocheReveal.ts). Never part of
// the World.
export const ClocheLift = defineTaggedUnion({
  Resting: {},
  Lifting: { room: SlotRoomId, at: Vector, ageMs: Schema.Finite },
})
export type ClocheLift = typeof ClocheLift.Type

export const AudioState = defineTaggedUnion({
  Locked: {},
  Unlocking: {},
  Suspended: {},
  Ready: {},
  Unavailable: {},
})
export type AudioState = typeof AudioState.Type

// NOTE: the update gift on the home menu, wrapped until a tap unwraps it
// and the page reloads onto the newer build.
export const UpdateGift = Schema.Literals(['Wrapped', 'Unwrapping'])
export type UpdateGift = typeof UpdateGift.Type

// NOTE: the bests are kept in the on-device save (src/platform/save.ts): one set for
// each difficulty, plus the runs played and the zombies splatted in all and
// per kind. They are plain data on purpose: they move into the SQLite player
// scope from PLATFORM.md as personal bests.
export const PlayerBests = Schema.Struct({
  runsPlayed: Schema.Finite,
  totalKills: Schema.Finite,
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

// NOTE: what a run has already been paid in rank (src/features/end/rankRun.ts): the
// waves cleared, bosses felled, awards won, and revives made so far. A win that keeps going into
// endless is paid again when it ends, and only for what it did after.
export const RankPaid = Schema.Struct({
  wavesPaid: Schema.Finite,
  bossesPaid: Schema.Finite,
  awardsPaid: Schema.Finite,
  revivesPaid: Schema.Finite,
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
  pointsBefore: Schema.Finite,
  gained: Schema.Finite,
  bonesGained: Schema.Finite,
  // NOTE: the run modifiers' bonus in percent, 0 with none (src/world/run/modifiers.ts).
  bonusPercent: Schema.Finite,
})
export type RankGain = typeof RankGain.Type

// HOME MENU

export const HomeMode = Schema.Literals(['Campaign', 'Endless'])
export type HomeMode = typeof HomeMode.Type

// NOTE: a teammate bot of the single player lobby (src/domain/bots.ts): a goofy
// name, the hero it plays, and the look it wears. Bots are seats in the
// run's World, driven by src/features/bots/teammateBot.ts.
export const Bot = Schema.Struct({
  name: Schema.String,
  calling: Calling,
  look: Appearance,
})
export type Bot = typeof Bot.Type

// NOTE: the home menu's own state. The mode toggle and the What's New page
// last for the page session (the Munchopedia's page is its own Block's,
// src/features/munchopedia/). The newest What's New day seen and the Munchopedia
// entries opened are kept in the on-device save (src/platform/save.ts). newEntries are
// the kinds unlocked by the last counted run, for the NEW ENTRY pop.
export const HomeMenu = Schema.Struct({
  mode: HomeMode,
  // NOTE: the bots the lobby seats, kept for the page session: the lobby
  // (src/features/lobby/) hands them back when it closes, and a run seats
  // them.
  bots: Schema.Array(Bot),
  maybeSeenNewsDay: Schema.Option(Schema.String),
  newsPage: Schema.Finite,
  openedEntries: Schema.Array(ZombieKind),
  isTurnHintSeen: Schema.Boolean,
  newEntries: Schema.Array(ZombieKind),
})
export type HomeMenu = typeof HomeMenu.Type

export const freshHomeMenu: HomeMenu = {
  mode: 'Campaign',
  bots: [],
  maybeSeenNewsDay: Option.none(),
  newsPage: 0,
  openedEntries: [],
  isTurnHintSeen: false,
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

// NOTE: the first PLAY or ENDLESS of the session asks for a difficulty.
// Asking holds the mode to start once one is picked, and whether to play
// the tutorial.
export const DifficultyCard = defineTaggedUnion({
  Unseen: {},
  Asking: { mode: RunMode, tutorial: TutorialChoice },
  Seen: {},
})
export type DifficultyCard = typeof DifficultyCard.Type

// NOTE: the dare card in your pocket after the slam
// (src/features/dare/pocketCard.ts): in the pocket, out and being read, or
// folding itself into the HUD's dare card.
export const PocketCard = defineTaggedUnion({
  Pocketed: {},
  Reading: { ageMs: Schema.Finite },
  Folding: { ageMs: Schema.Finite },
})
export type PocketCard = typeof PocketCard.Type

// NOTE: the card a display case raises the first time a player walks up to
// one in a break (src/features/onboarding/caseCard.ts): put away, or up
// over the case with the id `caseId`.
export const CaseCard = defineTaggedUnion({
  Hidden: {},
  Showing: { caseId: Schema.Finite, ageMs: Schema.Finite },
})
export type CaseCard = typeof CaseCard.Type

// NOTE: the intro's skip in this run (src/features/intro/introBeat.ts): in
// co-op only the client's drawing skips, to the knock, and waits there for
// the room's slam.
export const IntroSkip = Schema.Literals(['Watching', 'Skipped'])
export type IntroSkip = typeof IntroSkip.Type

// NOTE: Rattles' holler about the boarded kitchen (src/features/kitchen/kitchenCall.ts):
// once a break, until the boards are open, a bubble points at them for a
// few seconds. `Quiet` remembers the last break it called in, so a break is
// never called twice. `Opened` is the kitchen found, aging for the rooms
// counter's sparkle (src/features/kitchen/roomsFound.ts). Never saved.
export const KitchenCall = defineTaggedUnion({
  Quiet: { calledWave: Schema.Finite },
  Calling: { wave: Schema.Finite, remainingMs: MillisNumber },
  Opened: { ageMs: MillisNumber },
})
export type KitchenCall = typeof KitchenCall.Type

// NOTE: Rattles' hints about the dare (src/features/dare/rattlesHint.ts): a
// line in his bubble for a few seconds, pointing at a thing on the list by
// its id or hanging from his spot. `calledWave` is the last break he called
// in, `restMs` Easy's wait before the next call in the same break, and
// `lastLine` what the player saw last, so it never comes twice in a row. Never saved.
export const DareHintCall = defineTaggedUnion({
  Quiet: {},
  Calling: {
    line: Schema.String,
    maybeThingId: Schema.Option(Schema.Finite),
    wave: Schema.Finite,
    isBreak: Schema.Boolean,
    remainingMs: MillisNumber,
  },
})
export type DareHintCall = typeof DareHintCall.Type
export type DareHintCalling = typeof DareHintCall.Calling.Type

export const DareHint = Schema.Struct({
  calledWave: Schema.Finite,
  restMs: MillisNumber,
  lastLine: Schema.String,
  call: DareHintCall,
})
export type DareHint = typeof DareHint.Type

export const quietDareHint: DareHint = {
  calledWave: 0,
  restMs: 0,
  lastLine: '',
  call: DareHintCall.Quiet(),
}

// NOTE: a chapter of the guided tutorial (src/features/onboarding/firstBreakQuest.ts, the
// first break, and src/features/onboarding/kitchenTour.ts, the kitchen and the fridge): waiting
// for its break, running through its steps, done with its tick shown for a
// moment, or over for this session.
export const Tour = defineTaggedUnion({
  Waiting: {},
  Running: {},
  Done: { ageMs: MillisNumber },
  Over: {},
})
export type Tour = typeof Tour.Type

// NOTE: the guided first break (src/features/onboarding/firstBreakQuest.ts),
// a Tour with one more stretch: once the key, the padlock, and the case are
// done, it points at the dare card on the HUD for a moment (`Looking`)
// before it ticks off. `isLockSeen` keeps the padlock step done once the
// player has walked up to it, wherever they go after.
export const QuestTour = defineTaggedUnion({
  Waiting: {},
  Running: { isLockSeen: Schema.Boolean },
  Looking: { ageMs: MillisNumber },
  Done: { ageMs: MillisNumber },
  Over: {},
})
export type QuestTour = typeof QuestTour.Type

// NOTE: Rattles' hello (src/features/onboarding/rattlesIntro.ts): waiting
// for the break he meets a player in, talking through his few lines from
// his trunk by the front door, or over for this run.
export const RattlesIntro = defineTaggedUnion({
  Waiting: {},
  Talking: { ageMs: MillisNumber },
  Over: {},
})
export type RattlesIntro = typeof RattlesIntro.Type

export const HintBand = Schema.Literals(['Top', 'Bottom'])
export type HintBand = typeof HintBand.Type

export const HOME_SCREEN_STEPS_ID = 'home-screen-steps'

export const UPDATE_GREETING_ID = 'update-greeting'

export const PROFILE_DIALOG_ID = 'profile'

export const PANEL_DIALOG_ID = 'menu-panel'

export const HAND_DIALOG_ID = 'manor-hand'

export const freshLessons: Lessons = {
  move: Lesson.Pending(),
  fire: Lesson.Pending(),
  startWave: Lesson.Pending(),
  swap: Lesson.Pending(),
  pickup: Lesson.Pending(),
  timedBreaks: Lesson.Pending(),
  openBreak: Lesson.Pending(),
  dareTour: Lesson.Pending(),
  dareKey: Lesson.Pending(),
  rattles: Lesson.Pending(),
  displayCase: Lesson.Pending(),
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

export { TutorialChoice }

// NOTE: a record the run that just ended broke, for its NEW BEST: the
// deepest endless wave, or the fastest win (src/features/end/endBeat.ts).
export const RunRecord = Schema.Literals(['Wave', 'Time', 'Kills'])
export type RunRecord = typeof RunRecord.Type
