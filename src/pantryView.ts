import { Option } from 'effect'

import { levelOf } from './arena'
import type { Drawable } from './depth'
import { rect } from './drawing'
import { COIN_SPRITE } from './font'
import { isKitchenShown } from './kitchenView'
import type { Model, PantryGoodie } from './model'
import { maybeStash, pantrySpotOf } from './pantry'
import { type Sprite, bakeShapes, placeAt, spriteShapes } from './sprite'
import { HEART_SPRITE } from './sprites/hearts'

// The pantry stash (src/pantry.ts) in the world: its goodie bobbing on the
// floor in front of the cupboard for the break, over a little shadow, with a
// glint that winks now and then. Show, don't explain: a coin, a pot lid, or a
// heart says what it is, and walking onto it takes it.

const BOB_MS = 280
const BOB_PX = 1
const LIFT_PX = 4
const GLINT_MS = 1400
const GLINT_ON_MS = 160

const LID: Sprite = spriteShapes(['..kHk..', '.kGHGk.', 'kGGGGGk', '.kkkkk.'], {
  k: '#140c10',
  G: '#8d96a3',
  H: '#d9dde3',
})

// NOTE: the coin is drawn from its top left corner, the rest from their
// middles, so each sits by its own offset.
type GoodieLook = Readonly<{ sprite: Sprite; dx: number; dy: number }>

const GOODIE_LOOKS: Readonly<Record<PantryGoodie, GoodieLook>> = {
  Cash: { sprite: COIN_SPRITE, dx: -3, dy: -3 },
  Lids: { sprite: LID, dx: 0, dy: 0 },
  Heart: { sprite: HEART_SPRITE, dx: 0, dy: 0 },
}

const SHADOW: Sprite = bakeShapes([
  rect(-3, 0, 7, 1, 'rgba(0, 0, 0, 0.35)'),
  rect(-2, 1, 5, 1, 'rgba(0, 0, 0, 0.2)'),
])

const GLINT: Sprite = bakeShapes([
  rect(0, -2, 1, 5, '#fff7d0'),
  rect(-2, 0, 5, 1, '#fff7d0'),
])

// NOTE: the stash sorts with what stands around it, by the floor it sits on.
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
                  placeAt(spot.x, spot.y, SHADOW),
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
