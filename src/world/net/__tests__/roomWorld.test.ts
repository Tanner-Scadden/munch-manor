import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { NEUTRAL_INPUT, makeReader, makeWriter } from '@munch/netcode'

import { initialModel } from '../../../app/pureApp'
import { freshRun } from '../../../app/runReset'
import { INTENSITY_PER_HEART } from '../../../shared/constants'
import { holdingSecond } from '../../../test/arsenals'
import { withSeat } from '../../../test/model.fixture'
import {
  TWO_SEAT_ROOM,
  playRoom,
  scriptedTicks,
} from '../../../test/roomTesting'
import { zombieAt } from '../../../test/testing'
import { openExitIn } from '../../level/arena'
import { maybePlayerAt, modifyFocus } from '../../party/party'
import {
  Phase,
  RunMode,
  freshLevel,
  idleIntent,
} from '../../schema/worldSchema'
import { SeatAction } from '../../step/stepWorld'
import { beginPreparation } from '../../waves/waves'
import {
  AIM_REACH,
  FIRE_BUTTON,
  INTERACT_BUTTON,
  type OwnSeat,
  ROOM_WORLD,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  inputOfIntent,
  intentOfInput,
  predictOwn,
  readRoomDiff,
  readRoomSnapshot,
  roomSettingsOf,
  roomWorldFor,
  seatActionOf,
  stepRoomWorld,
  writeRoomDiff,
  writeRoomSnapshot,
} from '../roomWorld'
import { isSameOnWire } from '../worldCodec'

const snapshotOf = (room: RoomWorld): Uint8Array => {
  const writer = makeWriter()
  writeRoomSnapshot(writer, room)
  return writer.finish()
}

const readBack = (room: RoomWorld): RoomWorld =>
  readRoomSnapshot(makeReader(snapshotOf(room)))

const diffOf = (prev: RoomWorld, next: RoomWorld): Uint8Array => {
  const writer = makeWriter()
  writeRoomDiff(writer, prev, next)
  return writer.finish()
}

// NOTE: wave 1 underway: its first zombies in, both players shooting.
const WAVE_TICKS = 600

type Followed = Readonly<{
  server: RoomWorld
  client: RoomWorld
  diffBytes: ReadonlyArray<number>
  serverEvents: number
  clientEvents: number
}>

const follow = (ticks: number): Followed => {
  const sent = { at: TWO_SEAT_ROOM, client: readBack(TWO_SEAT_ROOM) }
  const counts = { server: 0, client: 0 }
  const diffBytes: Array<number> = []
  const server = playRoom(TWO_SEAT_ROOM, ticks, room => {
    counts.server += Array.reduce(
      Array.filter(room.events, entry => entry.tick === room.tick),
      0,
      (sum, entry) => sum + entry.events.length,
    )
    if (room.tick % 3 !== 0) {
      return
    }
    const bytes = diffOf(sent.at, room)
    diffBytes.push(bytes.length)
    const client = readRoomDiff(makeReader(bytes), sent.client)
    counts.client += Array.reduce(
      client.events,
      0,
      (sum, entry) => sum + entry.events.length,
    )
    sent.at = room
    sent.client = client
  })
  return {
    server,
    client: sent.client,
    diffBytes,
    serverEvents: counts.server,
    clientEvents: counts.client,
  }
}

const followed = follow(WAVE_TICKS)

describe('the room World on the wire', () => {
  test('a snapshot reads back as the room World', () => {
    const read = readBack(followed.server)
    expect(read.tick).toBe(followed.server.tick)
    expect(isSameOnWire(read.world, followed.server.world)).toBe(true)
    expect(snapshotOf(read)).toEqual(snapshotOf(followed.server))
  })

  test('a client applying every diff holds what a snapshot holds', () => {
    expect(followed.server.world.zombies.length).toBeGreaterThan(0)
    expect(followed.client.tick).toBe(followed.server.tick)
    expect(followed.client.world).toEqual(readBack(followed.server).world)
  })

  test('every event of every tick rides with a diff', () => {
    expect(followed.serverEvents).toBeGreaterThan(10)
    expect(followed.clientEvents).toBe(followed.serverEvents)
  })

  test('a diff is small and an unchanged World is a few bytes', () => {
    expect(Math.max(...followed.diffBytes)).toBeLessThan(1500)
    expect(diffOf(followed.server, followed.server).length).toBeLessThan(4)
    expect(snapshotOf(followed.server).length).toBeLessThan(4096)
  })
})

describe('inputs and presses', () => {
  test('a press applies once however long it is held', () => {
    const armed = {
      ...TWO_SEAT_ROOM,
      world: withSeat(
        beginPreparation(TWO_SEAT_ROOM.world, 2, 20_000),
        1,
        world =>
          modifyFocus(world, {
            player: player =>
              modifyFields(player, {
                arsenal: () =>
                  holdingSecond({ kind: 'Smg', loaded: 30, tier: 0, kills: 0 }),
              }),
          }),
      ),
    }
    const inputsWith = (action: number) => [
      {
        slot: 0,
        input: NEUTRAL_INPUT,
        presence: 'Here' as const,
        viewLagTicks: 0,
        rttMs: 0,
      },
      {
        slot: 1,
        input: { ...NEUTRAL_INPUT, action },
        presence: 'Here' as const,
        viewLagTicks: 0,
        rttMs: 0,
      },
    ]
    const swap = heldAction(actionCodeOf(SeatAction.Swap()), 1)
    const holdFor = (ticks: number) =>
      Array.reduce(
        Array.makeBy(ticks, () => 0),
        armed,
        room => stepRoomWorld(room, inputsWith(swap)),
      )
    const handOf = (room: RoomWorld) =>
      Option.match(maybePlayerAt(room.world, 1), {
        onNone: () => 'Gone',
        onSome: ({ player }) => player.arsenal._tag,
      })
    const swapped = holdFor(10)
    expect(handOf(armed)).toBe('HoldingSecond')
    expect(handOf(holdFor(1))).toBe('HoldingFirst')
    expect(handOf(swapped)).toBe('HoldingFirst')
    const again = stepRoomWorld(
      swapped,
      inputsWith(heldAction(actionCodeOf(SeatAction.Swap()), 2)),
    )
    expect(handOf(again)).toBe('HoldingSecond')
  })

  test('every action reads back from its code', () => {
    const actions: ReadonlyArray<SeatAction> = [
      SeatAction.Swap(),
      SeatAction.Reload(),
      SeatAction.PlaceTrap(),
      SeatAction.NextTrap(),
      SeatAction.Ready(),
      SeatAction.Melee(),
      SeatAction.Draw({ slot: 'First' }),
      SeatAction.Draw({ slot: 'Second' }),
      SeatAction.CallMedic(),
    ]
    Array.forEach(actions, action => {
      expect(
        seatActionOf(TWO_SEAT_ROOM.world, heldAction(actionCodeOf(action), 14)),
      ).toEqual(Option.some(action))
    })
  })

  // NOTE: these codes are the wire. A client and a room on the same
  // protocol must agree on them, so removing or reordering an action moves
  // the codes after it and needs a PROTOCOL_VERSION bump
  // (packages/netcode/src/Protocol.ts). New actions and shop items go at
  // the end, where they leave every code here alone.
  test('every action keeps its wire code', () => {
    const pinned: ReadonlyArray<readonly [SeatAction, number]> = [
      [SeatAction.Swap(), 1],
      [SeatAction.Reload(), 2],
      [SeatAction.PlaceTrap(), 3],
      [SeatAction.NextTrap(), 4],
      [SeatAction.Ready(), 5],
      [SeatAction.Melee(), 6],
      [SeatAction.Draw({ slot: 'First' }), 7],
      [SeatAction.Draw({ slot: 'Second' }), 8],
      [SeatAction.CallMedic(), 9],
    ]
    Array.forEach(pinned, ([action, code]) => {
      expect(actionCodeOf(action)).toBe(code)
    })
  })

  test('the break waits for everyone and starts once both are READY', () => {
    const ready = heldAction(actionCodeOf(SeatAction.Ready()), 1)
    const step = (room: RoomWorld, actions: readonly [number, number]) =>
      stepRoomWorld(room, [
        {
          slot: 0,
          input: { ...NEUTRAL_INPUT, action: actions[0] },
          presence: 'Here',
          viewLagTicks: 0,
          rttMs: 0,
        },
        {
          slot: 1,
          input: { ...NEUTRAL_INPUT, action: actions[1] },
          presence: 'Here',
          viewLagTicks: 0,
          rttMs: 0,
        },
      ])
    const oneReady = step(step(TWO_SEAT_ROOM, [ready, 0]), [ready, 0])
    expect(Phase.isAnyOf(['Preparation'])(oneReady.world.phase)).toBe(true)
    const bothReady = step(step(oneReady, [ready, ready]), [ready, ready])
    expect(Phase.isAnyOf(['Wave'])(bothReady.world.phase)).toBe(true)
  })

  test('a player gone quiet is Away in the World', () => {
    const away = stepRoomWorld(TWO_SEAT_ROOM, [
      {
        slot: 0,
        input: NEUTRAL_INPUT,
        presence: 'Here',
        viewLagTicks: 0,
        rttMs: 0,
      },
      {
        slot: 1,
        input: NEUTRAL_INPUT,
        presence: 'Away',
        viewLagTicks: 0,
        rttMs: 0,
      },
    ])
    expect(
      Option.map(maybePlayerAt(away.world, 1), ({ seat }) => seat.presence),
    ).toEqual(Option.some('Away'))
  })

  test('an intent goes out as an input and comes back the same', () => {
    const intent = {
      move: { x: 0.6, y: -0.8 },
      maybeAim: Option.some({ x: 0, y: 1 }),
      trigger: 'Held' as const,
      interact: 'Released' as const,
    }
    const back = intentOfInput(inputOfIntent(intent, 0))
    expect(back.trigger).toBe('Held')
    expect(back.interact).toBe('Released')
    expect(back.move.x).toBeCloseTo(0.6, 2)
    expect(back.move.y).toBeCloseTo(-0.8, 2)
    expect(back.maybeAim).toEqual(Option.some({ x: 0, y: 1 }))
  })

  test('the interact hold rides as its own button, apart from the trigger', () => {
    const holding = { ...idleIntent, interact: 'Held' as const }
    const input = inputOfIntent(holding, 0)
    expect(input.buttons).toBe(INTERACT_BUTTON)
    expect(intentOfInput(input).interact).toBe('Held')
    expect(intentOfInput(input).trigger).toBe('Released')
  })
})

describe('own-player prediction', () => {
  test('predicting your walk lands where the room puts you', () => {
    const walk = {
      ...NEUTRAL_INPUT,
      moveX: 127,
      moveY: 40,
    }
    const room = Array.reduce(
      Array.makeBy(60, () => 0),
      TWO_SEAT_ROOM,
      current =>
        stepRoomWorld(current, [
          {
            slot: 0,
            input: NEUTRAL_INPUT,
            presence: 'Here',
            viewLagTicks: 0,
            rttMs: 0,
          },
          { slot: 1, input: walk, presence: 'Here', viewLagTicks: 0, rttMs: 0 },
        ]),
    )
    const own = Option.getOrThrow(ROOM_WORLD.own.of(TWO_SEAT_ROOM, 1))
    const predicted = Array.reduce(
      Array.makeBy(60, () => 0),
      own,
      current => predictOwn(current, walk, TWO_SEAT_ROOM),
    )
    const actual = Option.getOrThrow(ROOM_WORLD.own.of(room, 1))
    expect(predicted.player.x).toBeGreaterThan(own.player.x + 20)
    expect(ROOM_WORLD.own.gap(predicted, actual)).toBeLessThan(0.01)
  })

  test('predicting your trigger fires when the room does, gun and all', () => {
    const trigger = {
      ...NEUTRAL_INPUT,
      aimX: AIM_REACH,
      buttons: FIRE_BUTTON,
    }
    const ticks = Array.makeBy(40, () => 0)
    const rooms = Array.scan(ticks, TWO_SEAT_ROOM, current =>
      stepRoomWorld(current, [
        {
          slot: 0,
          input: NEUTRAL_INPUT,
          presence: 'Here',
          viewLagTicks: 0,
          rttMs: 0,
        },
        {
          slot: 1,
          input: trigger,
          presence: 'Here',
          viewLagTicks: 0,
          rttMs: 0,
        },
      ]),
    )
    const own = Option.getOrThrow(ROOM_WORLD.own.of(TWO_SEAT_ROOM, 1))
    const predictions = Array.scan(ticks, own, current =>
      predictOwn(current, trigger, TWO_SEAT_ROOM),
    )
    const gunOf = (player: OwnSeat['player']) => ({
      recoil: player.recoilRemainingMs,
      cooldown: player.fireCooldownMs,
      arsenal: player.arsenal,
    })
    expect(
      Array.map(predictions, predicted => gunOf(predicted.player)),
    ).toEqual(
      Array.map(rooms, room =>
        gunOf(Option.getOrThrow(ROOM_WORLD.own.of(room, 1)).player),
      ),
    )
    expect(
      Array.some(
        predictions,
        predicted => predicted.player.recoilRemainingMs > 0,
      ),
    ).toBe(true)
    expect(Option.getOrThrow(Array.last(predictions)).player.x).toBe(
      own.player.x,
    )
  })

  test('interpolating halfway puts a moving player halfway', () => {
    const later = playRoom(TWO_SEAT_ROOM, 12)
    const halfway = ROOM_WORLD.interpolate(TWO_SEAT_ROOM, later, 0.5)
    const xOf = (room: RoomWorld) =>
      Option.getOrThrow(maybePlayerAt(room.world, 0)).player.x
    expect(xOf(halfway)).toBeCloseTo((xOf(TWO_SEAT_ROOM) + xOf(later)) / 2, 5)
    expect(scriptedTicks(TWO_SEAT_ROOM).length).toBe(2)
  })
})

describe('the rolled house', () => {
  const SEEDS = Array.range(0, 23)
  const settings = roomSettingsOf('Campaign', 'Normal')

  test('a room stands in the house its seed rolls, as single player on that seed does', () => {
    Array.forEach(SEEDS, seed => {
      const room = roomWorldFor(settings).start([0, 1], seed)
      expect(room.world.level).toEqual(freshLevel(seed))
      expect(
        freshRun({ ...initialModel, rngState: seed }).level.arrangement,
      ).toEqual(room.world.level.arrangement)
    })
  })

  test('every client reads the same house off the wire, from a snapshot or the diffs', () => {
    const rolled = Array.dedupe(
      Array.map(SEEDS, seed => {
        const { West, East, Far } = roomWorldFor(settings).start([0, 1], seed)
          .world.level.arrangement
        return `${West}-${East}-${Far}`
      }),
    )
    expect(rolled.length).toBeGreaterThan(1)
    Array.forEach(SEEDS, seed => {
      const room = roomWorldFor(settings).start([0, 1], seed)
      expect(readBack(room).world.level).toEqual(room.world.level)
      const opened = {
        ...room,
        world: modifyFields(room.world, {
          level: level => openExitIn(level, 'West'),
        }),
      }
      const writer = makeWriter()
      writeRoomDiff(writer, room, opened)
      expect(
        readRoomDiff(makeReader(writer.finish()), readBack(room)).world.level,
      ).toEqual(opened.world.level)
    })
  })
})

describe('the lobby picks', () => {
  test('a room starts on the mode and difficulty the lobby picked', () => {
    const picked = roomWorldFor(roomSettingsOf('Endless', 'Hard')).start(
      [0, 1],
      7,
    )
    expect(picked.world.mode._tag).toBe('Endless')
    expect(picked.world.difficulty.chosen).toBe('Hard')
    const fresh = roomWorldFor(roomSettingsOf('Campaign', 'Normal')).start(
      [0, 1],
      7,
    )
    expect(fresh.world.mode._tag).toBe('Campaign')
  })

  test('an escape wins the room, and the next run starts fresh', () => {
    const escaped = modifyFields(TWO_SEAT_ROOM.world, {
      phase: () => Phase.Escaped({ wave: 12 }),
      elapsedMs: () => 600000,
    })
    const rules = roomWorldFor(roomSettingsOf('KeepGoing', 'Normal'))
    expect(rules.isWon({ ...TWO_SEAT_ROOM, world: escaped })).toBe(true)
    expect(rules.isOver({ ...TWO_SEAT_ROOM, world: escaped })).toBe(true)
    const next = rules.start([0, 1], 99)
    expect(next.world.elapsedMs).toBe(0)
    expect(next.world.mode._tag).toBe('Endless')
    expect(
      rules.isWon({
        ...TWO_SEAT_ROOM,
        world: modifyFields(escaped, { mode: () => RunMode.Endless() }),
      }),
    ).toBe(false)
  })
})

describe('the crew in the music', () => {
  test('a zombie close to any teammate, or a bitten teammate, raises the intensity', () => {
    // NOTE: the teammate stands in the open aisle south of the party table,
    // well east of the lead on the start spot.
    const apart = withSeat(TWO_SEAT_ROOM.world, 1, seatWorld =>
      modifyFocus(seatWorld, {
        player: player => modifyFields(player, { x: () => 300, y: () => 130 }),
      }),
    )
    const lead = Option.getOrThrow(maybePlayerAt(apart, 0)).player
    expect(Math.hypot(lead.x - 300, lead.y - 130)).toBeGreaterThan(100)
    const intensityWith = (zombieX: number, zombieY: number) =>
      stepRoomWorld(
        {
          ...TWO_SEAT_ROOM,
          world: modifyFields(apart, {
            zombies: () => [zombieAt(900, zombieX, zombieY)],
          }),
        },
        [
          {
            slot: 0,
            input: NEUTRAL_INPUT,
            presence: 'Here',
            viewLagTicks: 0,
            rttMs: 0,
          },
          {
            slot: 1,
            input: NEUTRAL_INPUT,
            presence: 'Here',
            viewLagTicks: 0,
            rttMs: 0,
          },
        ],
      ).world.intensity
    expect(intensityWith(320, 130)).toBeGreaterThan(0)
    expect(intensityWith(160, 30)).toBe(0)
    expect(intensityWith(306, 130)).toBeGreaterThanOrEqual(INTENSITY_PER_HEART)
  })
})

describe('latency', () => {
  const apart = withSeat(TWO_SEAT_ROOM.world, 1, seatWorld =>
    modifyFocus(seatWorld, {
      player: player => modifyFields(player, { x: () => 200, y: () => 120 }),
    }),
  )

  test('a lagging shot is checked against where the zombie stood when the shooter saw it', () => {
    const seen = { x: 230, y: 120 }
    const zombie = zombieAt(900, 230, 60)
    const room: RoomWorld = {
      ...TWO_SEAT_ROOM,
      tick: 20,
      world: modifyFields(apart, { zombies: () => [zombie] }),
      history: Array.makeBy(15, index => ({
        tick: 6 + index,
        zombies: [{ id: 900, x: seen.x, y: seen.y }],
      })),
    }
    const shoot = (viewLagTicks: number) =>
      stepRoomWorld(room, [
        {
          slot: 0,
          input: NEUTRAL_INPUT,
          presence: 'Here',
          viewLagTicks: 0,
          rttMs: 0,
        },
        {
          slot: 1,
          input: { ...NEUTRAL_INPUT, aimX: AIM_REACH, buttons: FIRE_BUTTON },
          presence: 'Here',
          viewLagTicks,
          rttMs: 200,
        },
      ])
    const hpOf = (stepped: RoomWorld) =>
      Option.match(
        Array.findFirst(stepped.world.zombies, ({ id }) => id === 900),
        { onNone: () => 0, onSome: ({ hp }) => hp },
      )
    expect(hpOf(shoot(0))).toBe(zombie.hp)
    const favored = shoot(12)
    expect(hpOf(favored)).toBeLessThan(zombie.hp)
    expect(
      Option.map(
        Array.findFirst(favored.world.zombies, ({ id }) => id === 900),
        ({ x, y }) => [x, y],
      ),
    ).toEqual(Option.some([230, 60]))
    expect(favored.history.length).toBe(15)
    expect(Array.last(favored.history)).toEqual(
      Option.some({ tick: 21, zombies: [{ id: 900, x: 230, y: 60 }] }),
    )
  })

  test('a zombie must keep touching a lagging player for their grace to bite', () => {
    const mate = Option.getOrThrow(maybePlayerAt(apart, 1)).player
    const touching: RoomWorld = {
      ...TWO_SEAT_ROOM,
      world: modifyFields(apart, {
        zombies: () => [zombieAt(901, mate.x + 6, mate.y)],
      }),
    }
    const heartsAfter = (ticks: number, rttMs: number) =>
      Option.getOrThrow(
        maybePlayerAt(
          Array.reduce(
            Array.makeBy(ticks, () => 0),
            touching,
            current =>
              stepRoomWorld(current, [
                {
                  slot: 0,
                  input: NEUTRAL_INPUT,
                  presence: 'Here',
                  viewLagTicks: 0,
                  rttMs: 0,
                },
                {
                  slot: 1,
                  input: NEUTRAL_INPUT,
                  presence: 'Here',
                  viewLagTicks: 0,
                  rttMs,
                },
              ]),
          ).world,
          1,
        ),
      ).player.hp
    expect(heartsAfter(1, 0)).toBeLessThan(mate.hp)
    expect(heartsAfter(4, 200)).toBe(mate.hp)
    expect(heartsAfter(8, 200)).toBeLessThan(mate.hp)
    expect(heartsAfter(4, 2000)).toBe(mate.hp)
    expect(heartsAfter(8, 2000)).toBeLessThan(mate.hp)
  })
})
