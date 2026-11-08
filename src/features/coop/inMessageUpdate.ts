import { Option } from 'effect'

import { maybeRoomOf } from '../../domain/coopRoom'
import { isPickerOpen } from '../heroes/model'
import { HeroPickerBinding } from './bindings'
import { makeStep } from './block'
import { CoopComposition } from './composition'
import type { Model } from './model'
import { CALLING_KEY, keepTracers, pressAction } from './roomState'
import { boughtHero, closeStrayPicker, lobbyMeOf, togglePicker } from './steps'
import {
  leaveRoom,
  open,
  pressKey,
  tickRoom,
  toggleReadyInRoom,
} from './update'

// NOTE: in the room's lobby, with no name being typed, the hero picker takes
// the keys while it is open (Escape and Y close it, and the rest wait:
// Enter belongs to the card in focus), and Y opens it. Every other key is
// the screen's.
const isNaming = (model: Model): boolean =>
  Option.exists(maybeRoomOf(model), room => Option.isSome(room.maybeNameDraft))

const pressKeyWithPicker = (code: string) =>
  makeStep(model => {
    const isPicking = Option.isSome(lobbyMeOf(model)) && !isNaming(model)
    if (isPicking && isPickerOpen(model.heroPicker)) {
      return HeroPickerBinding.requestPressKey({ code })
    } else if (isPicking && code === CALLING_KEY) {
      return togglePicker
    } else {
      return makeStep(current => pressKey(current, code))
    }
  })

// NOTE: the parent's requests, each a Step co-op's own update shares. A
// request runs as it is: one that drops the room says nothing more, as the
// parent asked for it (the update's `delivered` tells of a dropped room).
const handlers = CoopComposition.makeInMessageUpdate({
  RequestedOpen: (
    model,
    { name, maybeCode, look, rank, calling, rngState, bought, bones },
  ) =>
    open(model, name, maybeCode, look, rank, calling, bought, bones, rngState),

  RequestedBoughtHero: (model, { calling, bought, bones }) =>
    boughtHero({ calling, bought, bones })(model),

  RequestedPressKey: (model, { code }) => pressKeyWithPicker(code)(model),

  RequestedReleaseKey: model => ({ model }),

  RequestedTickRoom: (model, { controls, nowMs, isPictureHeld }) =>
    tickRoom(model, controls, nowMs, isPictureHeld),

  RequestedPressAction: (model, { action }) => ({
    model: pressAction(model, action),
  }),

  RequestedToggleReady: toggleReadyInRoom,

  RequestedLeave: leaveRoom,

  RequestedKeepTracers: (model, { tracers, fired, looked, confirmed }) => ({
    model: keepTracers(model, tracers, fired, looked, confirmed),
  }),
})

// NOTE: a request that drops the room (RequestedLeave) closes an open hero
// picker too, as co-op's own Messages do.
export const inMessageUpdate = CoopComposition.makeInMessageUpdate.compose(
  handlers,
  CoopComposition.makeInMessageUpdate.each(closeStrayPicker),
)
