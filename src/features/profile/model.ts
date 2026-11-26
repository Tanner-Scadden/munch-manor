import { Option, Schema } from 'effect'

import { InputDevice } from '#input/inputSchema.ts'
import {
  FullscreenSetting,
  OrientationLock,
  ScreenFit,
} from '#platform/deviceSchema.ts'
import { LinkFlow } from '#platform/save/linkFlow.ts'
import { SyncState } from '#platform/save/playerSync.ts'
import { SavedMastery } from '#shared/records/masteryData.ts'
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
} from '#shared/records/playerData.ts'

import { ClosetCue, LookPreview, ProfileFx } from './blocks/look/model.ts'
import { TutorialReset } from './machines/resetFlow.ts'

export const ProfileTab = Schema.Literals([
  'Look',
  'Name',
  'Account',
  'Settings',
  'Mastery',
])
export type ProfileTab = typeof ProfileTab.Type

export const LookOutcome = Schema.Literals([
  'Stay',
  'Wear',
  'Preview',
  'Locked',
  'Bought',
  'Short',
])
export type LookOutcome = typeof LookOutcome.Type

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

export const initialModel: Model = {
  tab: 'Look',
  nameDraft: '',
  fx: 'Still',
  fxCount: 0,
  closetCue: { part: 'Hat', value: 'None', kind: 'Still', count: 0 },
  maybePreview: Option.none(),
  linkFlow: LinkFlow.Idle,
  linkCodeCopies: 0,
  tutorialReset: TutorialReset.Idle,
}

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
  }),
  settings: ProfileSettings,
})
export type ProfileProps = typeof ProfileProps.Type
