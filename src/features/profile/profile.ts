import type { Array } from 'effect'

import type { Model, ProfileTab } from './model'

// TABS

export const PROFILE_TABS_ID = 'profile-tabs'

// NOTE: the tabs as data, in the order they stand down the side (across the
// top in portrait). Stats would be one more entry here and one
// more literal in ProfileTab (src/features/profile/model.ts).
export const PROFILE_TABS: Array.NonEmptyReadonlyArray<ProfileTab> = [
  'Look',
  'Name',
  'Account',
  'Settings',
]

// NAME

export const NAME_INPUT_ID = 'profile-name-input'

// SETTINGS

export const RESET_TUTORIAL_BUTTON_ID = 'reset-tutorial'
export const KEEP_TUTORIAL_BUTTON_ID = 'keep-tutorial'

// NOTE: the tab the Profile has open, for the root's Dialog and menuState.
export const tabOf = (profile: Model): ProfileTab => profile.tab
