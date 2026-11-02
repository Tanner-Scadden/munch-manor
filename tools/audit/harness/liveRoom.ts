// NOTE: the live co-op room the harness plays for `coop=live`: wave 8 under
// way with a crowd that never thins, every seat with an SMG that never runs
// dry and hearts to spare, so the page measures a moving World of a steady
// size. The room runs in a Web Worker (liveRoom.worker.ts) and the page talks
// to it through liveNet.ts.

import { Array, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { withSeat } from '@game/party'
import {
  DEFAULT_ROOM_SETTINGS,
  ROOM_WORLD,
  type RoomWorld,
  startRoomWorld,
} from '@game/roomWorld'
import { freshGun } from '@game/weapons'
import {
  Arsenal,
  Frenzy,
  Phase,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from '@game/worldSchema'
import { ZOMBIE_KINDS } from '@game/zombies'

// NOTE: `coop=live`'s room without `seats` or `crowd`.
export const LIVE_SEATS = 4
export const LIVE_CROWD = 40

const CROWD_KINDS: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Shambler',
  'Runner',
  'Shambler',
  'Tank',
  'Runner',
]

// NOTE: so many hit points no seat ever kills one in a measurement.
const UNKILLABLE_HP = 1e7

const crowdZombie = (id: number, index: number, count: number): Zombie => {
  const kind = CROWD_KINDS[index % CROWD_KINDS.length] ?? 'Shambler'
  const stats = ZOMBIE_KINDS[kind]
  const ring = index % 2 === 0 ? 70 : 120
  const angle = (index / count) * Math.PI * 2
  return {
    id,
    kind,
    x: 160 + Math.cos(angle) * ring,
    y: 90 + Math.sin(angle) * ring * 0.5,
    speed: (stats.speedMin + stats.speedMax) / 2,
    hp: UNKILLABLE_HP,
    maxHp: UNKILLABLE_HP,
    knockback: { x: 0, y: 0 },
    hitRemainingMs: 0,
    state: ZombieState.Walking(),
    action: ZombieAction.Roaming(),
    frenzy: Frenzy.Calm(),
  }
}

// NOTE: one planned spawn far in the future, so the wave never ends.
const NEVER_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const crowdedRoom = (
  slots: ReadonlyArray<number>,
  zombies: number,
  seed: number,
): RoomWorld => {
  const room = startRoomWorld(slots, seed, DEFAULT_ROOM_SETTINGS)
  const seated = Array.reduce(slots, room.world, (world, slot) =>
    withSeat(world, slot, seatWorld =>
      modifyFields(seatWorld, {
        player: player => ({
          ...player,
          hp: 999,
          arsenal: Arsenal.OneGun({
            first: { ...freshGun('Smg'), rounds: UNKILLABLE_HP },
          }),
        }),
      }),
    ),
  )
  const firstId = seated.nextEntityId
  return {
    ...room,
    world: modifyFields(seated, {
      phase: () => Phase.Wave({ wave: 8, elapsedMs: 0, spawns: [NEVER_SPAWN] }),
      zombies: () =>
        Array.makeBy(zombies, index =>
          crowdZombie(firstId + index, index, zombies),
        ),
      nextEntityId: () => firstId + zombies,
    }),
  }
}

// NOTE: the room's World, started crowded with `zombies` zombies.
export const crowdedWorld = (zombies: number) => ({
  ...ROOM_WORLD,
  start: (slots: ReadonlyArray<number>, seed: number): RoomWorld =>
    crowdedRoom(slots, zombies, seed),
})

// NOTE: what the page asks of the room's Worker: start the room, or take a
// frame from the page's seat.
export const LiveRoomRequest = Schema.TaggedUnion({
  Start: { seats: Schema.Number, zombies: Schema.Number },
  Send: { bytes: Schema.Uint8Array },
})
export type LiveRoomRequest = typeof LiveRoomRequest.Type
