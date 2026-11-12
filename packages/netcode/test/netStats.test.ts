import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type ClientFrame,
  NEUTRAL_INPUT,
  NetStats,
  Room,
  Session,
  StandIn,
  type StandInWorld,
} from '../src/index'

const T0 = 1_000_000

const histogramOf = (samples: ReadonlyArray<number>): NetStats.Histogram =>
  Array.reduce(samples, NetStats.emptyHistogram, (histogram, sample) =>
    NetStats.recordSample(histogram, sample),
  )

const started = () =>
  Room.startRoom(
    StandIn,
    [
      { slot: 0, playerId: 'player-0', socket: Option.some('socket-0') },
      { slot: 1, playerId: 'player-1', socket: Option.some('socket-1') },
    ],
    42,
    T0,
  )

const inputFrame = (seq: number, tick: number, ticks: number): ClientFrame => ({
  _tag: 'Input',
  seq,
  tick,
  seen: Math.max(0, tick - 6),
  rttMs: 80,
  samples: Array.makeBy(ticks, () => ({ ticks: 1, input: NEUTRAL_INPUT })),
})

const seatReport = (room: Room.Room<StandInWorld>, slot: number) =>
  Option.getOrThrow(
    Array.findFirst(Room.netReportOf(room).seats, seat => seat.slot === slot),
  )

describe('the round trip histogram', () => {
  test('reads the median and the 95th percentile by bucket', () => {
    const histogram = histogramOf([
      ...Array.makeBy(90, () => 42),
      ...Array.makeBy(10, () => 305),
    ])
    expect(NetStats.medianOf(histogram)).toBe(45)
    expect(NetStats.p95Of(histogram)).toBe(305)
    expect(histogram.total).toBe(100)
  })

  test('says 0 with no samples, and the top for a sample past it', () => {
    expect(NetStats.medianOf(NetStats.emptyHistogram)).toBe(0)
    expect(NetStats.medianOf(histogramOf([9_000]))).toBe(NetStats.OVERFLOW_MS)
  })
})

describe('the client tally', () => {
  test('counts a Delta late by more than a send, and by how much', () => {
    const net = Array.reduce(
      [3, -4, 120, 80, 10],
      NetStats.emptyClientNet,
      (tally, offMs) => NetStats.arrivedOff(tally, offMs),
    )
    const report = NetStats.clientNetReportOf(net)
    expect(report.snapshots).toBe(5)
    expect(report.lateSnapshots).toBe(2)
    expect(report.lateMsMean).toBe(100)
    expect(report.lateMsMax).toBe(120)
    expect(report.jitterMs).toBe(43)
  })

  test('a dropped link that connects again is one reconnect', () => {
    const fresh = Session.makeSession<StandInWorld, unknown>(T0)
    const firstTry = Session.reconnecting(fresh, T0)
    expect(firstTry.stats.net.reconnects).toBe(0)
    const playing: Session.Session<StandInWorld, unknown> = {
      ...firstTry,
      phase: { _tag: 'Playing' },
    }
    const dropped = Session.reconnecting(playing, T0 + 1000)
    const retried = Session.reconnecting(dropped, T0 + 2000)
    expect(retried.stats.net.reconnects).toBe(1)
    expect(Session.startRunTally(retried).stats.net.reconnects).toBe(0)
  })

  test('each ping is one round trip sample', () => {
    const session = Session.heardPong(
      Session.heardPong(
        Session.makeSession<StandInWorld, unknown>(T0),
        T0,
        T0 + 70,
      ),
      T0 + 2000,
      T0 + 2130,
    )
    const report = NetStats.clientNetReportOf(session.stats.net)
    expect(report.rttSamples).toBe(2)
    expect(report.rttP50Ms).toBe(75)
    expect(report.rttP95Ms).toBe(135)
  })
})

describe('the room tally', () => {
  test('counts an Input with samples for ticks already run', () => {
    const atTick30 = Room.advance(StandIn, started().room, T0 + 500)
    expect(atTick30.room.tick).toBe(30)
    const late = Room.receive(
      StandIn,
      atTick30.room,
      'socket-0',
      inputFrame(1, 26, 6),
      T0 + 500,
    )
    const report = seatReport(late.room, 0)
    expect(report.inputs).toBe(1)
    expect(report.lateInputs).toBe(1)
    expect(report.droppedSamples).toBe(4)
    expect(report.maxLateTicks).toBe(4)
    expect(report.rttSamples).toBe(1)
    expect(report.rttP50Ms).toBe(85)
    expect(seatReport(late.room, 1).lateInputs).toBe(0)
  })

  test('counts a socket linked again as a reconnect', () => {
    const room = started().room
    const away = Room.unlink(room, 'socket-1', T0 + 100)
    const back = Option.getOrThrow(
      Room.link(StandIn, away.room, 'player-1', 'socket-1b', T0 + 200),
    )
    expect(seatReport(back.room, 1).reconnects).toBe(1)
    expect(seatReport(back.room, 0).reconnects).toBe(0)
  })

  test('counts a wake that owed too many ticks, and the ticks lost', () => {
    const onTime = Room.advance(StandIn, started().room, T0 + 50)
    const stalled = Room.advance(StandIn, onTime.room, T0 + 50 + 1000)
    const { lag } = Room.netReportOf(stalled.room)
    expect(lag.wakes).toBe(2)
    expect(lag.lateWakes).toBe(1)
    expect(lag.maxOwedTicks).toBe(60)
    expect(lag.lostTicks).toBe(60 - Room.MAX_CATCH_UP_TICKS)
  })
})
