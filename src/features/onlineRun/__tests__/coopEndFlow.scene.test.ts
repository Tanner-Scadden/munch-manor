import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'
import type { Lobby } from '@munch/netcode'

import { Message } from '#app/message.ts'
import { type Model, Phase } from '#app/model.ts'
import { Screen, maybeRoomOf } from '#domain/coopRoom.ts'
import { isRoomFrameDue, isRunOn } from '#domain/onlineRun.ts'
import { freshRoom } from '#features/coop/roomState.ts'
import {
  CODE,
  lobbyOf,
  memberOf,
  playingSession,
} from '#features/coop/testing.ts'
import { fromSubscription, measureHud } from '#test/sceneTesting.ts'
import { modelAfter, sceneOf, send } from '#test/testing.ts'
import type { RoomWorld } from '#world/net/roomWorld.ts'
import { startWaveEarly } from '#world/waves/waves.ts'

import {
  OWN_SLOT,
  coopScreen,
  graduated,
  roomWorld,
} from './onlineRun.fixture.ts'

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
