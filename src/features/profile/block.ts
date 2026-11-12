import { Schema } from 'effect'
import { Block } from 'foldkit'

import type { InputDevice } from '../../input/inputSchema'
import type {
  FullscreenSetting,
  OrientationLock,
  ScreenFit,
} from '../../platform/deviceSchema'
import type {
  LastRunSync,
  PlayerScopeStatus,
  SyncState,
} from '../../platform/playerSync'
import type { RecordUnlock } from '../../platform/recording'
import { PlayerStore } from '../../platform/store'
import type {
  CursorSetting,
  MusicSetting,
  RecordRunsSetting,
  RotationSetting,
  RumbleSetting,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from '../../shared/playerData'
import type { ViewInputs as LookInputs } from './blocks/look/block'
import { InMessage } from './inMessage'
import { Message, OutMessage } from './message'
import { Model } from './model'

// NOTE: what the root hands the Profile's view: only the root's fields its
// tabs show. The Look tab's look, owned, and new things; whether the Look
// tab holds something new; the layout and the device; sync's state for the
// Account tab; and the settings' values and what this device can do.
export type ViewInputs = Readonly<{
  look: Omit<LookInputs, 'fx' | 'fxCount' | 'maybePreview' | 'cue'>
  isLookNew: boolean
  isPortrait: boolean
  device: InputDevice
  sync: Readonly<{
    state: SyncState
    scope: PlayerScopeStatus
    lastRun: LastRunSync
  }>
  settings: Readonly<{
    sound: SoundSetting
    music: MusicSetting
    shake: ShakeSetting
    cursor: CursorSetting
    fullscreen: FullscreenSetting
    rotation: RotationSetting
    rumble: RumbleSetting
    hasPad: boolean
    recordRuns: RecordRunsSetting
    recordUnlock: RecordUnlock
    shareStats: ShareStatsSetting
    screenFit: ScreenFit
    orientationLock: OrientationLock
  }>
}>

// NOTE: the Profile's public contract. The root opens it, keeps its name,
// and answers its dice and Look picks through the InMessages; it tells the
// root what happened through its OutMessages. Its device link Commands use
// the store.
const ProfileKey = Symbol('Profile')
export const ProfileBlock = Block.make('Profile', {
  key: ProfileKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  effects: { services: [PlayerStore] },
  Model,
  Message,
  InMessage,
  OutMessage,
  inMessageOutputs: {
    RequestedKeepName: { outMessage: OutMessage },
  },
})

// NOTE: Commands and OutMessage folds are made through the Block itself
// (`ProfileBlock.makeCommand(...)`): exported alone, each is a two-argument
// function with no pipeable form.
export const {
  makeComposition,
  makeNoopStep,
  makeOutMessageStep,
  makeRequiredFieldBinding,
  makeStep,
} = ProfileBlock
