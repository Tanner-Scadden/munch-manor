// The browser and device facts the Model keeps: the page's visibility, full
// screen, how the screen fits, the rotation lock, and the install offer.

import { Schema } from 'effect'

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
// beforeinstallprompt, held by src/platform/install.ts until the install tile asks.
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
