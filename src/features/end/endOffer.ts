import { Option } from 'effect'

import type { Model } from '#app/model.ts'
import { isEndScreen } from '#domain/run.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'

type EndOffer = 'Nothing' | 'MenuOnly' | 'MenuAndModes'

export const END_MENU_BUTTON_ID = 'end-menu-button'
export const END_RETRY_BUTTON_ID = 'end-retry-button'
export const END_SHARE_BUTTON_ID = 'end-share-button'
export const END_LOBBY_BUTTON_ID = 'end-lobby-button'
export const END_LEAVE_ROOM_BUTTON_ID = 'end-leave-button'

export const endOffer = (model: Model): EndOffer => {
  if (!isEndScreen(model.phase) || model.screenMs < RESTART_GRACE_MS) {
    return 'Nothing'
  } else if (Option.isSome(model.release.maybeNewerBuild)) {
    return 'MenuOnly'
  } else {
    return 'MenuAndModes'
  }
}
