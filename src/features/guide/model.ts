import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { ShopGuideSection } from '../../shared/nameKeys'

// NOTE: the buttons focus moves between as the guide opens and closes on
// the Munchopedia's Shop page: its BACK, and the Shop tile that opened it.
export const GUIDE_FOCUS_IDS = {
  back: 'munch-guide-back',
  opener: 'munch-shop-tile',
} as const

// NOTE: which of the two takes focus: BACK as the guide opens, the Shop
// tile as it goes back, so the keyboard never lands on nothing.
export const GuideFocusTarget = Schema.Literals(['Back', 'Opener'])
export type GuideFocusTarget = typeof GuideFocusTarget.Type

export const guideFocusId = (target: GuideFocusTarget): string =>
  target === 'Back' ? GUIDE_FOCUS_IDS.back : GUIDE_FOCUS_IDS.opener

// NOTE: shut, or up on one section. Its parent owns it, since the parent
// draws the guide in place of what it stands over (the Munchopedia's
// zombies) while it is open.
export const GuideStatus = UiSchema.TaggedEnum({
  Closed: {},
  Open: { section: ShopGuideSection },
})
export type GuideStatus = typeof GuideStatus.Type

export const isGuideOpen = (status: GuideStatus): boolean =>
  GuideStatus.isAnyOf(['Open'])(status)

// NOTE: the guide opens on its first section, guns.
export const openedGuide: GuideStatus = GuideStatus.Open({ section: 'Guns' })

// NOTE: a section button turns an open guide; a shut one has none to tap.
export const withSection =
  (section: ShopGuideSection) =>
  (status: GuideStatus): GuideStatus =>
    isGuideOpen(status) ? GuideStatus.Open({ section }) : status
