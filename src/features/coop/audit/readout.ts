import { Schema } from 'effect'

const ReadoutSeat = Schema.Struct({
  slot: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
  hp: Schema.Finite,
  life: Schema.String,
  ready: Schema.String,
  kills: Schema.Finite,
  calling: Schema.String,
})

export const AUDIT_PARAM = 'audit'

export const Readout = Schema.Struct({
  tick: Schema.Finite,
  phase: Schema.String,
  mode: Schema.String,
  difficulty: Schema.String,
  wave: Schema.Finite,
  keys: Schema.Finite,
  rattles: Schema.Struct({
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
