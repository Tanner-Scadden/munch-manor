import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'
import { type Lobby, NetStats } from '@munch/netcode'

import { CoopBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { Lesson, type Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { SendRunSummary } from '../../../app/update/settle'
import { Screen, maybeRoomOf } from '../../../domain/coopRoom'
import type { CrewNetwork, RunSummary } from '../../../platform/analytics'
import { crewRunKeyOf } from '../../../platform/analyticsRun'
import { modifyLeadSeat, withSeat } from '../../../test/model.fixture'
import { APPLICATION, resolveFocusCoop } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  type RoomWorld,
  pastArrival,
  startRoomWorld,
} from '../../../world/net/roomWorld'
import { noModifiers } from '../../../world/run/modifiers'
import { Phase, RunMode, noKills } from '../../../world/schema/worldSchema'
import { startWaveEarly } from '../../../world/waves/waves'
import { Message as CoopMessage } from '../../coop/message'
import { freshRoom } from '../../coop/roomState'
import { FocusCoopElement } from '../../coop/steps'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { RememberRoom } from '../../coop/update'

// An online co-op run's summary (src/platform/analyticsRun.ts): each player's own
// client sends one when the run ends, from its own seat, on the room's
// difficulty, by its own sharing setting. The room is faked with a
// session already holding a World, as in src/features/onlineRun/__tests__/coopPlay.story.test.ts.

const VISIT_ID = '0123456789abcdef'

const OWN_SLOT = 1

const started = pastArrival(
  startRoomWorld([0, OWN_SLOT, 2], 7, {
    difficulty: 'Hard',
    modifiers: noModifiers,
    easyBreakSeconds: 0,
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
  world: modifyFields(fighting.world, { phase: () => phase }),
})

// NOTE: a player whose own difficulty is not the room's, so the summary
// shows which it read.
const player: Model = modifyFields(asVeteran(initialModel), {
  lessons: lessons =>
    modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
  difficulty: setting => modifyFields(setting, { chosen: () => 'Easy' }),
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
  modifyFields(model, {
    coop: coop =>
      modifyFields(coop, {
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

const roomFrame = (nowMs: number) =>
  Story.message(Message.TickedRoomFrame({ nowMs }))

// NOTE: the run under way, drawn from the room once: the Model the next
// Story starts from, once the room has moved on.
const midRun = (model: Model = player, seated: Seated = OWN_SEAT) =>
  Story.story(
    APPLICATION,
    Story.given(inRoom(model, fighting, seated)),
    roomFrame(100),
  )

// NOTE: the room's last frame of a run, as the seat's client draws it.
const endedIn = (phase: Phase, seated: Seated = OWN_SEAT) =>
  Effect.map(midRun(player, seated), running =>
    inRoom(running, endedAs(phase), seated),
  )

// NOTE: LEAVE done: co-op remembers no room and focuses its hub.
const leaveRoom = Story.steps(
  Story.messageIn(CoopBinding, CoopMessage.CompletedLeaveRoom()),
  Story.Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
  resolveFocusCoop(),
)

// NOTE: a room faked with no pings back and no Deltas timed measured
// nothing.
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

// NOTE: a laggy link's run, as this client's session tallied it: four
// pings back, one slow; three Deltas timed, one 120 ms late; one
// reconnect; three corrections, the biggest 12.4 px.
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
  modifyFields(model, {
    coop: coop =>
      modifyFields(coop, {
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

// NOTE: the summary this player's client sends: the room's difficulty
// (Hard), its own seat's stats, the crew's run key.
const crewSummary = (
  overrides: Partial<RunSummary> & Pick<RunSummary, 'outcome' | 'wave'>,
): RunSummary => ({
  version: 8,
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
  ...overrides,
})

const GAME_OVER = { _tag: 'GameOver', killedBy: 'Unknown' } as const

const sent = (summary: RunSummary) =>
  Story.steps(
    Story.Command.expectExact(SendRunSummary({ summary })),
    Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
  )

describe("an online co-op run's summary", () => {
  it.effect('the run is under way, and nothing is sent yet', () =>
    Effect.gen(function* () {
      const running = yield* midRun()
      expect(running.phase._tag).toBe('Wave')
      yield* Story.story(
        APPLICATION,
        Story.given(inRoom(running, fighting)),
        roomFrame(200),
        Story.Command.expectNone(),
      )
    }),
  )

  it.effect(
    "Game Over sends one, from this player's seat on the room's difficulty",
    () =>
      Effect.gen(function* () {
        const ended = yield* endedIn(Phase.GameOver({ wave: 1 }))
        yield* Story.story(
          APPLICATION,
          Story.given(ended),
          roomFrame(200),
          Story.model(current => {
            expect(current.phase._tag).toBe('GameOver')
          }),
          sent(crewSummary({ outcome: GAME_OVER, wave: 1 })),
        )
      }),
  )

  it.effect("the summary carries this client's network numbers", () =>
    Effect.gen(function* () {
      const ended = yield* endedIn(Phase.GameOver({ wave: 1 }))
      yield* Story.story(
        APPLICATION,
        Story.given(withRoomNet(ended, laggyNet)),
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
      )
    }),
  )

  it.effect('leaving keeps the numbers the room measured', () =>
    Effect.gen(function* () {
      const playing = yield* midRun()
      const running = yield* Story.story(
        APPLICATION,
        Story.given(withRoomNet(playing, laggyNet)),
        roomFrame(150),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(running),
        leaveRoom,
        Story.model(current => {
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
      )
    }),
  )

  it.effect(
    'an escape sends one, and leaving from the end card sends no second',
    () =>
      Effect.gen(function* () {
        const ended = yield* endedIn(Phase.Escaped({ wave: 10 }))
        yield* Story.story(
          APPLICATION,
          Story.given(ended),
          roomFrame(200),
          Story.model(current => {
            expect(current.phase._tag).toBe('Escaped')
          }),
          sent(crewSummary({ outcome: { _tag: 'Escaped' }, wave: 10 })),
          Story.messageIn(CoopBinding, CoopMessage.CompletedLeaveRoom()),
          Story.Command.expectExact(RememberRoom, FocusCoopElement),
          Story.model(current => {
            expect(current.phase._tag).toBe('Ready')
          }),
          Story.Command.resolve(
            RememberRoom,
            CoopMessage.CompletedRememberRoom(),
          ),
          resolveFocusCoop(),
        )
      }),
  )

  it.effect(
    "leaving the room mid-run sends a Quit, with the room's difficulty",
    () =>
      Effect.gen(function* () {
        const running = yield* midRun()
        yield* Story.story(
          APPLICATION,
          Story.given(running),
          leaveRoom,
          Story.model(current => {
            expect(current.phase._tag).toBe('Ready')
            expect(Option.isNone(maybeRoomOf(current.coop))).toBe(true)
          }),
          sent(crewSummary({ outcome: { _tag: 'Quit' }, wave: 1, runMs: 50 })),
        )
      }),
  )

  it.effect('nothing is sent with sharing off', () =>
    Effect.gen(function* () {
      const private_ = yield* midRun(
        modifyFields(player, { shareStats: () => 'Off' as const }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(inRoom(private_, endedAs(Phase.GameOver({ wave: 1 })))),
        roomFrame(200),
        Story.Command.expectNone(),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(private_),
        leaveRoom,
        Story.Command.expectNone(),
      )
    }),
  )

  // NOTE: a seat other than this player's has its own stats, none here.
  it.effect('every client in one run sends the same run key', () =>
    Effect.forEach([0, OWN_SLOT, 2], slot =>
      Effect.gen(function* () {
        const seated = { ...OWN_SEAT, slot }
        const ended = yield* endedIn(Phase.GameOver({ wave: 1 }), seated)
        const own = slot === OWN_SLOT
        yield* Story.story(
          APPLICATION,
          Story.given(ended),
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
          yield* Story.story(
            APPLICATION,
            Story.given(ended),
            roomFrame(200),
            sent(
              crewSummary({
                outcome: GAME_OVER,
                wave: 1,
                party: { ...crewOfThree, runKey: crewRunKeyOf(lobby) },
              }),
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
      yield* Story.story(
        APPLICATION,
        Story.given(
          inRoom(running, endedAs(Phase.GameOver({ wave: 1 })), closed),
        ),
        roomFrame(200),
        sent(crewSummary({ outcome: GAME_OVER, wave: 1 })),
      )
    }),
  )
})

// NOTE: rank (src/features/end/rankRun.ts): each client pays its own seat. The crew's
// waves are the run's, on the room's difficulty (Hard here); the awards and
// revives are the player's own. Seat 1 has the most kills, the revive, and
// the most downs, so it wins the MVP, Medic, and Most Munched awards.
describe("an online co-op run's rank", () => {
  // NOTE: the client tallies its own stats from the room's events, so the
  // four waves cleared are on its Model.
  const clearedFour = (model: Model): Model =>
    modifyFields(model, {
      stats: stats => modifyFields(stats, { wavesCleared: () => 4 }),
    })

  // NOTE: the run's end drawn, its summary sent: the Model it leaves.
  const endWith = (start: Model, world: RoomWorld, nowMs: number) =>
    Story.story(
      APPLICATION,
      Story.given(inRoom(start, world)),
      roomFrame(nowMs),
      Story.Command.resolveAll([
        SendRunSummary,
        Message.CompletedSendRunSummary(),
      ]),
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
        // NOTE: 4 waves x 10 x 1.5 = 60, 3 awards x 10, 1 revive x 5.
        expect(ended.rank).toMatchObject({ earnedPoints: 95, earnedBones: 9 })
        expect(ended.maybeRankGain).toEqual(
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
      expect(fresh.rankPaid).toEqual({
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
      yield* Story.story(
        APPLICATION,
        Story.given(running),
        leaveRoom,
        Story.Command.resolve(
          SendRunSummary,
          Message.CompletedSendRunSummary(),
        ),
        Story.model(left => {
          expect(left.phase._tag).toBe('Ready')
          expect(left.rank).toMatchObject({ earnedPoints: 5, earnedBones: 0 })
        }),
      )
    }),
  )
})
