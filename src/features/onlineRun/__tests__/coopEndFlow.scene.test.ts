import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'
import type { Lobby } from '@munch/netcode'

import { Message } from '../../../app/message'
import { type Model, Phase } from '../../../app/model'
import { Screen, maybeRoomOf } from '../../../domain/coopRoom'
import { isRoomFrameDue, isRunOn } from '../../../domain/onlineRun'
import { fromSubscription, measureHud } from '../../../test/sceneTesting'
import { modelAfter, sceneOf, send } from '../../../test/testing'
import type { RoomWorld } from '../../../world/net/roomWorld'
import { startWaveEarly } from '../../../world/waves/waves'
import { freshRoom } from '../../coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { OWN_SLOT, coopScreen, graduated, roomWorld } from './onlineRun.fixture'

// The end of an online co-op run as a client sees it. The room ends the run,
// sends its last World, then RoomClosed on the game's socket, and puts its
// lobby back with the result on the lobby's own socket. This client draws
// the room 100 ms behind, so both can come before the frame that ends the
// run is drawn: the end card must still come straight up, with no lobby
// between the last frame of play and the card.

// NOTE: the end frame is this many ticks after the last frame of play, so a
// frame at 100 ms draws play and one at 400 ms draws the end.
const END_TICK = 6

const fighting: RoomWorld = {
  ...roomWorld,
  world: startWaveEarly(roomWorld.world),
}

const wiped: RoomWorld = {
  ...fighting,
  tick: fighting.tick + END_TICK,
  world: UiStruct.evolve(fighting.world, {
    phase: () => Phase.GameOver({ wave: 1 }),
  }),
}

const members = [memberOf(0, 'Ana'), memberOf(OWN_SLOT, 'Bo')]

const playingLobby: Lobby = lobbyOf(members, 'Playing')

// NOTE: the lobby as RecordedRoomResult leaves it: back in Lobby, the run's
// result on it.
const resultLobby: Lobby = {
  ...lobbyOf(members, 'Lobby'),
  result: Option.some({
    round: 1,
    reason: 'GameOver',
    ticks: wiped.tick,
    scores: [],
  }),
}

type Heard = Readonly<{
  lobby: Lobby
  frames: ReadonlyArray<RoomWorld>
  isClosed: boolean
}>

// NOTE: the room as this client holds it: its lobby, the frames it has
// heard (anchored at tick 0 on the clock's 0), and whether RoomClosed came.
const hearing = (model: Model, { lobby, frames, isClosed }: Heard): Model =>
  UiStruct.evolve(model, {
    coop: coop =>
      UiStruct.evolve(coop, {
        screen: () =>
          Screen.InRoom({
            room: {
              ...Option.getOrElse(maybeRoomOf(coop), () => ({
                ...freshRoom(CODE, OWN_SLOT),
                maybePlayerId: Option.some(`player-${OWN_SLOT}`),
                link: 'Online' as const,
              })),
              maybeLobby: Option.some(lobby),
              session: {
                ...playingSession(fighting, OWN_SLOT),
                phase: isClosed
                  ? { _tag: 'Ended', reason: 'GameOver' }
                  : { _tag: 'Playing' },
                anchor: Option.some({ tick: fighting.tick, atMs: 0 }),
                frames: Array.map(frames, world => ({
                  tick: world.tick,
                  world,
                  atMs: 0,
                })),
              },
            },
          }),
      }),
  })

const roomFrame = (nowMs: number) =>
  fromSubscription('RoomFrame', Message.TickedRoomFrame({ nowMs }))

// NOTE: a wave under way, drawn from the room once.
const midRun = modelAfter(
  hearing(graduated, {
    lobby: playingLobby,
    frames: [fighting],
    isClosed: false,
  }),
  send(Message.TickedRoomFrame({ nowMs: 100 })),
)

const lobbyShown = coopScreen('Lobby')
const arenaShown = coopScreen('Arena')
const cardShown = coopScreen('RunCard')

describe("an online co-op run's end", () => {
  it.effect(
    'the crew wiped, RoomClosed and the lobby both in before the end is drawn: the card comes with no lobby',
    () =>
      Effect.gen(function* () {
        const running = yield* midRun
        expect(running.phase._tag).toBe('Wave')
        const ended = hearing(running, {
          lobby: resultLobby,
          frames: [fighting, wiped],
          isClosed: true,
        })
        expect(isRunOn(ended)).toBe(true)
        expect(isRoomFrameDue(ended)).toBe(true)
        const s = yield* sceneOf(ended)
        s.pipe(measureHud)
          .expect(lobbyShown)
          .toBeAbsent()
          .expect(arenaShown)
          .toExist()
          .pipe(roomFrame(400))
          .expect(lobbyShown)
          .toBeAbsent()
          .expect(cardShown)
          .toExist()
      }),
  )

  it.effect(
    'the lobby in before the last frames: the arena holds until they come',
    () =>
      Effect.gen(function* () {
        const running = yield* midRun
        const early = hearing(running, {
          lobby: resultLobby,
          frames: [fighting],
          isClosed: false,
        })
        const s = yield* sceneOf(early)
        s.pipe(measureHud, roomFrame(200))
          .expect(lobbyShown)
          .toBeAbsent()
          .expect(arenaShown)
          .toExist()
        const arrived = hearing(early, {
          lobby: resultLobby,
          frames: [fighting, wiped],
          isClosed: true,
        })
        const later = yield* sceneOf(arrived)
        later.pipe(measureHud, roomFrame(400)).expect(cardShown).toExist()
      }),
  )

  it.effect(
    'a room closed with no end in its frames lets the lobby in, and its frames stop',
    () =>
      Effect.gen(function* () {
        const running = yield* midRun
        const cut = hearing(running, {
          lobby: resultLobby,
          frames: [fighting],
          isClosed: true,
        })
        expect(isRoomFrameDue(cut)).toBe(false)
        const s = yield* sceneOf(cut)
        s.pipe(measureHud).expect(lobbyShown).toExist()
      }),
  )
})
