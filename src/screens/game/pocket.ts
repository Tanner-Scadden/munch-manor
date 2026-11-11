import { Option } from 'effect'

import type { Model } from '../../app/model'
import { GLYPH_HEIGHT, textWidth } from '../../art/font'
import { PocketCard } from '../../domain/clientSchema'
import {
  type DarePocket,
  type PocketBox,
  UNLOCK_BAR_ROWS,
  pocketBoxOf,
} from '../../features/dare/dareCard'
import { hudLayoutFor } from '../../render/hudLayout'
import { landscapeFrameOffset, screenOf } from '../../render/screen'
import { dareCardOf } from '../../world/dare/dare'
import { heldKeys } from '../../world/keys/keys'
import { Phase } from '../../world/schema/worldSchema'
import { maybeBannerBand } from './overlay'

// NOTE: whether the HUD's dare pocket (src/features/dare/dareCard.ts) is
// open on the whole list. It opens in a break, when the house is there to
// search, once the card from the slam is put away (it folds into the shut
// chip), and only while no banner (WAVE CLEARED, GET READY, a new zombie)
// is in the rows the open list would cover. Through a wave it stays shut.
export const pocketOf = (model: Model): DarePocket => {
  if (
    !Phase.isAnyOf(['Preparation'])(model.phase) ||
    !PocketCard.isAnyOf(['Pocketed'])(model.pocketCard)
  ) {
    return 'Shut'
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

// NOTE: what the pocket covers as it is drawn, with the unlock bar under
// it, for Rattles' bubbles to keep out of. Endless has no pocket.
export const maybePocketKeepout = (model: Model): Option.Option<PocketBox> => {
  if (dareCardOf(model).length === 0) {
    return Option.none()
  }
  const box = pocketBoxOf(model, hudLayoutFor(screenOf(model)), pocketOf(model))
  return Option.some({ ...box, bottom: box.bottom + UNLOCK_BAR_ROWS })
}

// NOTE: the crew's key ring under the hearts (src/screens/game/hud.ts), a
// skeleton key and its count (the font draws `$` as the key) at twice the
// font's size, and what it covers, for Rattles' bubbles to keep out of.
export const KEY_RING_SCALE = 2

export const keyRingLabelOf = (model: Model): string => `$${heldKeys(model)}`

export const keyRingBoxOf = (model: Model): PocketBox => {
  const layout = hudLayoutFor(screenOf(model))
  return {
    left: layout.keysLeft,
    top: layout.keysTop - 1,
    right: layout.keysLeft + textWidth(keyRingLabelOf(model)) * KEY_RING_SCALE,
    bottom: layout.keysTop + GLYPH_HEIGHT * KEY_RING_SCALE,
  }
}
