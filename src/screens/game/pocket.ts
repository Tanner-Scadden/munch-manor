import { Function, Option } from 'effect'

import type { Model } from '../../app/model'
import { GLYPH_HEIGHT, textWidth } from '../../art/font'
import { PocketCard } from '../../domain/clientSchema'
import {
  type DarePocket,
  type PocketBox,
  pocketBoxOf,
} from '../../features/dare/dareCard'
import { tagKeepoutsOf } from '../../features/shop/purchaseView'
import type { Camera } from '../../render/camera'
import {
  HEART_SPACING,
  HUD_MARGIN,
  type HudLayout,
  cornerButtonBox,
  gunClusterBox,
  hudLayoutFor,
  startWavePillBox,
} from '../../render/hudLayout'
import type { Keepout } from '../../render/keepout'
import {
  type Box,
  type Screen,
  landscapeFrameOffset,
  screenOf,
  stagePlacement,
} from '../../render/screen'
import { dareCardOf } from '../../world/dare/dare'
import { maxHpOf } from '../../world/heroes/calling'
import { heldKeys } from '../../world/keys/keys'
import { focusOf } from '../../world/party/party'
import { Phase } from '../../world/schema/worldSchema'
import { maybeBannerBand } from './overlay'

// NOTE: whether the HUD's dare pocket (src/features/dare/dareCard.ts) is
// open on the whole list. It opens in a break, when the house is there to
// search, once the card from the slam is put away (it folds into the shut
// chip), and only while no banner (WAVE CLEARED, GET READY, a new zombie)
// is in the rows the open list would cover. Through a wave it stays shut.
// It opens as the card folds, a banner or not, so each picture flies into
// its own slot, and then shuts again if a banner is there.
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

// NOTE: what the pocket covers as it is drawn, for the art pinned over the
// world to keep out of. Endless has no pocket.
const maybePocketKeepout = (model: Model): Option.Option<PocketBox> => {
  if (dareCardOf(model).length === 0) {
    return Option.none()
  }
  return Option.some(
    pocketBoxOf(model, hudLayoutFor(screenOf(model)), pocketOf(model)),
  )
}

// NOTE: the crew's key ring under the hearts (src/screens/game/hud.ts), a
// skeleton key and its count (the font draws `$` as the key) at twice the
// font's size, and what it covers, for the art pinned over the world to
// keep out of.
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

// NOTE: the hearts in the top left (src/screens/game/hud.ts), each drawn
// round its spot three pixels past the last, over the key ring.
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

// NOTE: the corner button and, in a break, START WAVE are HTML buttons the
// canvas cannot draw over, placed by the stage's fit in the game surface.
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

// NOTE: the slots' key caps stand this far over the slots.
const CLUSTER_CAP_RISE = 3

// NOTE: the gun slots and their key caps over the window's bottom in
// landscape (under it, in the thumb area, in portrait, where this is out of
// the window's reach anyway).
const clusterKeepout = (screen: Screen): Keepout => {
  const cluster = gunClusterBox(screen)
  return {
    left: cluster.x,
    top: cluster.y - CLUSTER_CAP_RISE,
    right: cluster.x + cluster.width,
    bottom: cluster.y + cluster.height,
  }
}

// NOTE: every HUD button and panel over the world window, in screen pixels,
// for the art pinned over the world to keep out of: the dare pocket, the
// key ring and the hearts over it, the corner button, START WAVE in a
// break, and the gun slots.
// NOTE: the rows a banner takes while one shows (WAVE CLEARED, the break's
// clock), across the whole screen, in screen pixels.
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

// NOTE: what the price tags and the feat locks keep out of: the HUD's
// buttons and panels, and a banner's rows.
export const hudAndBannerKeepoutsOf = (
  model: Model,
): ReadonlyArray<Keepout> => [
  ...hudKeepoutsOf(model),
  ...bannerKeepoutsOf(model),
]

// NOTE: what the notes pinned over the world keep out of: those, and the
// price tags as they are pinned. The fridge's odds note keeps out of these,
// and Rattles' bubbles of these and the note.
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
