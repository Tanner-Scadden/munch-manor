import type { Option } from 'effect'

import type { PlayerInput, RunEndReason } from './Protocol'
import type { Reader, Writer } from './Wire'

export type Presence = 'Here' | 'Away'

export interface PlayerTick {
  readonly slot: number
  readonly input: PlayerInput
  readonly presence: Presence
  readonly viewLagTicks: number
  readonly rttMs: number
}

export const MAX_VIEW_LAG_TICKS = 15

export interface Score {
  readonly slot: number
  readonly score: number
}

export interface OwnPlayer<W, Own> {
  readonly of: (world: W, slot: number) => Option.Option<Own>
  readonly put: (world: W, slot: number, own: Own) => W
  readonly step: (own: Own, input: PlayerInput, world: W) => Own
  readonly gap: (a: Own, b: Own) => number
  readonly blend: (from: Own, to: Own, t: number) => Own
}

export interface World<W, Own> {
  readonly name: string
  readonly start: (slots: ReadonlyArray<number>, seed: number) => W
  readonly step: (world: W, players: ReadonlyArray<PlayerTick>) => W
  readonly removePlayer: (world: W, slot: number) => W
  readonly isOver: (world: W) => boolean
  readonly endReason: (world: W) => RunEndReason
  readonly scores: (world: W) => ReadonlyArray<Score>
  readonly snapshot: (writer: Writer, world: W) => void
  readonly readSnapshot: (reader: Reader) => W
  readonly diff: (writer: Writer, prev: W, next: W) => void
  readonly applyDiff: (reader: Reader, prev: W) => W
  readonly interpolate: (from: W, to: W, t: number) => W
  readonly own: OwnPlayer<W, Own>
}
