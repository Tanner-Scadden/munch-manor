import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'

import { Calling, SavedBoughtCosmetics } from '../playerData'
import { SeatAction } from '../stepWorld'
import { Bullet } from '../worldSchema'

// NOTE: this client's controls for one room frame, the shape of netcode's
// PlayerInput. PlayerInput's own Schema checks each field's wire range, and
// an InMessage's payload goes through its Schema when it is built, so a stray
// aim beyond the range would throw on every frame. The session packs the
// input for the wire itself, so the InMessage carries plain numbers.
const Controls = Schema.Struct({
  moveX: Schema.Finite,
  moveY: Schema.Finite,
  aimX: Schema.Finite,
  aimY: Schema.Finite,
  buttons: Schema.Finite,
  action: Schema.Finite,
})

// IN MESSAGE

// NOTE: the parent's requests. Each `RequestedX` generates the Binding's
// `requestX(...)` (`CoopBinding.requestPressKey({ code })`), handled in
// inMessageUpdate.ts.
export const InMessage = defineInMessageUnion({
  RequestedOpen: {
    name: Schema.String,
    maybeCode: Schema.Option(Schema.String),
    look: Schema.String,
    rank: Schema.Finite,
    calling: Calling,
    rngState: Schema.Finite,
    bought: SavedBoughtCosmetics,
    bones: Schema.Finite,
  },
  RequestedBoughtHero: {
    calling: Calling,
    bought: SavedBoughtCosmetics,
    bones: Schema.Finite,
  },
  RequestedPressKey: { code: Schema.String },
  RequestedReleaseKey: { code: Schema.String },
  RequestedTickRoom: {
    controls: Controls,
    nowMs: Schema.Finite,
    isPictureHeld: Schema.Boolean,
  },
  RequestedPressAction: { action: SeatAction },
  RequestedToggleReady: {},
  RequestedLeave: {},
  RequestedKeepTracers: {
    tracers: Schema.Array(Bullet),
    fired: Schema.Finite,
    looked: Schema.Finite,
    confirmed: Schema.Finite,
  },
})
export type InMessage = typeof InMessage.Type
