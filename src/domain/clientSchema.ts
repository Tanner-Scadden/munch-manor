import { Option, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { MasterySkin } from '../shared/masteryData'
import { TutorialChoice } from '../shared/nameKeys'
import { Appearance, Calling } from '../shared/playerData'
import { DareKind } from '../world/dare/dareSchema'
import { MilestoneId } from '../world/dare/milestones'
import { BONE_BONUSES } from '../world/heroes/rank'
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

export const PrizeFlight = UiSchema.TaggedEnum({
  Grounded: {},
  Flying: { prize: WeaponKind, from: Vector, ageMs: Schema.Finite },
})
export type PrizeFlight = typeof PrizeFlight.Type

export const LevelCallout = Schema.Struct({
  weapon: WeaponKind,
  tier: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
  ageMs: MillisNumber,
})
export type LevelCallout = typeof LevelCallout.Type

export const ClocheLift = UiSchema.TaggedEnum({
  Resting: {},
  Lifting: { room: SlotRoomId, at: Vector, ageMs: Schema.Finite },
})
export type ClocheLift = typeof ClocheLift.Type

export const AudioState = UiSchema.TaggedEnum({
  Locked: {},
  Unlocking: {},
  Suspended: {},
  Ready: {},
  Unavailable: {},
})
export type AudioState = typeof AudioState.Type

export const UpdateGift = Schema.Literals(['Wrapped', 'Unwrapping'])
export type UpdateGift = typeof UpdateGift.Type

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

export const RunTally = UiSchema.TaggedEnum({
  Uncounted: {},
  Counted: { kills: KillCounts },
})
export type RunTally = typeof RunTally.Type

export const RankPaid = Schema.Struct({
  wavesPaid: Schema.Finite,
  bossesPaid: Schema.Finite,
  readyPaid: Schema.Finite,
  awardsPaid: Schema.Finite,
  revivesPaid: Schema.Finite,
})
export type RankPaid = typeof RankPaid.Type

export const noRankPaid: RankPaid = {
  wavesPaid: 0,
  bossesPaid: 0,
  readyPaid: 0,
  awardsPaid: 0,
  revivesPaid: 0,
}

const BoneBonus = Schema.Literals(BONE_BONUSES)

export const RankGain = Schema.Struct({
  pointsBefore: Schema.Finite,
  gained: Schema.Finite,
  bonesGained: Schema.Finite,
  bonusPercent: Schema.Finite,
  bonuses: Schema.Array(BoneBonus),
})
export type RankGain = typeof RankGain.Type

export const DeathTip = Schema.Struct({
  kind: ZombieKind,
  line: Schema.String,
})
export type DeathTip = typeof DeathTip.Type

export const HomeMode = Schema.Literals(['Campaign', 'Endless'])
export type HomeMode = typeof HomeMode.Type

export const Bot = Schema.Struct({
  name: Schema.String,
  calling: Calling,
  look: Appearance,
})
export type Bot = typeof Bot.Type

export const HomeMenu = Schema.Struct({
  mode: HomeMode,
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

export const Loading = UiSchema.TaggedEnum({
  Loading: { pending: Schema.Array(LoadStep) },
  Loaded: {},
})
export type Loading = typeof Loading.Type

export const SaveStatus = Schema.Literals(['Unread', 'Read'])
export type SaveStatus = typeof SaveStatus.Type

export const SyncedSaveState = Schema.Literals(['Current', 'Stale'])
export type SyncedSaveState = typeof SyncedSaveState.Type

export const DifficultyCard = UiSchema.TaggedEnum({
  Unseen: {},
  Asking: { mode: RunMode, tutorial: TutorialChoice },
  Seen: {},
})
export type DifficultyCard = typeof DifficultyCard.Type

export const PocketCard = UiSchema.TaggedEnum({
  Pocketed: {},
  Reading: { ageMs: Schema.Finite },
  Folding: { ageMs: Schema.Finite },
  Opened: { ageMs: Schema.Finite, fresh: Schema.Array(DareKind) },
})
export type PocketCard = typeof PocketCard.Type

export const CaseCard = UiSchema.TaggedEnum({
  Hidden: {},
  Showing: { caseId: Schema.Finite, ageMs: Schema.Finite },
})
export type CaseCard = typeof CaseCard.Type

export const IntroSkip = Schema.Literals(['Watching', 'Skipped'])
export type IntroSkip = typeof IntroSkip.Type

export const KitchenCall = UiSchema.TaggedEnum({
  Quiet: { calledWave: Schema.Finite },
  Calling: { wave: Schema.Finite, remainingMs: MillisNumber },
  Opened: { ageMs: MillisNumber },
})
export type KitchenCall = typeof KitchenCall.Type

export const DareHintCall = UiSchema.TaggedEnum({
  Quiet: {},
  Calling: {
    line: Schema.String,
    maybeThingId: Schema.Option(Schema.Finite),
    wave: Schema.Finite,
    isBreak: Schema.Boolean,
    endsAtMs: Schema.Finite,
  },
})
export type DareHintCall = typeof DareHintCall.Type
export type DareHintCalling = typeof DareHintCall.cases.Calling.Type

export const DareHint = Schema.Struct({
  calledWave: Schema.Finite,
  restMs: MillisNumber,
  lastLine: Schema.String,
  call: DareHintCall,
  maybeOpenRooms: Schema.Option(Schema.Array(Schema.String)),
})
export type DareHint = typeof DareHint.Type

export const quietDareHint: DareHint = {
  calledWave: 0,
  restMs: 0,
  lastLine: '',
  call: DareHintCall.Quiet(),
  maybeOpenRooms: Option.none(),
}

export const Tour = UiSchema.TaggedEnum({
  Waiting: {},
  Running: {},
  Done: { ageMs: MillisNumber },
  Over: {},
})
export type Tour = typeof Tour.Type

export const QuestTour = UiSchema.TaggedEnum({
  Waiting: {},
  Running: { isLockSeen: Schema.Boolean },
  Looking: { ageMs: MillisNumber },
  Starting: {},
  Done: { ageMs: MillisNumber },
  Over: {},
})
export type QuestTour = typeof QuestTour.Type

export const RattlesIntro = UiSchema.TaggedEnum({
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
  dareCard: Lesson.Pending(),
  gunLevel: Lesson.Pending(),
}

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
  propStyle: 'Stock',
}

export { TutorialChoice }

export const RunRecord = Schema.Literals(['Wave', 'Time', 'Kills'])
export type RunRecord = typeof RunRecord.Type

export const JournalRun = Schema.Struct({
  foundIn: Schema.Array(Schema.String),
  reached: Schema.Array(MilestoneId),
})
export type JournalRun = typeof JournalRun.Type

export const noJournalRun: JournalRun = { foundIn: [], reached: [] }

export const MasteryUnlock = UiSchema.TaggedEnum({
  HeroLevel: { calling: Calling, level: Schema.Finite },
  GunMastery: { kind: WeaponKind, skin: MasterySkin },
})
export type MasteryUnlock = typeof MasteryUnlock.Type

export const MasteryRun = Schema.Struct({
  wavesPaid: Schema.Finite,
  thingsPaid: Schema.Finite,
  killsPaid: Schema.Record(Schema.String, Schema.Finite),
  unlocks: Schema.Array(MasteryUnlock),
})
export type MasteryRun = typeof MasteryRun.Type

export const noMasteryRun: MasteryRun = {
  wavesPaid: 0,
  thingsPaid: 0,
  killsPaid: {},
  unlocks: [],
}
