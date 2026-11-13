import type { Option } from 'effect'

import type { PlayerInput, RunEndReason } from './Protocol'
import type { Reader, Writer } from './Wire'

// NOTE: what the room and the client need from a game, and nothing else.
// The room steps it, diffs it, and snapshots it; the client reads those
// back, interpolates between two of them, and predicts its own player.
// The stand-in world (StandIn.ts) implements it for tests and the dev page;
// the game's `stepWorld` plugs in here once the World/Model split lands
// (MULTIPLAYER.md, Phase 0).
//
// Every function is pure. `step` must be deterministic: the same world and
// inputs give the same world, with randomness drawn from state inside it.

export type Presence = 'Here' | 'Away'

// NOTE: one player's part of a tick. An Away player is frozen in place, not
// targeted, and not hurt (MULTIPLAYER.md, default 10); its input is neutral.
// NOTE: `viewLagTicks` is how far behind the room's tick this player's
// picture was when they made the input (their own lead plus how far
// behind they draw everyone else), capped at MAX_VIEW_LAG_TICKS, so a game
// can check their shots against what they saw. `rttMs` is their round trip.
export interface PlayerTick {
  readonly slot: number
  readonly input: PlayerInput
  readonly presence: Presence
  readonly viewLagTicks: number
  readonly rttMs: number
}

// NOTE: 250 ms at 60 Hz: the furthest back a shot is ever checked.
export const MAX_VIEW_LAG_TICKS = 15

export interface Score {
  readonly slot: number
  readonly score: number
}

// NOTE: own-player prediction. `of` finds this player's part of a world,
// `put` puts a predicted one back, `step` runs one tick of it from local
// input (movement only: hits, money, and deaths stay the room's), `gap`
// says how far apart two are in pixels, and `blend` eases a shown copy
// toward the predicted one.
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
  // NOTE: how an over world ended: Won lets the lobby offer to keep going,
  // LeftEarly is a crew out a back door, and anything else is GameOver.
  readonly endReason: (world: W) => RunEndReason
  readonly scores: (world: W) => ReadonlyArray<Score>
  // NOTE: the wire. `snapshot` writes the whole world as a client needs
  // it; `diff` writes what changed from `prev` to `next`, comparing values
  // as the client will read them back, so a client that applies every diff
  // holds exactly what `readSnapshot` would give.
  readonly snapshot: (writer: Writer, world: W) => void
  readonly readSnapshot: (reader: Reader) => W
  readonly diff: (writer: Writer, prev: W, next: W) => void
  readonly applyDiff: (reader: Reader, prev: W) => W
  readonly interpolate: (from: W, to: W, t: number) => W
  readonly own: OwnPlayer<W, Own>
}
