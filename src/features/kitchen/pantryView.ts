import { Option } from 'effect'

import type { Model } from '../../app/model'
import { KEY_SPRITE } from '../../art/font'
import { type Sprite, placeAt } from '../../art/sprite'
import { HEART_SPRITE } from '../../art/sprites/hearts'
import type { Drawable } from '../../render/depth'
import { GLINT, GOODIE_SHADOW } from '../../render/drawing'
import { isKitchenShown } from '../../render/room/kitchenView'
import { maybeStash, pantrySpotOf } from '../../world/kitchen/pantry'
import { levelOf } from '../../world/level/arena'
import type { PantryGoodie } from '../../world/schema/entitySchema'

const BOB_MS = 280
const BOB_PX = 1
const LIFT_PX = 4
const GLINT_MS = 1400
const GLINT_ON_MS = 160

type GoodieLook = Readonly<{ sprite: Sprite; dx: number; dy: number }>

const GOODIE_LOOKS: Readonly<Record<PantryGoodie, GoodieLook>> = {
  Key: { sprite: KEY_SPRITE, dx: -3, dy: -3 },
  Heart: { sprite: HEART_SPRITE, dx: 0, dy: 0 },
}

export const pantryDrawables = (model: Model): ReadonlyArray<Drawable> =>
  isKitchenShown(model)
    ? Option.match(
        Option.all({
          stash: maybeStash(model),
          spot: pantrySpotOf(levelOf(model)),
        }),
        {
          onNone: () => [],
          onSome: ({ stash, spot }) => {
            const look = GOODIE_LOOKS[stash.goodie]
            const bob =
              Math.floor(model.elapsedMs / BOB_MS) % 2 === 0 ? 0 : BOB_PX
            const top = spot.y - LIFT_PX - bob
            return [
              {
                footY: spot.y,
                rank: 'Prop',
                shapes: [
                  placeAt(spot.x, spot.y, GOODIE_SHADOW),
                  placeAt(spot.x + look.dx, top + look.dy, look.sprite),
                  ...(model.elapsedMs % GLINT_MS < GLINT_ON_MS
                    ? [placeAt(spot.x + 3, top - 3, GLINT)]
                    : []),
                ],
              },
            ]
          },
        },
      )
    : []
