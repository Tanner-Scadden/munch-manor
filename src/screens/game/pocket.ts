import { Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import { GLYPH_HEIGHT, textWidth } from '#art/font.ts'
import { PocketCard } from '#domain/clientSchema.ts'
import {
  type DarePocket,
  type PocketBox,
  pocketBoxOf,
} from '#features/dare/dareCard.ts'
import { tagKeepoutsOf } from '#features/shop/purchaseView.ts'
import type { Camera } from '#render/camera/camera.ts'
import {
  type Box,
  type Screen,
  landscapeFrameOffset,
  screenOf,
  stagePlacement,
} from '#render/camera/screen.ts'
import {
  HEART_SPACING,
  HUD_MARGIN,
  type HudLayout,
  cornerButtonBox,
  gunClusterBox,
  hudLayoutFor,
  startWavePillBox,
} from '#render/hud/hudLayout.ts'
import type { Keepout } from '#render/hud/keepout.ts'
import { dareCardOf } from '#world/dare/dare.ts'
import { maxHpOf } from '#world/heroes/calling.ts'
import { heldKeys } from '#world/keys/keys.ts'
import { focusOf } from '#world/party/party.ts'
import { Phase } from '#world/schema/worldSchema.ts'

import { maybeBannerBand } from './overlay.ts'

export const pocketOf = (model: Model): DarePocket => {
  if (
    !Phase.isAnyOf(['Preparation'])(model.phase) ||
    PocketCard.isAnyOf(['Reading'])(model.pocketCard)
  ) {
    return 'Shut'
  }
  if (PocketCard.isAnyOf(['Folding'])(model.pocketCard)) {
    return 'Open'
  }
  const screen = screenOf(model)
  const open = pocketBoxOf(model, hudLayoutFor(screen), 'Open')
  const frameTop = landscapeFrameOffset(screen).y
  const isUnderBanner = Option.exists(
    maybeBannerBand(model),
    band =>
      band.top + frameTop < open.bottom && band.bottom + frameTop > open.top,
  )
  return isUnderBanner ? 'Shut' : 'Open'
}

const maybePocketKeepout = (model: Model): Option.Option<PocketBox> => {
  if (dareCardOf(model).length === 0) {
    return Option.none()
  }
  return Option.some(
    pocketBoxOf(model, hudLayoutFor(screenOf(model)), pocketOf(model)),
  )
}

export const KEY_RING_SCALE = 2

export const keyRingLabelOf = (model: Model): string => `$${heldKeys(model)}`

const keyRingBoxOf = (model: Model): PocketBox => {
  const layout = hudLayoutFor(screenOf(model))
  return {
    left: layout.keysLeft,
    top: layout.keysTop - 1,
    right: layout.keysLeft + textWidth(keyRingLabelOf(model)) * KEY_RING_SCALE,
    bottom: layout.keysTop + GLYPH_HEIGHT * KEY_RING_SCALE,
  }
}

const keepoutOf = (box: Box): Keepout => ({
  left: box.x,
  top: box.y,
  right: box.x + box.width,
  bottom: box.y + box.height,
})

const HEART_REACH = 4

const heartsBoxOf = (model: Model, layout: HudLayout): Keepout => ({
  left: 0,
  top: 0,
  right:
    HUD_MARGIN +
    3 +
    (maxHpOf(focusOf(model).player) - 1) * HEART_SPACING +
    HEART_REACH,
  bottom: layout.keysTop - 1,
})

const surfaceKeepouts = (
  model: Model,
  screen: Screen,
): ReadonlyArray<Keepout> =>
  Option.match(model.maybeSurface, {
    onNone: () => [],
    onSome: surface => [
      keepoutOf(cornerButtonBox(screen, surface)),
      ...(Phase.isAnyOf(['Preparation'])(model.phase)
        ? [
            keepoutOf(
              startWavePillBox(screen, stagePlacement(surface, screen).scale),
            ),
          ]
        : []),
    ],
  })

const CLUSTER_CAP_RISE = 3

const clusterKeepout = (screen: Screen): Keepout => {
  const cluster = gunClusterBox(screen)
  return {
    left: cluster.x,
    top: cluster.y - CLUSTER_CAP_RISE,
    right: cluster.x + cluster.width,
    bottom: cluster.y + cluster.height,
  }
}

const bannerKeepoutsOf = (model: Model): ReadonlyArray<Keepout> => {
  const screen = screenOf(model)
  const frame = landscapeFrameOffset(screen)
  return Option.match(maybeBannerBand(model), {
    onNone: () => [],
    onSome: band => [
      {
        left: 0,
        top: band.top + frame.y,
        right: screen.width,
        bottom: band.bottom + frame.y,
      },
    ],
  })
}

export const hudAndBannerKeepoutsOf = (
  model: Model,
): ReadonlyArray<Keepout> => [
  ...hudKeepoutsOf(model),
  ...bannerKeepoutsOf(model),
]

export const pinnedKeepoutsOf: {
  (camera: Camera): (model: Model) => ReadonlyArray<Keepout>
  (model: Model, camera: Camera): ReadonlyArray<Keepout>
} = Function.dual(2, (model: Model, camera: Camera): ReadonlyArray<Keepout> => {
  const fixed = hudAndBannerKeepoutsOf(model)
  return [...fixed, ...tagKeepoutsOf(model, camera, fixed)]
})

export const hudKeepoutsOf = (model: Model): ReadonlyArray<Keepout> => {
  const screen = screenOf(model)
  return [
    ...Option.toArray(maybePocketKeepout(model)),
    keyRingBoxOf(model),
    heartsBoxOf(model, hudLayoutFor(screen)),
    ...surfaceKeepouts(model, screen),
    clusterKeepout(screen),
  ]
}
