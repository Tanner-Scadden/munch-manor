import { CoopComposition } from './composition'
import { keepTracers, pressAction } from './roomState'
import {
  edits,
  leaveRoom,
  open,
  pressKey,
  tickRoom,
  toggleReadyInRoom,
} from './update'

// NOTE: the parent's requests, each a Step co-op's own update shares. A
// request runs as it is: one that drops the room says nothing more, as the
// parent asked for it (the update's `delivered` tells of a dropped room).
export const inMessageUpdate = CoopComposition.makeInMessageUpdate({
  RequestedOpen: (
    model,
    { name, maybeCode, look, rank, calling, rngState, bought, bones },
  ) =>
    open(model, name, maybeCode, look, rank, calling, bought, bones, rngState),

  RequestedBoughtHero: (model, { calling, bought, bones }) =>
    edits.boughtHero(model, calling, bought, bones),

  RequestedPressKey: (model, { code }) => pressKey(model, code),

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
