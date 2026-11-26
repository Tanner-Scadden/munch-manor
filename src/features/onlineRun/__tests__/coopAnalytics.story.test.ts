import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'
import { type Lobby, NetStats } from '@munch/netcode'

import { Message } from '#app/message.ts'
import { Lesson, type Model } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { SendRunSummary } from '#app/update/settle.ts'
import { Screen, maybeRoomOf } from '#domain/coopRoom.ts'
import { freshRoom } from '#features/coop/roomState.ts'
import { focusCoop } from '#features/coop/steps.ts'
import {
  CODE,
  lobbyOf,
  memberOf,
  playingSession,
} from '#features/coop/testing.ts'
import { RememberRoom } from '#features/coop/update.ts'
import type { CrewNetwork, RunSummary } from '#platform/analytics.ts'
import { crewRunKeyOf } from '#platform/analyticsRun.ts'
import { modifyLeadSeat, withSeat } from '#test/model.fixture.ts'
import {
  type AppStory,
  checkModel,
  expectNoCommand,
  modelAfter,
  resolveAll,
  resolveFocusCoop,
  resolveRememberRoom,
  resolveSentSummary,
  send,
  steps,
} from '#test/testing.ts'
import { asVeteran } from '#test/veteran.ts'
import {
  type RoomWorld,
  pastArrival,
  startRoomWorld,
} from '#world/net/roomWorld.ts'
import { noModifiers } from '#world/run/modifiers.ts'
import { Phase, RunMode, noKills } from '#world/schema/worldSchema.ts'
import { startWaveEarly } from '#world/waves/waves.ts'

const VISIT_ID = '0123456789abcdef'

const OWN_SLOT = 1

const started = pastArrival(
  startRoomWorld([0, OWN_SLOT, 2], 7, {
    difficulty: 'Hard',
    modifiers: noModifiers,
    easyBreakSeconds: 0,
    dareMark: 0,
    mode: RunMode.Campaign(),
    callings: [],
    intro: 'Short',
    things: [],
  }),
)

const fighting: RoomWorld = {
  ...started,
  world: withSeat(startWaveEarly(started.world), OWN_SLOT, world =>
    modifyLeadSeat(world, seat => ({
      ...seat,
      kills: 12,
      downs: 2,
      revives: 1,
    })),
  ),
}

const endedAs = (phase: Phase): RoomWorld => ({
  ...fighting,
  tick: 1,
  world: UiStruct.evolve(fighting.world, { phase: () => phase }),
})

const player: Model = UiStruct.evolve(asVeteran(initialModel), {
  lessons: lessons =>
    UiStruct.evolve(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
  difficulty: setting => UiStruct.evolve(setting, { chosen: () => 'Easy' }),
  maybeVisitId: () => Option.some(VISIT_ID),
})

const playingLobby: Lobby = lobbyOf(
  [memberOf(0, 'Ana'), memberOf(1, 'Bo'), memberOf(2, 'Cy')],
  'Playing',
)

type Seated = Readonly<{ slot: number; lobby: Lobby }>

const OWN_SEAT: Seated = { slot: OWN_SLOT, lobby: playingLobby }

const inRoom = (
  model: Model,
  world: RoomWorld,
  { slot, lobby }: Seated = OWN_SEAT,
): Model =>
  UiStruct.evolve(model, {
    coop: coop =>
      UiStruct.evolve(coop, {
        screen: () =>
          Screen.InRoom({
            room: Option.match(maybeRoomOf(coop), {
              onNone: () => ({
                ...freshRoom(CODE, slot),
                maybePlayerId: Option.some(`player-${slot}`),
                maybeLobby: Option.some(lobby),
                link: 'Online' as const,
                session: playingSession(world, slot),
              }),
              onSome: room => ({
                ...room,
                maybeLobby: Option.some(lobby),
                session: playingSession(world, slot),
              }),
            }),
          }),
      }),
  })

const roomFrame = (nowMs: number) => send(Message.TickedRoomFrame({ nowMs }))

const midRun = (model: Model = player, seated: Seated = OWN_SEAT) =>
  modelAfter(inRoom(model, fighting, seated), roomFrame(100))

const endedIn = (phase: Phase, seated: Seated = OWN_SEAT) =>
  Effect.map(midRun(player, seated), running =>
    inRoom(running, endedAs(phase), seated),
  )

const leaveRoom = steps(
  send(Message.CompletedLeaveRoom()),
  resolveRememberRoom,
  resolveFocusCoop,
)

const unmeasured: CrewNetwork = {
  rttP50Ms: 0,
  rttP95Ms: 0,
  rttSamples: 0,
  jitterMs: 0,
  snapshots: 0,
  lateSnapshots: 0,
  lateMsMean: 0,
  lateMsMax: 0,
  reconnects: 0,
  corrections: 0,
  correctionPxMax: 0,
}

const crewOfThree = {
  _tag: 'Crew',
  size: 3,
  seatKills: 12,
  seatDowns: 2,
  seatRevives: 1,
  runKey: crewRunKeyOf(playingLobby),
  network: unmeasured,
} as const

const laggyNet: NetStats.ClientNet = {
  ...Array.reduce([5, -5, 120], NetStats.emptyClientNet, (net, offMs) =>
    NetStats.arrivedOff(net, offMs),
  ),
  rtt: Array.reduce([60, 60, 70, 300], NetStats.emptyHistogram, (rtt, ms) =>
    NetStats.recordSample(rtt, ms),
  ),
  reconnects: 1,
  corrections: 3,
  correctionMaxPx: 12.4,
}

const withRoomNet = (model: Model, net: NetStats.ClientNet): Model =>
  UiStruct.evolve(model, {
    coop: coop =>
      UiStruct.evolve(coop, {
        screen: () =>
          Option.match(maybeRoomOf(coop), {
            onNone: () => coop.screen,
            onSome: room =>
              Screen.InRoom({
                room: {
                  ...room,
                  session: {
                    ...room.session,
                    stats: { ...room.session.stats, net },
                  },
                },
              }),
          }),
      }),
  })

const crewSummary = (
  overrides: Partial<RunSummary> & Pick<RunSummary, 'outcome' | 'wave'>,
): RunSummary => ({
  version: 9,
  visitId: VISIT_ID,
  build: 'test',
  mode: 'Campaign',
  difficulty: 'Hard',
  runMs: 100,
  kills: noKills,
  heartsLost: 0,
  keysSpent: 0,
  casesOpened: 0,
  powerUpsGrabbed: 0,
  trapsPlaced: 0,
  device: 'KeyboardMouse',
  screenFit: 'Browser',
  frameTime: 'Over34Ms',
  party: crewOfThree,
  modifiers: 0,
  dareItemsFound: 0,
  dareMark: 0,
  ...overrides,
})

const GAME_OVER = { _tag: 'GameOver', killedBy: 'Unknown' } as const

const sent = (summary: RunSummary) =>
  steps<AppStory>(
    s => s.expectExact(SendRunSummary.make({ summary })),
    resolveSentSummary,
  )

describe("an online co-op run's summary", () => {
  it.effect('the run is under way, and nothing is sent yet', () =>
    Effect.gen(function* () {
      const running = yield* midRun()
      expect(running.phase._tag).toBe('Wave')
      yield* modelAfter(
        inRoom(running, fighting),
        steps(roomFrame(200), expectNoCommand),
      )
    }),
  )

  it.effect(
    "Game Over sends one, from this player's seat on the room's difficulty",
    () =>
      Effect.gen(function* () {
        const ended = yield* endedIn(Phase.GameOver({ wave: 1 }))
        yield* modelAfter(
          ended,
          steps(
            roomFrame(200),
            checkModel(current => {
              expect(current.phase._tag).toBe('GameOver')
            }),
            sent(crewSummary({ outcome: GAME_OVER, wave: 1 })),
          ),
        )
      }),
  )

  it.effect("the summary carries this client's network numbers", () =>
    Effect.gen(function* () {
      const ended = yield* endedIn(Phase.GameOver({ wave: 1 }))
      yield* modelAfter(
        withRoomNet(ended, laggyNet),
        steps(
          roomFrame(200),
          sent(
            crewSummary({
              outcome: GAME_OVER,
              wave: 1,
              party: {
                ...crewOfThree,
                network: {
                  rttP50Ms: 65,
                  rttP95Ms: 305,
                  rttSamples: 4,
                  jitterMs: 43,
                  snapshots: 3,
                  lateSnapshots: 1,
                  lateMsMean: 120,
                  lateMsMax: 120,
                  reconnects: 1,
                  corrections: 3,
                  correctionPxMax: 12,
                },
              },
            }),
          ),
        ),
      )
    }),
  )

  it.effect('leaving keeps the numbers the room measured', () =>
    Effect.gen(function* () {
      const playing = yield* midRun()
      const running = yield* modelAfter(
        withRoomNet(playing, laggyNet),
        roomFrame(150),
      )
      yield* modelAfter(
        running,
        steps(
          leaveRoom,
          checkModel(current => {
            expect(Option.isNone(maybeRoomOf(current.coop))).toBe(true)
          }),
          sent(
            crewSummary({
              outcome: { _tag: 'Quit' },
              wave: 1,
              runMs: 100,
              party: {
                ...crewOfThree,
                network: {
                  ...unmeasured,
                  rttP50Ms: 65,
                  rttP95Ms: 305,
                  rttSamples: 4,
                  jitterMs: 43,
                  snapshots: 3,
                  lateSnapshots: 1,
                  lateMsMean: 120,
                  lateMsMax: 120,
                  reconnects: 1,
                  corrections: 3,
                  correctionPxMax: 12,
                },
              },
            }),
          ),
        ),
      )
    }),
  )

  it.effect(
    'an escape sends one, and leaving from the end card sends no second',
    () =>
      Effect.gen(function* () {
        const ended = yield* endedIn(Phase.Escaped({ wave: 10 }))
        yield* modelAfter(
          ended,
          steps(
            roomFrame(200),
            checkModel(current => {
              expect(current.phase._tag).toBe('Escaped')
            }),
            sent(crewSummary({ outcome: { _tag: 'Escaped' }, wave: 10 })),
            send(Message.CompletedLeaveRoom()),
            s =>
              s.expectExact(
                RememberRoom.make({ maybeCode: Option.none() }),
                focusCoop('QuickPlay'),
              ),
            checkModel(current => {
              expect(current.phase._tag).toBe('Ready')
            }),
            resolveRememberRoom,
            resolveFocusCoop,
          ),
        )
      }),
  )

  it.effect(
    "leaving the room mid-run sends a Quit, with the room's difficulty",
    () =>
      Effect.gen(function* () {
        const running = yield* midRun()
        yield* modelAfter(
          running,
          steps(
            leaveRoom,
            checkModel(current => {
              expect(current.phase._tag).toBe('Ready')
              expect(Option.isNone(maybeRoomOf(current.coop))).toBe(true)
            }),
            sent(
              crewSummary({ outcome: { _tag: 'Quit' }, wave: 1, runMs: 50 }),
            ),
          ),
        )
      }),
  )

  it.effect('nothing is sent with sharing off', () =>
    Effect.gen(function* () {
      const private_ = yield* midRun(
        UiStruct.evolve(player, {
          settings: settings =>
            UiStruct.evolve(settings, { shareStats: () => 'Off' as const }),
        }),
      )
      yield* modelAfter(
        inRoom(private_, endedAs(Phase.GameOver({ wave: 1 }))),
        steps(roomFrame(200), expectNoCommand),
      )
      yield* modelAfter(private_, steps(leaveRoom, expectNoCommand))
    }),
  )

  it.effect('every client in one run sends the same run key', () =>
    Effect.forEach([0, OWN_SLOT, 2], slot =>
      Effect.gen(function* () {
        const seated = { ...OWN_SEAT, slot }
        const ended = yield* endedIn(Phase.GameOver({ wave: 1 }), seated)
        const own = slot === OWN_SLOT
        yield* modelAfter(
          ended,
          steps(
            roomFrame(200),
            sent(
              crewSummary({
                outcome: GAME_OVER,
                wave: 1,
                party: {
                  ...crewOfThree,
                  seatKills: own ? 12 : 0,
                  seatDowns: own ? 2 : 0,
                  seatRevives: own ? 1 : 0,
                },
              }),
            ),
          ),
        )
      }),
    ),
  )

  it.effect('a rematch in the room, or another room, sends another key', () =>
    Effect.forEach(
      [{ round: playingLobby.round + 1 }, { code: 'ZZZZ' }, { createdMs: 1 }],
      changed =>
        Effect.gen(function* () {
          const lobby = { ...playingLobby, ...changed }
          expect(crewRunKeyOf(lobby)).not.toBe(crewRunKeyOf(playingLobby))
          const seated = { ...OWN_SEAT, lobby }
          const ended = yield* endedIn(Phase.GameOver({ wave: 1 }), seated)
          yield* modelAfter(
            ended,
            steps(
              roomFrame(200),
              sent(
                crewSummary({
                  outcome: GAME_OVER,
                  wave: 1,
                  party: { ...crewOfThree, runKey: crewRunKeyOf(lobby) },
                }),
              ),
            ),
          )
        }),
    ),
  )

  it.effect('the room closing as the run ends keeps the run key', () =>
    Effect.gen(function* () {
      const running = yield* midRun()
      const closed: Seated = {
        ...OWN_SEAT,
        lobby: { ...playingLobby, status: 'Closed' },
      }
      yield* modelAfter(
        inRoom(running, endedAs(Phase.GameOver({ wave: 1 })), closed),
        steps(
          roomFrame(200),
          sent(crewSummary({ outcome: GAME_OVER, wave: 1 })),
        ),
      )
    }),
  )
})

describe("an online co-op run's rank", () => {
  const clearedFour = (model: Model): Model =>
    UiStruct.evolve(model, {
      stats: stats => UiStruct.evolve(stats, { wavesCleared: () => 4 }),
    })

  const endWith = (start: Model, world: RoomWorld, nowMs: number) =>
    modelAfter(
      inRoom(start, world),
      steps(roomFrame(nowMs), resolveAll(SendRunSummary)(Component.noop)),
    )

  it.effect(
    "Game Over pays the crew's waves on the room's difficulty, plus the seat's awards and revives",
    () =>
      Effect.gen(function* () {
        const running = yield* midRun()
        const ended = yield* endWith(
          clearedFour(running),
          endedAs(Phase.GameOver({ wave: 5 })),
          200,
        )
        expect(ended.rank).toMatchObject({ earnedPoints: 95, earnedBones: 9 })
        expect(ended.runGains.maybeRankGain).toEqual(
          Option.some({
            pointsBefore: 0,
            gained: 95,
            bonesGained: 9,
            bonusPercent: 0,
            bonuses: [],
          }),
        )
      }),
  )

  it.effect('a new run in the room starts from nothing paid', () =>
    Effect.gen(function* () {
      const running = yield* midRun()
      const won = yield* endWith(
        clearedFour(running),
        endedAs(Phase.Escaped({ wave: 10 })),
        200,
      )
      const again: RoomWorld = {
        ...started,
        tick: 5,
        world: startWaveEarly(started.world),
      }
      const fresh = yield* endWith(won, again, 500)
      expect(fresh.runGains.rankPaid).toEqual({
        wavesPaid: 0,
        bossesPaid: 0,
        readyPaid: 0,
        awardsPaid: 0,
        revivesPaid: 0,
      })
    }),
  )

  it.effect('leaving mid-run pays the revives made, and no awards', () =>
    Effect.gen(function* () {
      const running = yield* midRun()
      yield* modelAfter(
        running,
        steps(
          leaveRoom,
          resolveSentSummary,
          checkModel(left => {
            expect(left.phase._tag).toBe('Ready')
            expect(left.rank).toMatchObject({ earnedPoints: 5, earnedBones: 0 })
          }),
        ),
      )
    }),
  )
})
