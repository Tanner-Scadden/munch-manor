import { Schema } from 'effect'

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

export const InstallOffer = Schema.Literals(['None', 'Ready', 'Installed'])
export type InstallOffer = typeof InstallOffer.Type

export const InstallOutcome = Schema.Literals([
  'Accepted',
  'Dismissed',
  'Unavailable',
])
export type InstallOutcome = typeof InstallOutcome.Type

export const FullscreenSetting = Schema.Literals(['Off', 'On'])
export type FullscreenSetting = typeof FullscreenSetting.Type

export const PageVisibility = Schema.Literals(['Visible', 'Hidden'])
export type PageVisibility = typeof PageVisibility.Type
