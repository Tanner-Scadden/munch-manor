import { Array, Schema } from 'effect'

import { UiStruct } from '@effect/ui'
import { freshGun } from '@game/world/gear/weapons'
import {
  DEFAULT_ROOM_SETTINGS,
  ROOM_WORLD,
  type RoomWorld,
  startRoomWorld,
} from '@game/world/net/roomWorld'
import { modifySeat } from '@game/world/party/party'
import {
  Arsenal,
  Frenzy,
  Phase,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from '@game/world/schema/worldSchema'
import { ZOMBIE_KINDS } from '@game/world/zombies/zombies'

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
    modifySeat(world, slot, {
      player: player => ({
        ...player,
        hp: 999,
        arsenal: Arsenal.OneGun({
          first: freshGun('Smg'),
        }),
      }),
    }),
  )
  const firstId = seated.nextEntityId
  return {
    ...room,
    world: UiStruct.evolve(seated, {
      phase: () => Phase.Wave({ wave: 8, elapsedMs: 0, spawns: [NEVER_SPAWN] }),
      zombies: () =>
        Array.makeBy(zombies, index =>
          crowdZombie(firstId + index, index, zombies),
        ),
      nextEntityId: () => firstId + zombies,
    }),
  }
}

export const crowdedWorld = (zombies: number) => ({
  ...ROOM_WORLD,
  start: (slots: ReadonlyArray<number>, seed: number): RoomWorld =>
    crowdedRoom(slots, zombies, seed),
})

export const LiveRoomRequest = Schema.TaggedUnion({
  Start: { seats: Schema.Finite, zombies: Schema.Finite },
  Send: { bytes: Schema.Uint8Array },
})
export type LiveRoomRequest = typeof LiveRoomRequest.Type
