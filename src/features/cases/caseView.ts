import { Array } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  CASE_ART,
  CASE_HEIGHT,
  CASE_WIDTH,
  SIGHT_PRIZE,
} from '../../art/caseArt'
import { type Sprite, placeAt } from '../../art/sprite'
import { gunIcon } from '../../art/sprites/guns'
import type { Drawable } from '../../render/depth'
import { GLINT } from '../../render/drawing'
import { featLockShapes } from '../../render/featLockView'
import { caseFootOf, caseLookOf, isCaseShown } from '../../world/feats/cases'
import { levelOf } from '../../world/level/arena'
import { focusOf } from '../../world/party/party'
import {
  type CasePrize,
  CaseState,
  type DisplayCase,
} from '../../world/schema/worldSchema'

// The display cases (src/world/feats/cases.ts) in the world, sorted by the
// floor they stand on: a locked case shows its prize behind glass and a
// padlock, with its feat's lock over it filling with your own progress; an
// opened one has lost its glass and its prize bobs, glinting, until its
// opener takes it; an emptied one stands bare.

const PRIZE_SPRITES: Readonly<Record<CasePrize, Sprite>> = {
  Shotgun: gunIcon('Shotgun', 0),
  Smg: gunIcon('Smg', 0),
  LaserSight: SIGHT_PRIZE,
}

const LOCK_LIFT_PX = 9
const BOB_MS = 260
const GLINT_MS = 900
const GLINT_ON_MS = 180

const caseShapes = (
  model: Model,
  displayCase: DisplayCase,
): ReadonlyArray<Canvas.Shape> => {
  const foot = caseFootOf(displayCase)
  const art = CASE_ART[caseLookOf(displayCase)]
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
      ...featLockShapes(displayCase.feat, focusOf(model), {
        x: Math.round(foot.x),
        y: top - LOCK_LIFT_PX,
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
      footY: caseFootOf(displayCase).y,
      rank: 'Prop',
      shapes: caseShapes(model, displayCase),
    }),
  )
