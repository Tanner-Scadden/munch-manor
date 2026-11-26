import { Option, Schema } from 'effect'

import { InputDevice } from '../../input/inputSchema'
import {
  FullscreenSetting,
  OrientationLock,
  ScreenFit,
} from '../../platform/deviceSchema'
import {
  LastRunSync,
  LinkFlow,
  PlayerScopeStatus,
  SyncState,
} from '../../platform/playerSync'
import { SavedMastery } from '../../shared/masteryData'
import {
  Appearance,
  Calling,
  CursorSetting,
  MusicSetting,
  RecordRunsSetting,
  RecordUnlock,
  RotationSetting,
  RumbleSetting,
  SavedBoughtCosmetics,
  SavedRank,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from '../../shared/playerData'
import { ClosetCue, LookPreview, ProfileFx } from './blocks/look/model'

const TutorialReset = Schema.Literals(['Idle', 'Asking', 'Done'])

// NOTE: the Profile's tabs, in order. A new tab, such as Cosmetics or
// Stats, is one more literal here and one more entry in PROFILE_TABS
// (src/features/profile/profile.ts).
export const ProfileTab = Schema.Literals([
  'Look',
  'Name',
  'Account',
  'Settings',
  'Mastery',
])
export type ProfileTab = typeof ProfileTab.Type

// NOTE: what the root made of a Look tab pick (src/app/update/profile.ts):
// left as it was, worn, tried on, refused as a gift not reached yet, bought,
// or wanted with too few Bones. Each plays its own try-on, poof, or cue.
export const LookOutcome = Schema.Literals([
  'Stay',
  'Wear',
  'Preview',
  'Locked',
  'Bought',
  'Short',
])
export type LookOutcome = typeof LookOutcome.Type

// NOTE: the Profile panel's state, on the root's Model (`profile`): the open
// tab, the name as it is being typed, the last effect and the Look tab's cue
// and try-on, the device link flow with the times its code was copied, and
// the tutorial reset's question. The root owns it, since its rules, its
// menu state, and the dialog's close read it, and the link flow outlives the
// panel being drawn; the Profile component draws it from its props. The
// view reads fxCount only for its parity, so the same effect twice in a row
// still replays.
export const Model = Schema.Struct({
  tab: ProfileTab,
  nameDraft: Schema.String,
  fx: ProfileFx,
  fxCount: Schema.Finite,
  closetCue: ClosetCue,
  maybePreview: Schema.Option(LookPreview),
  linkFlow: LinkFlow,
  linkCodeCopies: Schema.Finite,
  tutorialReset: TutorialReset,
})
export type Model = typeof Model.Type

// NOTE: the Profile as a game starts, closed on Look.
export const initialModel: Model = {
  tab: 'Look',
  nameDraft: '',
  fx: 'Still',
  fxCount: 0,
  closetCue: { part: 'Hat', value: 'None', kind: 'Still', count: 0 },
  maybePreview: Option.none(),
  linkFlow: LinkFlow.Idle(),
  linkCodeCopies: 0,
  tutorialReset: 'Idle',
}

// NOTE: the settings the Settings tab's tiles show, and what this device can
// do (a controller, full screen, turning with the phone, RECORD).
const ProfileSettings = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  cursor: CursorSetting,
  fullscreen: FullscreenSetting,
  rotation: RotationSetting,
  rumble: RumbleSetting,
  hasPad: Schema.Boolean,
  recordRuns: RecordRunsSetting,
  recordUnlock: RecordUnlock,
  shareStats: ShareStatsSetting,
  screenFit: ScreenFit,
  orientationLock: OrientationLock,
})

// NOTE: what the root hands the Profile component: the panel's state, and
// the root's fields its tabs show: the look worn with the hero, the clock,
// what is owned and new; whether the Look tab holds something new; the
// MASTERY tab's tracks; the layout and the device; sync's state for the
// Account tab; and the settings.
export const ProfileProps = Schema.Struct({
  state: Model,
  appearance: Appearance,
  calling: Calling,
  picked: Calling,
  screenMs: Schema.Finite,
  bought: SavedBoughtCosmetics,
  rank: SavedRank,
  fresh: Schema.Array(Schema.String),
  isLookNew: Schema.Boolean,
  mastery: SavedMastery,
  isPortrait: Schema.Boolean,
  device: InputDevice,
  sync: Schema.Struct({
    state: SyncState,
    scope: PlayerScopeStatus,
    lastRun: LastRunSync,
  }),
  settings: ProfileSettings,
})
export type ProfileProps = typeof ProfileProps.Type
