import type { Model } from '../../app/model'
import { KEY_SPRITE } from '../../art/font'
import { placeAt } from '../../art/sprite'
import type { Drawable } from '../../render/depth'
import { GLINT, GOODIE_SHADOW } from '../../render/drawing'
import {
  isTutorialKeyOut,
  tutorialKeySpotOf,
} from '../../world/run/tutorialRules'

// The guided first break's skeleton key (src/world/run/tutorialRules.ts) on
// the dining room floor: it bobs over a little shadow with a glint, as the
// pantry's goodie does, and walking onto it puts it on the ring. The quest's
// arrow bobs over it (src/features/onboarding/firstBreakQuest.ts).

const BOB_MS = 280
const BOB_PX = 1
const LIFT_PX = 4
const GLINT_MS = 1400
const GLINT_ON_MS = 160
const KEY_HALF_WIDTH = 3
const KEY_HALF_HEIGHT = 3

// NOTE: it sorts with what stands around it, by the floor it lies on.
export const questKeyDrawables = (model: Model): ReadonlyArray<Drawable> => {
  if (!isTutorialKeyOut(model)) {
    return []
  }
  const spot = tutorialKeySpotOf(model)
  const bob = Math.floor(model.elapsedMs / BOB_MS) % 2 === 0 ? 0 : BOB_PX
  const top = spot.y - LIFT_PX - bob
  return [
    {
      footY: spot.y,
      rank: 'Prop',
      shapes: [
        placeAt(spot.x, spot.y, GOODIE_SHADOW),
        placeAt(spot.x - KEY_HALF_WIDTH, top - KEY_HALF_HEIGHT, KEY_SPRITE),
        ...(model.elapsedMs % GLINT_MS < GLINT_ON_MS
          ? [placeAt(spot.x + 3, top - 3, GLINT)]
          : []),
      ],
    },
  ]
}
