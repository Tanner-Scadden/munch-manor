import { Array, Console } from 'effect'

import { describe, expect, it, test } from '@effect/vitest'
import { Session } from '@munch/netcode'

import {
  DRAW_EVERY,
  mean,
  percentile,
  simulateRoom,
} from '../../../test/roomTesting'

// NOTE: four scripted players in a room over a 60 ms round trip, every
// message through the real codecs, into the crowded waves (MULTIPLAYER.md,
// "The wire at 20 Hz"). The players get 500 hearts so they last that long.
// The numbers it logs are the ones "What Phase 2 built" reports.

const PLAYERS = 4
const SECONDS = 100

const run = simulateRoom({
  players: PLAYERS,
  oneWayMs: 30,
  seconds: SECONDS,
  hearts: 500,
})

const kilobytesPerSecond = (bytesPerMessage: number): number =>
  (bytesPerMessage * 20) / 1024

const perPlayerKbps = run.bytesDown / PLAYERS / run.seconds / 1024

// NOTE: this sim test reports the wire's bandwidth for MULTIPLAYER.md.
const report = Array.join(
  [
    `co-op wire, ${PLAYERS} players, ${run.seconds} s to wave ${run.room.world.world.phase._tag === 'Wave' || run.room.world.world.phase._tag === 'Preparation' ? run.room.world.world.phase.wave : '?'}:`,
    `  bytes a message p50 ${percentile(run.messageBytes, 0.5)}, p95 ${percentile(run.messageBytes, 0.95)}, max ${Math.max(...run.messageBytes)}, mean ${Math.round(mean(run.messageBytes))}`,
    `  crowded (15+ alive, ${run.crowdedBytes.length} messages) p50 ${percentile(run.crowdedBytes, 0.5)}, p95 ${percentile(run.crowdedBytes, 0.95)}, mean ${Math.round(mean(run.crowdedBytes))}`,
    `  per player ${perPlayerKbps.toFixed(2)} KB/s on average, ${kilobytesPerSecond(mean(run.crowdedBytes)).toFixed(2)} KB/s crowded, ${kilobytesPerSecond(percentile(run.crowdedBytes, 0.95)).toFixed(2)} KB/s at the crowded p95`,
    ...Array.map(
      run.clients,
      client =>
        `  player ${client.slot + 1}: ${client.session.stats.corrections} corrections, at most ${client.session.stats.maxCorrectionPx.toFixed(1)} px, ${client.inputsSent} inputs`,
    ),
  ],
  '\n',
)

describe('four players in a crowded room', () => {
  // NOTE: the report goes to the real console; `it.effect`'s TestConsole
  // would keep it.
  it.live('reports the wire for MULTIPLAYER.md', () => Console.log(report))

  test('the waves get crowded', () => {
    expect(run.crowdedBytes.length).toBeGreaterThan(500)
  })

  test('the wire stays near the 6 KB a second estimated', () => {
    expect(perPlayerKbps).toBeLessThan(8)
    expect(kilobytesPerSecond(mean(run.crowdedBytes))).toBeLessThan(9)
    expect(percentile(run.crowdedBytes, 0.95)).toBeLessThan(900)
  })

  test('every player draws the room and their own player stays close', () => {
    Array.forEach(run.clients, client => {
      expect(client.shown).toBeGreaterThan((SECONDS * 50) / DRAW_EVERY)
      expect(client.session.stats.maxCorrectionPx).toBeLessThan(
        Session.SNAP_DISTANCE,
      )
      expect(client.inputsSent / run.seconds).toBeLessThanOrEqual(10)
    })
  })
})
