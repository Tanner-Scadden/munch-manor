import type { Array } from 'effect'

import type { Model, ProfileTab } from './model'

export const PROFILE_TABS_ID = 'profile-tabs'

export const PROFILE_TABS: Array.NonEmptyReadonlyArray<ProfileTab> = [
  'Look',
  'Name',
  'Account',
  'Settings',
  'Mastery',
]

export const NAME_INPUT_ID = 'profile-name-input'

export const RESET_TUTORIAL_BUTTON_ID = 'reset-tutorial'
export const KEEP_TUTORIAL_BUTTON_ID = 'keep-tutorial'

export const tabOf = (profile: Model): ProfileTab => profile.tab
