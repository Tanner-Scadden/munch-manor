import { Schema } from 'effect'

// READOUT

// NOTE: what the room's World holds, as one line of JSON on the arena's
// hidden link element, for the audit harness (tools/audit/coop.ts): the
// phase, the zombies, the stall, and each player. The page writes it and
// the audit reads it through this one Schema. It imports only effect, so
// the audit can load it without the game.
const ReadoutSeat = Schema.Struct({
  slot: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
  hp: Schema.Finite,
  life: Schema.String,
  ready: Schema.String,
  kills: Schema.Finite,
  money: Schema.Finite,
  shop: Schema.String,
  // NOTE: the calling the room seated, as its word, so the audit can check it.
  calling: Schema.String,
})

// NOTE: the link param that asks the page for the readout. Encoding the
// whole World to JSON every frame is for the audit only, so a page writes
// it only when its address carries this param when the page loads.
export const AUDIT_PARAM = 'audit'

export const Readout = Schema.Struct({
  tick: Schema.Finite,
  phase: Schema.String,
  mode: Schema.String,
  difficulty: Schema.String,
  wave: Schema.Finite,
  stall: Schema.Struct({
    left: Schema.Finite,
    top: Schema.Finite,
    right: Schema.Finite,
    bottom: Schema.Finite,
  }),
  zombies: Schema.Array(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
  players: Schema.Array(ReadoutSeat),
})
export type Readout = typeof Readout.Type

export const ReadoutJson = Schema.fromJsonString(Readout)
