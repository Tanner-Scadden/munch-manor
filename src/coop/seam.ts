import { Array, Option, Schema, SchemaTransformation } from 'effect'

import { Session, type World } from '@munch/netcode'

import { playersOf, shopOf } from '../party'
import { type OwnSeat, ROOM_WORLD, type RoomWorld } from '../roomWorld'
import { STALL_BOX } from '../shop'

// THE SEAM
//
// NOTE: the one place co-op names the world it plays: the game's own World
// in a room (src/roomWorld.ts), the same one the GameRoom runs. The client
// never starts or steps it; it reads the room's snapshots and diffs back,
// interpolates them, and predicts its own player with it. Nothing else in
// src/coop reads the world's insides; the root draws it with the game's
// own scene (src/coopPlay.ts).

export type WorldState = RoomWorld
export type OwnPlayer = OwnSeat

export const coopWorld: World<WorldState, OwnPlayer> = ROOM_WORLD

// SCHEMAS

// NOTE: the Session and the world are plain data from packages/netcode and
// src/roomWorld.ts, held in the Model as opaque values. Only Session's pure
// functions and the seam above read them.
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

// NOTE: a Session is a live connection's state, so it is never written
// out: a Model kept across a dev reload holds a fresh one, and the room
// sends a snapshot on the reconnect.
export const RoomSession = Schema.declare(
  (value: unknown): value is Session.Session<WorldState, OwnPlayer> =>
    isObject(value) && 'phase' in value && 'frames' in value,
  {
    toCodecJson: () =>
      Schema.link<Session.Session<WorldState, OwnPlayer>>()(
        Schema.Null,
        SchemaTransformation.transform({
          decode: () => Session.makeSession<WorldState, OwnPlayer>(0),
          encode: () => null,
        }),
      ),
  },
)
export type RoomSession = typeof RoomSession.Type

export const WorldState = Schema.declare(
  (value: unknown): value is WorldState =>
    isObject(value) && 'tick' in value && 'world' in value,
)

// READOUT

// NOTE: what the room's World holds, as one line of JSON on the arena's
// hidden link element, for the audit harness (tools/audit/coop.ts): the
// phase, the zombies, the stall, and each player.
export const readoutOf = (room: WorldState): string =>
  JSON.stringify({
    tick: room.tick,
    phase: room.world.phase._tag,
    mode: room.world.mode._tag,
    difficulty: room.world.difficulty.chosen,
    wave: 'wave' in room.world.phase ? room.world.phase.wave : 0,
    stall: STALL_BOX,
    zombies: Array.map(room.world.zombies, zombie => ({
      x: Math.round(zombie.x),
      y: Math.round(zombie.y),
    })),
    players: Array.map(
      playersOf(room.world),
      ({ slot, player, seat, wallet }) => ({
        slot,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        hp: player.hp,
        life: seat.life._tag,
        ready: seat.readiness,
        kills: seat.kills,
        money: wallet.balance,
        shop: Option.getOrElse(
          Option.map(shopOf(room.world, slot), shop => shop._tag),
          () => 'Away',
        ),
      }),
    ),
  })
