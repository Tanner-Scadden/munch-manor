import { Array } from 'effect'

import type { Model } from '#app/model.ts'
import {
  CASE_ART,
  CASE_HEIGHT,
  CASE_WIDTH,
  LOCK_NOTCH,
  PRIZE_SPRITES,
} from '#art/caseArt.ts'
import { placeAt } from '#art/sprite.ts'
import type { Drawable } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import { GLINT } from '#render/drawing.ts'
import { featLockShapes, lockSpotIn } from '#render/featLockView.ts'
import { caseFootOf, caseLookOf, isCaseShown } from '#world/feats/caseSpots.ts'
import { levelOf } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'
import { CaseState, type DisplayCase } from '#world/schema/worldSchema.ts'

const LOCK_LIFT_PX = 11
const NOTCH_LIFT_PX = 2
const BOB_MS = 260
const GLINT_MS = 900
const GLINT_ON_MS = 180

const caseShapes = (
  model: Model,
  displayCase: DisplayCase,
): ReadonlyArray<Draw.Shape> => {
  const level = levelOf(model)
  const foot = caseFootOf(level, displayCase)
  const art = CASE_ART[caseLookOf(level, displayCase)]
  const left = Math.round(foot.x - CASE_WIDTH / 2)
  const top = foot.y - CASE_HEIGHT
  const prizeAt = { x: Math.round(foot.x), y: top + art.prizeDropPx }
  const prize = PRIZE_SPRITES[displayCase.prize]
  const body = placeAt(left, top, art.body)
  return CaseState.match(displayCase.state, {
    Locked: () => [
      body,
      placeAt(prizeAt.x, prizeAt.y, prize),
      placeAt(left, top, art.front),
      placeAt(Math.round(foot.x), top - NOTCH_LIFT_PX, LOCK_NOTCH),
      ...featLockShapes(displayCase.feat, focusOf(model), {
        ...lockSpotIn(level, { x: Math.round(foot.x), y: top - LOCK_LIFT_PX }),
        countShows: 'Always',
      }),
    ],
    Opened: () => {
      const bob = Math.floor(model.elapsedMs / BOB_MS) % 2 === 0 ? 0 : 1
      return [
        body,
        placeAt(prizeAt.x, prizeAt.y - 2 - bob, prize),
        ...(model.elapsedMs % GLINT_MS < GLINT_ON_MS
          ? [placeAt(prizeAt.x + 4, prizeAt.y - 4 - bob, GLINT)]
          : []),
      ]
    },
    Emptied: () => [body],
  })
}

export const caseDrawables = (model: Model): ReadonlyArray<Drawable> =>
  Array.map(
    Array.filter(model.cases, displayCase =>
      isCaseShown(levelOf(model), displayCase),
    ),
    (displayCase): Drawable => ({
      footY: caseFootOf(levelOf(model), displayCase).y,
      rank: 'Prop',
      shapes: caseShapes(model, displayCase),
    }),
  )
