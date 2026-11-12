import { Option, Schema } from 'effect'

import { Tabs } from '@foldkit/ui'

import { LinkFlow } from '../../platform/playerSync'
import {
  CharacterPicker,
  ClosetCue,
  LookPreview,
  ProfileFx,
} from './blocks/look/model'

const TutorialReset = Schema.Literals(['Idle', 'Asking', 'Done'])
type TutorialReset = typeof TutorialReset.Type

// NOTE: the Profile's tabs, in order. A new tab, such as Cosmetics or
// Stats, is one more literal here and one more entry in PROFILE_TABS
// (src/features/profile/profile.ts).
export const ProfileTab = Schema.Literals([
  'Look',
  'Name',
  'Account',
  'Settings',
])
export type ProfileTab = typeof ProfileTab.Type

export const ProfileTabsBlock = Tabs.makeBlock<ProfileTab>()

// NOTE: the Profile panel's own state: the open tab, the name as it is being
// typed, the last effect and the Look tab's cue and try-on, the device link
// flow with the times its code was copied, and the tutorial reset's question. The view reads fxCount only for
// its parity, so the same effect twice in a row still replays. Its tab strip
// and the Look tab are its children, on `tabs` and `character`. What the
// game reads (the name kept, the look, the settings) is the root's.
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
  tabs: ProfileTabsBlock.Model,
  character: CharacterPicker,
})
export type Model = typeof Model.Type

// NOTE: the Profile's own fields as it starts, closed on Look. Its children
// start from their own inits through their Bindings.
export const initialModel: Omit<Model, 'tabs' | 'character'> = {
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
