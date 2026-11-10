import { Array, Option, Schema } from 'effect'

import type { WorldState } from '../../domain/coopRoom'
import { RATTLES_BOX } from '../../world/level/arena'
import { playersOf } from '../../world/party/party'
import { AUDIT_PARAM, ReadoutJson } from './readout'

// The room's World read out for the co-op audit (tools/audit/coop.ts), on
// the arena's page when the audit asks for it.

const encodeReadout = Schema.encodeOption(ReadoutJson)

// NOTE: read once, when the page loads (the room link drops the param
// after joining), so a frame never asks. Nothing is encoded without it.
const IS_AUDITED =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has(AUDIT_PARAM)

// NOTE: the World as the audit's readout, through its Schema
// (src/features/coop/readout.ts), or nothing when the page was not asked for one.
export const readoutOf = (room: WorldState): string =>
  IS_AUDITED
    ? Option.getOrElse(encodeReadout(readoutFields(room)), () => '')
    : ''

const readoutFields = (room: WorldState) => ({
  tick: room.tick,
  phase: room.world.phase._tag,
  mode: room.world.mode._tag,
  difficulty: room.world.difficulty.chosen,
  wave: 'wave' in room.world.phase ? room.world.phase.wave : 0,
  keys: room.world.keys.held,
  rattles: RATTLES_BOX,
  zombies: Array.map(room.world.zombies, zombie => ({
    x: Math.round(zombie.x),
    y: Math.round(zombie.y),
  })),
  players: Array.map(
    playersOf(room.world),
    ({ seat: { slot }, player, seat }) => ({
      slot,
      x: Math.round(player.x * 10) / 10,
      y: Math.round(player.y * 10) / 10,
      hp: player.hp,
      calling: player.calling,
      life: seat.life._tag,
      ready: seat.readiness,
      kills: seat.kills,
    }),
  ),
})
