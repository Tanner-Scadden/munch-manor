import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type ClientFrame,
  type Dot,
  MOVE_SCALE,
  NEUTRAL_INPUT,
  type PlayerInput,
  Room,
  type ServerFrame,
  Session,
  StandIn,
  type StandInWorld,
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  encodeServerFrame,
  webSocketBytes,
} from '../src/index'

// NOTE: a room and several sessions over a fake network with a fixed
// one-way delay, every frame encoded to bytes and decoded on the far side,
// as the Durable Object and the browser do.

type ClientSession = Session.Session<StandInWorld, Dot>

interface InFlight {
  readonly atMs: number
  readonly bytes: Uint8Array
}

interface Client {
  readonly slot: number
  readonly socket: string
  session: ClientSession
  toRoom: Array<InFlight>
  toClient: Array<InFlight>
  inputsSent: number
  muted: boolean
  seen: Array<StandInWorld>
  viewTicks: Array<number>
  pongs: Array<{ readonly sentMs: number; readonly atMs: number }>
  pingedMs: number
}

// NOTE: the socket's free ping, which the room's Durable Object answers by
// itself, every 2 s.
const PING_EVERY_MS = 2000

const T0 = 5_000_000

// NOTE: each player walks a square, turning every 0.7 s, slot by slot out
// of step.
const scripted = (slot: number, nowMs: number): PlayerInput => {
  const leg = Math.floor((nowMs - T0 + slot * 300) / 700) % 4
  const moves: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  const [x, y] = moves[leg] ?? [0, 0]
  return { ...NEUTRAL_INPUT, moveX: x * MOVE_SCALE, moveY: y * MOVE_SCALE }
}

const simulate = (options: {
  readonly players: number
  readonly oneWayMs: number
  readonly seconds: number
  readonly muteSlotAfterMs?: number
  readonly jitterMs?: number
  // NOTE: every this many messages each way is held 200 ms, as a lost TCP
  // segment's resend holds it, and everything behind it waits in order.
  readonly holdEvery?: number
}) => {
  const heldMs = (count: number) =>
    options.holdEvery !== undefined && count % options.holdEvery === 0 ? 200 : 0
  const clients: Array<Client> = globalThis.Array.from(
    { length: options.players },
    (_, slot) => ({
      slot,
      socket: `socket-${slot}`,
      session: Session.makeSession<StandInWorld, Dot>(T0),
      toRoom: [],
      toClient: [],
      inputsSent: 0,
      muted: false,
      seen: [],
      viewTicks: [],
      pongs: [],
      pingedMs: T0 - PING_EVERY_MS,
    }),
  )
  const started = Room.startRoom(
    StandIn,
    Array.map(clients, client => ({
      slot: client.slot,
      playerId: `player-${client.slot}`,
      socket: Option.some(client.socket),
    })),
    11,
    T0,
  )
  const room = {
    current: started.room,
    nextWakeMs: Room.nextWakeMs(started.room),
  }
  const bytesDown = { total: 0 }

  const sends = { count: 0 }
  const ups = { count: 0 }
  const deliverOut = (out: ReadonlyArray<Room.Out>, nowMs: number) =>
    Array.forEach(out, item => {
      if (item._tag !== 'Send') {
        return
      }
      const client = Option.getOrUndefined(
        Array.findFirst(clients, each => each.socket === item.socket),
      )
      const bytes = Result.getOrThrow(encodeServerFrame(item.frame))
      bytesDown.total += webSocketBytes(bytes.length, false)
      const sent = (sends.count += 1)
      const late = ((sent * 7919) % 101) / 100
      const atMs = Math.max(
        client?.toClient.at(-1)?.atMs ?? 0,
        nowMs +
          options.oneWayMs +
          late * (options.jitterMs ?? 0) +
          heldMs(sent),
      )
      client?.toClient.push({ atMs, bytes })
    })

  deliverOut(started.out, T0)

  const endMs = T0 + options.seconds * 1000
  const stepMs = 4
  const frameMs = 1000 / 60
  const frames = { next: T0 }

  Array.forEach(
    globalThis.Array.from({ length: Math.ceil((endMs - T0) / stepMs) }),
    (_, index) => {
      const nowMs = T0 + index * stepMs
      Array.forEach(clients, client => {
        const arrived = Array.filter(
          client.toRoom,
          message => message.atMs <= nowMs,
        )
        client.toRoom = Array.filter(
          client.toRoom,
          message => message.atMs > nowMs,
        )
        Array.forEach(arrived, message => {
          const frame = Result.getOrThrow(decodeClientFrame(message.bytes))
          const received = Room.receive(
            StandIn,
            room.current,
            client.socket,
            frame,
            nowMs,
          )
          room.current = received.room
          deliverOut(received.out, nowMs)
        })
      })
      if (nowMs >= room.nextWakeMs) {
        const advanced = Room.advance(StandIn, room.current, nowMs)
        room.current = advanced.room
        room.nextWakeMs = Room.nextWakeMs(advanced.room)
        deliverOut(advanced.out, nowMs)
      }
      Array.forEach(clients, client => {
        const arrived = Array.filter(
          client.toClient,
          message => message.atMs <= nowMs,
        )
        client.toClient = Array.filter(
          client.toClient,
          message => message.atMs > nowMs,
        )
        Array.forEach(arrived, message => {
          const frame = Result.getOrThrow(decodeServerFrame(message.bytes))
          client.session = Result.getOrThrow(
            Session.receive(
              StandIn,
              client.session,
              frame,
              message.bytes.length,
              nowMs,
            ),
          )
        })
      })
      Array.forEach(clients, client => {
        const ponged = Array.filter(client.pongs, pong => pong.atMs <= nowMs)
        client.pongs = Array.filter(client.pongs, pong => pong.atMs > nowMs)
        Array.forEach(ponged, pong => {
          client.session = Session.heardPong(client.session, pong.sentMs, nowMs)
        })
        if (nowMs - client.pingedMs >= PING_EVERY_MS) {
          client.pingedMs = nowMs
          client.pongs.push({
            sentMs: nowMs,
            atMs: nowMs + 2 * options.oneWayMs,
          })
        }
      })
      if (nowMs >= frames.next) {
        frames.next += frameMs
        Array.forEach(clients, client => {
          client.muted =
            options.muteSlotAfterMs !== undefined &&
            client.slot === 1 &&
            nowMs - T0 > options.muteSlotAfterMs
          const ticked = Session.tickInput(
            StandIn,
            client.session,
            scripted(client.slot, nowMs),
            nowMs,
          )
          client.session = ticked.session
          if (!client.muted) {
            Array.forEach(ticked.outgoing, (frame: ClientFrame) => {
              const bytes = Result.getOrThrow(encodeClientFrame(frame))
              client.inputsSent += frame._tag === 'Input' ? 1 : 0
              client.session = Session.countSent(client.session, bytes.length)
              const up = (ups.count += 1)
              client.toRoom.push({
                atMs: Math.max(
                  client.toRoom.at(-1)?.atMs ?? 0,
                  nowMs + options.oneWayMs + heldMs(up + 7),
                ),
                bytes,
              })
            })
          }
          const rendered = Session.render(StandIn, client.session, nowMs)
          client.session = rendered.session
          Option.map(rendered.world, world => client.seen.push(world))
          client.viewTicks.push(Session.viewTickAt(client.session, nowMs))
        })
      }
    },
  )
  return { clients, room: room.current, bytesDown: bytesDown.total }
}

const xsOf = (worlds: ReadonlyArray<StandInWorld>, slot: number) =>
  Array.flatMap(worlds, world =>
    Option.match(StandIn.own.of(world, slot), {
      onNone: () => [],
      onSome: dot => [Math.round(dot.x)],
    }),
  )

describe('sessions and a room over a 60 ms round trip', () => {
  const run = simulate({ players: 4, oneWayMs: 30, seconds: 8 })

  test('each player sees every other player move', () => {
    Array.forEach(run.clients, client => {
      Array.forEach(
        Array.filter(run.clients, other => other.slot !== client.slot),
        other => {
          const xs = new Set(xsOf(client.seen, other.slot))
          expect(xs.size).toBeGreaterThan(20)
        },
      )
    })
  })

  // NOTE: the first turn can land a few ticks late while the round trip
  // is still unknown; after that the room applies every turn on its tick.
  test('own prediction agrees with the room once the clock settles', () => {
    Array.forEach(run.clients, client => {
      expect(client.session.stats.corrections).toBeLessThanOrEqual(3)
      expect(client.session.stats.maxCorrectionPx).toBeLessThanOrEqual(7.5)
      expect(client.session.stats.lastCorrectionPx).toBeLessThan(0.5)
    })
  })

  test('the room acks inputs and the clock measures the round trip', () => {
    Array.forEach(run.clients, client => {
      expect(client.session.ack).toBeGreaterThanOrEqual(client.inputsSent - 2)
      expect(client.session.ack).toBeGreaterThan(5)
      expect(client.session.rttMs).toBeGreaterThan(55)
      expect(client.session.rttMs).toBeLessThan(80)
    })
  })

  test('inputs go out on change at most 10 a second', () => {
    Array.forEach(run.clients, client => {
      expect(client.inputsSent / 8).toBeLessThanOrEqual(10)
      expect(client.inputsSent / 8).toBeGreaterThanOrEqual(1)
    })
  })

  test('four players get well under 2 KB a second each', () => {
    const perPlayerPerSecond = run.bytesDown / 4 / 8
    expect(perPlayerPerSecond).toBeLessThan(2048)
    expect(perPlayerPerSecond).toBeGreaterThan(200)
  })

  test('the room and every client end at the same tick within the buffer', () => {
    Array.forEach(run.clients, client => {
      const newest = client.session.frames.at(-1)
      expect(run.room.tick - (newest?.tick ?? 0)).toBeLessThanOrEqual(6)
    })
  })
})

describe('the delay to draw everyone else behind', () => {
  test('stays short on a steady link and grows with jitter', () => {
    const steady = simulate({ players: 2, oneWayMs: 30, seconds: 8 })
    const jittery = simulate({
      players: 2,
      oneWayMs: 100,
      jitterMs: 60,
      seconds: 8,
    })
    Array.forEach(steady.clients, client => {
      expect(client.session.interpolationMs).toBeLessThan(80)
      expect(client.session.interpolationMs).toBeGreaterThanOrEqual(
        Session.MIN_INTERPOLATION_MS,
      )
    })
    Array.forEach(jittery.clients, client => {
      expect(client.session.interpolationMs).toBeGreaterThan(90)
      expect(client.session.interpolationMs).toBeLessThanOrEqual(
        Session.MAX_INTERPOLATION_MS,
      )
      expect(client.session.rttMs).toBeGreaterThan(190)
    })
  })

  test('the room learns every view lag and round trip from inputs', () => {
    const run = simulate({ players: 2, oneWayMs: 100, seconds: 4 })
    Array.forEach(run.room.seats, seat => {
      expect(seat.rttMs).toBeGreaterThan(190)
      expect(seat.viewLagTicks).toBeGreaterThan(8)
      expect(seat.viewLagTicks).toBeLessThanOrEqual(15)
    })
    Array.forEach(run.clients, client => {
      expect(Array.map(client.session.rtts, ping => ping.slot)).toEqual([0, 1])
    })
  })
})

describe('a player who goes quiet', () => {
  test('is Away for everyone else after 3 seconds', () => {
    const run = simulate({
      players: 2,
      oneWayMs: 40,
      seconds: 6,
      muteSlotAfterMs: 1000,
    })
    expect(run.clients[0]?.session.away).toEqual([1])
    expect(run.room.seats[1]?.presence._tag).toBe('Away')
  })
})

describe('a link that holds messages up behind a resend', () => {
  const steady = simulate({ players: 2, oneWayMs: 100, seconds: 10 })
  const held = simulate({
    players: 2,
    oneWayMs: 100,
    seconds: 10,
    holdEvery: 41,
  })

  test('each player still sees the other move', () => {
    Array.forEach(held.clients, client => {
      Array.forEach(
        Array.filter(held.clients, other => other.slot !== client.slot),
        other => {
          expect(new Set(xsOf(client.seen, other.slot)).size).toBeGreaterThan(
            20,
          )
        },
      )
    })
  })

  test('counts the stalls and never needs a resync', () => {
    Array.forEach(held.clients, client => {
      expect(client.session.stats.stalls).toBeGreaterThan(3)
      expect(client.session.stats.longestStallMs).toBeGreaterThanOrEqual(240)
      expect(client.session.stats.resyncs).toBe(0)
    })
    Array.forEach(steady.clients, client => {
      expect(client.session.stats.stalls).toBe(0)
    })
  })

  // NOTE: the message a resend held up arrives late, which once jumped the
  // clock back: everyone drawn ran backwards and your own inputs stopped
  // until the clock passed them again.
  test('the picture never runs backwards', () => {
    Array.forEach(held.clients, client => {
      const backwards = Array.reduce(client.viewTicks, 0, (most, tick, index) =>
        Math.max(most, (client.viewTicks[index - 1] ?? tick) - tick),
      )
      expect(backwards).toBeLessThan(2)
    })
  })

  test('the room still applies nearly every input', () => {
    Array.forEach(held.clients, client => {
      expect(client.session.ack).toBeGreaterThanOrEqual(client.inputsSent - 4)
    })
  })
})

describe('a message that cannot apply', () => {
  const started = Room.startRoom(
    StandIn,
    [{ slot: 0, playerId: 'player-0', socket: Option.some('socket-0') }],
    11,
    T0,
  )
  const framesOf = (out: ReadonlyArray<Room.Out>): Array<ServerFrame> =>
    Array.flatMap(out, item => (item._tag === 'Send' ? [item.frame] : []))
  const deltas = Array.reduce<
    number,
    {
      readonly room: Room.Room<StandInWorld>
      readonly frames: ReadonlyArray<ServerFrame>
    }
  >([1, 2, 3], { room: started.room, frames: [] }, (at, step) => {
    const advanced = Room.advance(StandIn, at.room, T0 + step * 50 + 1)
    return {
      room: advanced.room,
      // NOTE: three steps.
      // oxlint-disable-next-line munch/no-append-in-reduce
      frames: [...at.frames, ...framesOf(advanced.out)],
    }
  }).frames
  const receiveAll = (
    session: ClientSession,
    frames: ReadonlyArray<ServerFrame>,
  ) =>
    Array.reduce(frames, session, (current, frame, index) =>
      Result.getOrThrow(
        Session.receive(StandIn, current, frame, 8, T0 + index * 50),
      ),
    )
  const joined = receiveAll(
    Session.makeSession<StandInWorld, Dot>(T0),
    framesOf(started.out),
  )

  test('the room sends three Deltas in a row', () => {
    expect(Array.map(deltas, frame => frame._tag)).toEqual([
      'Delta',
      'Delta',
      'Delta',
    ])
  })

  test('a Delta ahead of its base asks for a resync once and sets the rest aside', () => {
    const skipped = receiveAll(joined, deltas.slice(1))
    expect(skipped.isResyncing).toBe(true)
    expect(skipped.stats.resyncs).toBe(1)
    expect(Array.map(skipped.frames, frame => frame.tick)).toEqual(
      Array.map(joined.frames, frame => frame.tick),
    )
  })

  test('a Snapshot ends the resync', () => {
    const snapshot = Option.getOrUndefined(
      Array.findFirst(
        framesOf(started.out),
        frame => frame._tag === 'Snapshot',
      ),
    )
    const back = receiveAll(
      receiveAll(joined, deltas.slice(1)),
      snapshot === undefined ? [] : [snapshot],
    )
    expect(snapshot?._tag).toBe('Snapshot')
    expect(back.isResyncing).toBe(false)
    expect(back.stats.resyncs).toBe(1)
  })

  test('Deltas in order never resync', () => {
    const inOrder = receiveAll(joined, deltas)
    expect(inOrder.isResyncing).toBe(false)
    expect(inOrder.frames.length).toBe(4)
  })
})
