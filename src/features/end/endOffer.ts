import { Option } from 'effect'

import type { Model } from '../../app/model'
import { isEndScreen } from '../../domain/run'
import { RESTART_GRACE_MS } from '../../shared/constants'

// What the end card offers once its beat is done, and its buttons' ids.

type EndOffer = 'Nothing' | 'MenuOnly' | 'MenuAndModes'

export const END_MENU_BUTTON_ID = 'end-menu-button'
export const END_RETRY_BUTTON_ID = 'end-retry-button'
export const END_SHARE_BUTTON_ID = 'end-share-button'
export const END_LOBBY_BUTTON_ID = 'end-lobby-button'
export const END_LEAVE_ROOM_BUTTON_ID = 'end-leave-button'

// NOTE: a newer build waits on the home menu, so the end screens offer only
// MENU then. Starting another run here would keep the old build running.
export const endOffer = (model: Model): EndOffer => {
  if (!isEndScreen(model.phase) || model.screenMs < RESTART_GRACE_MS) {
    return 'Nothing'
  } else if (Option.isSome(model.maybeNewerBuild)) {
    return 'MenuOnly'
  } else {
    return 'MenuAndModes'
  }
}
