import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { ShopGuideSection } from '#shared/nameKeys.ts'

export const GUIDE_FOCUS_IDS = {
  back: 'munch-guide-back',
  opener: 'munch-shop-tile',
} as const

export const GuideFocusTarget = Schema.Literals(['Back', 'Opener'])
export type GuideFocusTarget = typeof GuideFocusTarget.Type

export const guideFocusId = (target: GuideFocusTarget): string =>
  target === 'Back' ? GUIDE_FOCUS_IDS.back : GUIDE_FOCUS_IDS.opener

export const GuideStatus = UiSchema.TaggedEnum({
  Closed: {},
  Open: { section: ShopGuideSection },
})
export type GuideStatus = typeof GuideStatus.Type

export const isGuideOpen = (status: GuideStatus): boolean =>
  GuideStatus.isAnyOf(['Open'])(status)

export const openedGuide: GuideStatus = GuideStatus.Open({ section: 'Guns' })

export const withSection =
  (section: ShopGuideSection) =>
  (status: GuideStatus): GuideStatus =>
    isGuideOpen(status) ? GuideStatus.Open({ section }) : status
