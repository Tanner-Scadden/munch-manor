import { Array, Effect, Layer, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'
import {
  type InputFrame,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  makeWriter,
} from '@munch/netcode'
import { RoomEvent } from '@munch/netcode/browser'

import {
  LobbyChange,
  RoomRequest,
  Screen,
  coopWorld,
  noPresses,
} from '../../../domain/coopRoom'
import { playRoom } from '../../../test/roomTesting'
import { resolveFocusCoop } from '../../../test/testing'
import {
  AIM_REACH,
  FIRE_BUTTON,
  actionCodeOf,
  heldAction,
  seatActionOf,
} from '../../../world/net/roomWorld'
import { SeatAction } from '../../../world/step/stepWorld'
import { InMessage } from '../inMessage'
import { Message, OutMessage } from '../message'
import { type Model, emptyQueue } from '../model'
import { cleanCode, freshRoom } from '../roomState'
import { ChangeLobby } from '../steps'
import {
  CODE,
  lobbyOf,
  makeFakeCoopNet,
  memberOf,
  stagedWorld,
} from '../testing'
import {
  AnswerOffer,
  CancelQuickPlay,
  LeaveRoom,
  RememberRoom,
  RequestRoom,
  ResyncRoom,
  SendRoomFrames,
} from '../update'
import {
  COOP,
  inRoom,
  lobbyUpdate,
  onHub,
  pressed,
  roomOf,
} from './story.fixture'

const resolveRemember = () =>
  Story.Command.resolve(RememberRoom, Message.CompletedRememberRoom())

// NOTE: the root's requests: a seat action pressed, and one frame of the
// room with the parent's controls at `nowMs`.
const pressSeat = (action: SeatAction) =>
  Story.inMessage(InMessage.RequestedPressAction({ action }))

const tickAt = (
  nowMs: number,
  controls: typeof NEUTRAL_INPUT = NEUTRAL_INPUT,
  isPictureHeld = false,
) =>
  Story.inMessage(
    InMessage.RequestedTickRoom({ controls, nowMs, isPictureHeld }),
  )

// NOTE: the mode and difficulty a key or tap sent the room's lobby.
const picksSent = (
  mode: 'Campaign' | 'Endless' | 'KeepGoing',
  difficulty: 'Easy' | 'Normal' | 'Hard' | 'Nightmare',
) =>
  Story.Command.resolve(
    ChangeLobby({ change: LobbyChange.ChangedPicks({ mode, difficulty }) }),
    Message.CompletedChangeLobby(),
  )

type Simulation = Story.StorySimulation<Model, unknown, unknown>

// NOTE: the Input frames the pending SendRoomFrames carry.
const sentInputs = (
  commands: ReadonlyArray<Story.AnyCommand>,
): ReadonlyArray<InputFrame> =>
  Array.flatMap(commands, command =>
    Option.match(Story.Command.argsOf(SendRoomFrames)(command), {
      onNone: () => [],
      onSome: ({ frames }) =>
        Array.filter(
          frames,
          (frame): frame is InputFrame => frame._tag === 'Input',
        ),
    }),
  )

// NOTE: checks the Input frames every room frame since the last
// `framesSent` sent.
const expectSent =
  (check: (inputs: ReadonlyArray<InputFrame>) => void) =>
  (simulation: Simulation): Simulation => {
    check(sentInputs(simulation.commands))
    return simulation
  }

// NOTE: each room frame sends what the session owes; the sends pending are
// answered as sent, with nothing to count.
const framesSent = (simulation: Simulation): Simulation =>
  Story.Command.resolveAll(
    ...Array.map(
      Array.filter(simulation.commands, command =>
        Option.isSome(Story.Command.argsOf(SendRoomFrames)(command)),
      ),
      () =>
        [
          SendRoomFrames,
          Message.CompletedSendRoomFrames({ bytes: [] }),
        ] as const,
    ),
  )(simulation)
const waiting = (
  waitingCount: number,
  offerPlayers = 0,
  accepted = 0,
): Message =>
  Message.ReceivedQuickPlayEvent({
    event: {
      _tag: 'Heard',
      message: {
        _tag: 'Waiting',
        names: ['Ana', 'Bo', 'Cy'].slice(0, waitingCount),
        waiting: waitingCount,
        groupSize: 4,
        position: 1,
        offerPlayers,
        accepted,
      },
    },
  })

const matched = Message.ReceivedQuickPlayEvent({
  event: { _tag: 'Heard', message: { _tag: 'Matched', code: CODE, slot: 1 } },
})

const TWO = [memberOf(0, 'Ana'), memberOf(1, 'Bo')]

describe('co-op hub', () => {
  it.effect('the X on the hub closes co-op and tells the parent', () =>
    Story.story(
      COOP,
      Story.given(onHub),
      Story.message(Message.ClickedCloseButton()),
      Story.model(current => {
        expect(current.screen._tag).toBe('Closed')
      }),
      Story.expectOutMessage(OutMessage.ClosedCoop()),
    ),
  )

  it.effect(
    'a code typed in any case, or pasted as a link, joins at five symbols',
    () => {
      expect(cleanCode('mn-ch')).toBe('MNCH')
      expect(cleanCode('O0I1ab')).toBe('AB')
      expect(cleanCode(`https://munch.example/?room=${CODE}`)).toBe(CODE)
      return Story.story(
        COOP,
        Story.given(onHub),
        Story.message(Message.ClickedCodeButton()),
        resolveFocusCoop(),
        Story.message(Message.UpdatedCode({ value: 'mn' })),
        Story.model(current => {
          expect(current.screen).toEqual(
            Screen.Code({ typed: 'MN', maybeProblem: Option.none() }),
          )
        }),
        Story.message(
          Message.UpdatedCode({ value: `https://x.example/?room=${CODE}` }),
        ),
        Story.model(current => {
          expect(current.screen._tag).toBe('Asking')
        }),
        Story.Command.resolve(
          RequestRoom({
            request: RoomRequest.Join({ code: CODE }),
            name: '',
            look: '',
            rank: 1,
            calling: 'You',
            introSeen: false,
          }),
          Message.FailedRequestRoom({ problem: 'NoRoom' }),
        ),
        resolveRemember(),
        Story.model(current => {
          expect(current.screen).toEqual(
            Screen.Code({ typed: CODE, maybeProblem: Option.some('NoRoom') }),
          )
        }),
      )
    },
  )

  it.effect('NEW ROOM asks for a room and lands in its lobby', () =>
    Story.story(
      COOP,
      Story.given(onHub),
      Story.message(Message.ClickedCreateButton()),
      Story.Command.resolve(
        RequestRoom({
          request: RoomRequest.Create(),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
          introSeen: false,
        }),
        Message.SucceededRequestRoom({ code: CODE, slot: 0 }),
      ),
      resolveRemember(),
      resolveFocusCoop(),
      Story.model(current => {
        expect(roomOf(current).code).toBe(CODE)
        expect(roomOf(current).slot).toBe(0)
      }),
    ),
  )
})

describe('QUICK PLAY', () => {
  it.effect(
    'the queue fills, the offer is accepted, and the match opens the room',
    () =>
      Story.story(
        COOP,
        Story.given(onHub),
        Story.message(Message.ClickedQuickPlayButton()),
        Story.message(waiting(2)),
        Story.model(current => {
          expect(current.screen).toEqual(
            Screen.Queue({
              queue: {
                ...emptyQueue,
                names: ['Ana', 'Bo'],
                waiting: 2,
                position: 1,
              },
            }),
          )
        }),
        Story.message(waiting(3, 3)),
        Story.message(Message.ClickedAcceptOfferButton()),
        Story.Command.resolve(
          AnswerOffer({ accept: true }),
          Message.CompletedAnswerOffer(),
        ),
        Story.model(current => {
          expect(
            Screen.isAnyOf(['Queue'])(current.screen) &&
              current.screen.queue.answer,
          ).toBe('Accepted')
        }),
        Story.message(waiting(3, 3, 2)),
        Story.model(current => {
          expect(
            Screen.isAnyOf(['Queue'])(current.screen) &&
              current.screen.queue.answer,
          ).toBe('Accepted')
        }),
        Story.message(matched),
        resolveRemember(),
        resolveFocusCoop(),
        Story.model(current => {
          expect(roomOf(current).slot).toBe(1)
        }),
      ),
  )

  it.effect(
    'keep waiting answers no and hides the offer until the next one',
    () =>
      Story.story(
        COOP,
        Story.given(onHub),
        Story.message(Message.ClickedQuickPlayButton()),
        Story.message(waiting(2, 2)),
        Story.message(Message.ClickedKeepWaitingButton()),
        Story.Command.resolve(
          AnswerOffer({ accept: false }),
          Message.CompletedAnswerOffer(),
        ),
        Story.message(waiting(2)),
        Story.model(current => {
          expect(
            Screen.isAnyOf(['Queue'])(current.screen) &&
              current.screen.queue.answer,
          ).toBe('Unanswered')
        }),
      ),
  )

  it.effect('the X leaves the queue', () =>
    Story.story(
      COOP,
      Story.given(onHub),
      Story.message(Message.ClickedQuickPlayButton()),
      Story.message(Message.ClickedCancelQueueButton()),
      Story.Command.resolve(
        CancelQuickPlay,
        Message.CompletedCancelQuickPlay(),
      ),
      Story.model(current => {
        expect(current.screen._tag).toBe('Hub')
      }),
    ),
  )

  it.effect('a dropped queue says so on the hub', () =>
    Story.story(
      COOP,
      Story.given(onHub),
      Story.message(Message.ClickedQuickPlayButton()),
      Story.message(
        Message.ReceivedQuickPlayEvent({
          event: { _tag: 'Dropped', reason: 'Closed' },
        }),
      ),
      Story.model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Dropped') }),
        )
      }),
    ),
  )
})

describe('the lobby', () => {
  it.effect(
    'READY writes the toggle for this seat, and again to take it back',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(1)),
        Story.message(lobbyUpdate(lobbyOf(TWO))),
        Story.model(current => {
          expect(roomOf(current).maybePlayerId).toEqual(Option.some('player-1'))
        }),
        Story.message(Message.ClickedReadyButton()),
        Story.Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
          }),
          Message.CompletedChangeLobby(),
        ),
        Story.message(
          lobbyUpdate(lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
        ),
        Story.message(Message.ClickedReadyButton()),
        Story.Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedReady({ ready: false, pingMs: 0 }),
          }),
          Message.CompletedChangeLobby(),
        ),
      ),
  )

  it.effect('only the host may kick', () =>
    Effect.gen(function* () {
      yield* Story.story(
        COOP,
        Story.given(inRoom(1)),
        Story.message(lobbyUpdate(lobbyOf(TWO))),
        Story.message(Message.ClickedKickButton({ playerId: 'player-0' })),
        Story.Command.expectNone(),
      )
      yield* Story.story(
        COOP,
        Story.given(inRoom(0)),
        Story.message(lobbyUpdate(lobbyOf(TWO))),
        Story.message(Message.ClickedKickButton({ playerId: 'player-1' })),
        Story.Command.resolve(
          ChangeLobby({
            change: LobbyChange.KickedPlayer({ playerId: 'player-1' }),
          }),
          Message.CompletedChangeLobby(),
        ),
      )
    }),
  )

  it.effect(
    'the host picks the mode and difficulty; the others only see them',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          COOP,
          Story.given(inRoom(1)),
          Story.message(lobbyUpdate(lobbyOf(TWO))),
          Story.message(Message.ClickedModePick({ mode: 'Endless' })),
          Story.message(Message.ClickedReadyButton()),
          Story.Command.resolve(
            ChangeLobby({
              change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
            }),
            Message.CompletedChangeLobby(),
          ),
        )
        yield* Story.story(
          COOP,
          Story.given(inRoom(0)),
          Story.message(lobbyUpdate(lobbyOf(TWO))),
          Story.message(Message.ClickedModePick({ mode: 'Endless' })),
          picksSent('Endless', 'Normal'),
          Story.message(Message.ClickedDifficultyPick({ difficulty: 'Hard' })),
          picksSent('Campaign', 'Hard'),
          Story.message(
            Message.ClickedDifficultyPick({ difficulty: 'Nightmare' }),
          ),
          Story.message(Message.ClickedModePick({ mode: 'KeepGoing' })),
          Story.message(Message.ClickedModePick({ mode: 'Campaign' })),
          Story.Command.expectNone(),
        )
      }),
  )

  it.effect(
    'the host turns run modifiers on and off; the others only see them',
    () =>
      Effect.gen(function* () {
        const modifiers = (mask: number) =>
          ChangeLobby({
            change: LobbyChange.ChangedModifiers({ modifiers: mask }),
          })
        yield* Story.story(
          COOP,
          Story.given(inRoom(1)),
          Story.message(lobbyUpdate(lobbyOf(TWO))),
          Story.message(Message.ClickedModifierPick({ modifier: 'Glass' })),
          Story.Command.expectNone(),
        )
        yield* Story.story(
          COOP,
          Story.given(inRoom(0)),
          Story.message(lobbyUpdate(lobbyOf(TWO))),
          Story.message(Message.ClickedModifierPick({ modifier: 'Glass' })),
          Story.Command.resolve(modifiers(8), Message.CompletedChangeLobby()),
          Story.message(lobbyUpdate({ ...lobbyOf(TWO), modifiers: 8 })),
          Story.message(Message.ClickedModifierPick({ modifier: 'BigCrowd' })),
          Story.Command.resolve(modifiers(10), Message.CompletedChangeLobby()),
          Story.message(lobbyUpdate({ ...lobbyOf(TWO), modifiers: 10 })),
          Story.message(Message.ClickedModifierPick({ modifier: 'Glass' })),
          Story.Command.resolve(modifiers(2), Message.CompletedChangeLobby()),
        )
      }),
  )

  it.effect('a host in a room that has started picks no modifiers', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      Story.message(lobbyUpdate(lobbyOf(TWO, 'Playing'))),
      Story.message(Message.ClickedModifierPick({ modifier: 'Glass' })),
      Story.Command.expectNone(),
    ),
  )

  it.effect('E and X step the picks, past Nightmare until it is unlocked', () =>
    Effect.gen(function* () {
      const hard = { ...lobbyOf(TWO), difficulty: 'Hard' as const }
      yield* Story.story(
        COOP,
        Story.given(inRoom(0)),
        Story.message(lobbyUpdate(hard)),
        pressed('KeyX'),
        picksSent('Campaign', 'Easy'),
        pressed('KeyE'),
        picksSent('Endless', 'Hard'),
        Story.message(
          lobbyUpdate({
            ...hard,
            members: [memberOf(0, 'Ana', false, '', true), memberOf(1, 'Bo')],
          }),
        ),
        pressed('KeyX'),
        picksSent('Campaign', 'Nightmare'),
      )
      yield* Story.story(
        COOP,
        Story.given(inRoom(0)),
        Story.message(
          lobbyUpdate({ ...lobbyOf(TWO), mode: 'Endless', canKeepGoing: true }),
        ),
        pressed('KeyE'),
        picksSent('KeepGoing', 'Normal'),
      )
    }),
  )

  it.effect('a kicked player lands on the hub with the news', () =>
    Story.story(
      COOP,
      Story.given(inRoom(1)),
      Story.message(lobbyUpdate(lobbyOf(TWO))),
      Story.message(lobbyUpdate(lobbyOf([memberOf(0, 'Ana')]))),
      resolveRemember(),
      Story.model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Kicked') }),
        )
      }),
    ),
  )

  it.effect('LEAVE says goodbye, then lands on the hub', () =>
    Story.story(
      COOP,
      Story.given(inRoom(1)),
      Story.message(lobbyUpdate(lobbyOf(TWO))),
      Story.message(Message.ClickedLeaveButton()),
      Story.model(current => {
        expect(roomOf(current).departure).toBe('Leaving')
      }),
      Story.Command.resolve(LeaveRoom, Message.CompletedLeaveRoom()),
      Story.expectOutMessage(OutMessage.LeftRoom()),
      resolveRemember(),
      resolveFocusCoop(),
      Story.model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.none() }),
        )
      }),
    ),
  )
})

const snapshotFrame = (tick: number) => {
  const writer = makeWriter()
  coopWorld.snapshot(writer, stagedWorld([0, 1], []))
  return {
    _tag: 'Snapshot' as const,
    tick,
    ack: 0,
    world: writer.finish(),
  }
}

const received = (
  frame: Parameters<typeof RoomEvent.cases.Received.make>[0]['frame'],
  atMs: number,
) =>
  Message.ReceivedRoomEvent({
    event: RoomEvent.cases.Received.make({ frame, bytes: 40, atMs }),
    atMs,
  })

const welcome = (tick: number, atMs: number) =>
  Story.message(
    received(
      { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick },
      atMs,
    ),
  )

// NOTE: the room says Welcome and sends its first Snapshot: a run under way.
const online = Story.steps(
  welcome(0, 1000),
  Story.message(received(snapshotFrame(10), 1010)),
)

it.effect('a second LEAVE while leaving sends nothing more', () =>
  Story.story(
    COOP,
    Story.given(
      modifyFields(inRoom(1), {
        screen: () =>
          Screen.InRoom({
            room: { ...freshRoom(CODE, 1), departure: 'Leaving' },
          }),
      }),
    ),
    Story.message(Message.ClickedLeaveButton()),
    Story.Command.expectNone(),
  ),
)

describe('predicted shots', () => {
  const TRIGGER = { ...NEUTRAL_INPUT, aimX: AIM_REACH, buttons: FIRE_BUTTON }

  // NOTE: the shots predicted over `frames` frames of 16 ms from `fromMs`,
  // each frame's count read as the drawing reads it, and the Model after.
  const shotsOver = (
    start: Model,
    controls: typeof NEUTRAL_INPUT,
    fromMs: number,
    frames: number,
  ) => {
    let shots = 0
    return Story.story(
      COOP,
      Story.given(start),
      ...Array.flatMap(Array.range(1, frames), frame => [
        tickAt(fromMs + frame * 16, controls),
        Story.model((ticked: Model) => {
          shots += roomOf(ticked).predictedShots
        }),
      ]),
      framesSent,
    ).pipe(Effect.map(current => ({ current, shots })))
  }

  const live = Story.story(COOP, Story.given(inRoom(0)), online)

  it.effect('holding the trigger fires at once, each shot counted once', () =>
    Effect.gen(function* () {
      const start = yield* live
      const held = yield* shotsOver(start, TRIGGER, 1010, 30)
      expect(held.shots).toBeGreaterThanOrEqual(3)
      expect(held.shots).toBeLessThanOrEqual(4)
      const ownShots = (current: Model) =>
        Option.match(roomOf(current).session.predicted, {
          onNone: () => -1,
          onSome: own => own.player.recoilRemainingMs,
        })
      expect(ownShots(held.current)).toBeGreaterThanOrEqual(0)
      const corrected = yield* Story.story(
        COOP,
        Story.given(held.current),
        Story.message(received(snapshotFrame(40), 1500)),
      )
      const after = yield* shotsOver(corrected, NEUTRAL_INPUT, 1500, 10)
      expect(after.shots).toBe(0)
    }),
  )

  it.effect('a released trigger fires nothing', () =>
    Effect.gen(function* () {
      const start = yield* live
      const released = yield* shotsOver(start, NEUTRAL_INPUT, 1010, 30)
      expect(released.shots).toBe(0)
    }),
  )
})

describe('the room', () => {
  it.effect(
    'a dropped socket shows Away, and the rejoin snapshot brings the room back',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(0)),
        Story.message(
          received(
            { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
            1000,
          ),
        ),
        Story.message(received(snapshotFrame(10), 1010)),
        Story.model(current => {
          expect(roomOf(current).link).toBe('Online')
          expect(roomOf(current).session.phase._tag).toBe('Playing')
        }),
        Story.message(
          Message.ReceivedRoomEvent({
            event: RoomEvent.cases.Dropped.make({ reason: 'Socket ended' }),
            atMs: 2000,
          }),
        ),
        Story.model(current => {
          expect(roomOf(current).link).toBe('Reconnecting')
        }),
        Story.message(
          Message.ReceivedRoomEvent({
            event: RoomEvent.cases.Connecting.make({ attempt: 0 }),
            atMs: 2300,
          }),
        ),
        Story.model(current => {
          expect(roomOf(current).link).toBe('Reconnecting')
        }),
        Story.message(
          received(
            {
              _tag: 'Welcome',
              version: 1,
              slot: 0,
              state: 'Playing',
              tick: 90,
            },
            2400,
          ),
        ),
        Story.message(received(snapshotFrame(90), 2410)),
        Story.model(current => {
          expect(roomOf(current).link).toBe('Online')
        }),
      ),
  )

  it.effect(
    "a run's network numbers count a reconnect and its pings, and a new run starts them afresh",
    () => {
      const ponged = (sentMs: number, atMs: number) =>
        Story.message(
          Message.ReceivedRoomEvent({
            event: RoomEvent.cases.Ponged.make({ sentMs, atMs }),
            atMs,
          }),
        )
      const connecting = (atMs: number) =>
        Story.message(
          Message.ReceivedRoomEvent({
            event: RoomEvent.cases.Connecting.make({ attempt: 0 }),
            atMs,
          }),
        )
      return Story.story(
        COOP,
        Story.given(inRoom(0)),
        online,
        ponged(1100, 1180),
        connecting(2000),
        welcome(90, 2400),
        Story.message(received(snapshotFrame(90), 2410)),
        ponged(2500, 2560),
        Story.model(current => {
          const { net } = roomOf(current).session.stats
          expect(net.reconnects).toBe(1)
          expect(net.rtt.total).toBe(2)
        }),
        welcome(0, 9000),
        Story.model(current => {
          const { net } = roomOf(current).session.stats
          expect(net.reconnects).toBe(0)
          expect(net.rtt.total).toBe(0)
        }),
      )
    },
  )

  it.effect(
    'a Delta that cannot apply asks for a new socket once, and its Snapshot brings the picture back',
    () => {
      const orphan = (tick: number) =>
        received(
          {
            _tag: 'Delta',
            tick,
            base: tick - 3,
            ack: 0,
            pings: [],
            diff: new Uint8Array(),
          },
          1100,
        )
      return Story.story(
        COOP,
        Story.given(inRoom(0)),
        Story.message(
          received(
            { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
            1000,
          ),
        ),
        Story.message(received(snapshotFrame(10), 1010)),
        Story.message(orphan(40)),
        Story.Command.resolve(ResyncRoom, Message.CompletedResyncRoom()),
        Story.model(current => {
          expect(roomOf(current).session.isResyncing).toBe(true)
          expect(roomOf(current).session.stats.resyncs).toBe(1)
        }),
        Story.message(orphan(43)),
        Story.Command.expectNone(),
        Story.message(received(snapshotFrame(60), 1300)),
        Story.model(current => {
          expect(roomOf(current).session.isResyncing).toBe(false)
          expect(
            Array.map(roomOf(current).session.frames, frame => frame.tick),
          ).toEqual([60])
        }),
      )
    },
  )

  describe('a link that stays down', () => {
    const dropped = (atMs: number) =>
      Message.ReceivedRoomEvent({
        event: RoomEvent.cases.Dropped.make({ reason: 'Socket ended' }),
        atMs,
      })

    it.effect(
      'shows Zz at first, then Lost after 20 seconds, with the tries going on',
      () =>
        Story.story(
          COOP,
          Story.given(inRoom(0)),
          online,
          Story.message(dropped(2000)),
          tickAt(3000),
          Story.model(ticked => {
            expect(roomOf(ticked).link).toBe('Reconnecting')
            expect(roomOf(ticked).droppedAtMs).toEqual(Option.some(3000))
          }),
          tickAt(22_900),
          Story.model(current => {
            expect(roomOf(current).link).toBe('Reconnecting')
          }),
          tickAt(23_000),
          Story.model(lost => {
            expect(roomOf(lost).link).toBe('Lost')
          }),
          // NOTE: the room answers again: back Online, the clock cleared.
          Story.message(received(snapshotFrame(30), 24_000)),
          Story.model(back => {
            expect(roomOf(back).link).toBe('Online')
            expect(roomOf(back).droppedAtMs).toEqual(Option.none())
          }),
          framesSent,
        ),
    )

    it.effect(
      'gives up past the rejoin window, back on the hub with LOST',
      () =>
        Story.story(
          COOP,
          Story.given(inRoom(0)),
          online,
          Story.message(dropped(2000)),
          tickAt(3000),
          tickAt(3000 + 135_000),
          Story.model(gone => {
            expect(gone.screen).toEqual(
              Screen.Hub({ maybeProblem: Option.some('Dropped') }),
            )
          }),
          framesSent,
          resolveRemember(),
        ),
    )
  })

  it.effect(
    'the controls from the parent go to the room and the World comes back',
    () => {
      const walking = { ...NEUTRAL_INPUT, moveX: 127 }
      return Story.story(
        COOP,
        Story.given(inRoom(0)),
        online,
        tickAt(1200, walking),
        Story.model(ticked => {
          expect(Option.isSome(roomOf(ticked).maybeWorld)).toBe(true)
        }),
        tickAt(1400, walking),
        expectSent(inputs => {
          expect(
            Array.some(inputs, input =>
              Array.some(input.samples, sample => sample.input.moveX === 127),
            ),
          ).toBe(true)
        }),
        framesSent,
      )
    },
  )

  it.effect('a press rides the inputs as a held value, one at a time', () => {
    const world = stagedWorld([0, 1], []).world
    const heldOf = (current: Model) => roomOf(current).presses.held
    return Story.story(
      COOP,
      Story.given(inRoom(0)),
      online,
      pressSeat(SeatAction.Swap()),
      pressSeat(SeatAction.Ready()),
      Story.model(queued => {
        expect(roomOf(queued).presses.queued.length).toBe(2)
      }),
      tickAt(1100),
      Story.model(first => {
        expect(seatActionOf(world, heldOf(first))).toEqual(
          Option.some(SeatAction.Swap()),
        )
      }),
      Story.models(Story.steps(tickAt(1150)), (first: Model, second: Model) => {
        expect(heldOf(second)).not.toBe(heldOf(first))
        expect(seatActionOf(world, heldOf(second))).toEqual(
          Option.some(SeatAction.Ready()),
        )
      }),
      tickAt(1300),
      // NOTE: both held presses rode the inputs the three frames sent.
      expectSent(inputs => {
        const actions = Array.flatMap(inputs, input =>
          Array.map(input.samples, sample =>
            seatActionOf(world, sample.input.action),
          ),
        )
        expect(actions).toContainEqual(Option.some(SeatAction.Swap()))
        expect(actions).toContainEqual(Option.some(SeatAction.Ready()))
      }),
      framesSent,
    )
  })

  it.effect(
    'a new run in the same room takes presses from its first tick, however late the last run pressed',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(0)),
        online,
        // NOTE: the first run: a press 60 seconds in, so its heldFrom is far out.
        tickAt(61_000),
        pressSeat(SeatAction.Reload()),
        tickAt(61_100),
        Story.model(late => {
          expect(roomOf(late).presses.held).not.toBe(0)
        }),
        // NOTE: the second run: the room says Welcome at tick 0 again.
        welcome(0, 70_000),
        Story.message(received(snapshotFrame(0), 70_010)),
        Story.model(again => {
          expect(roomOf(again).presses).toEqual(noPresses)
        }),
        pressSeat(SeatAction.Ready()),
        ...Array.map(Array.range(1, 6), frame => tickAt(70_100 + frame * 50)),
        Story.model(held => {
          expect(roomOf(held).presses.held).toBe(
            heldAction(actionCodeOf(SeatAction.Ready()), 1),
          )
        }),
        framesSent,
      ),
  )

  it.effect(
    'each event of the room reaches the drawing once, after any hit-stop',
    () =>
      Effect.gen(function* () {
        const played = playRoom(stagedWorld([0, 1], []), 600)
        const later = playRoom(played, 60)
        const diff = makeWriter()
        coopWorld.diff(diff, played, later)
        const start = makeWriter()
        coopWorld.snapshot(start, played)
        const eventsIn = Array.reduce(
          Array.filter(
            later.events,
            entry => entry.tick > played.tick && entry.tick <= later.tick,
          ),
          0,
          (sum, entry) => sum + entry.events.length,
        )
        let drawn = 0
        yield* Story.story(
          COOP,
          Story.given(inRoom(0)),
          welcome(0, 1000),
          Story.message(
            received(
              {
                _tag: 'Snapshot',
                tick: played.tick,
                ack: 0,
                world: start.finish(),
              },
              1000,
            ),
          ),
          Story.message(
            received(
              {
                _tag: 'Delta',
                tick: later.tick,
                base: played.tick,
                ack: 0,
                pings: [],
                diff: diff.finish(),
              },
              1500,
            ),
          ),
          ...Array.flatMap([1600, 1700, 1800, 1900, 2000], nowMs => [
            tickAt(nowMs, NEUTRAL_INPUT, nowMs < 1750),
            Story.model((ticked: Model) => {
              drawn += roomOf(ticked).frameEvents.length
            }),
          ]),
          framesSent,
        )
        expect(eventsIn).toBeGreaterThan(0)
        expect(drawn).toBe(eventsIn)
      }),
  )

  it.effect('a Kicked frame ends the room', () =>
    Story.story(
      COOP,
      Story.given(inRoom(1)),
      Story.message(received({ _tag: 'Kicked' }, 500)),
      Story.expectOutMessage(OutMessage.LeftRoom()),
      resolveRemember(),
      Story.model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Kicked') }),
        )
      }),
    ),
  )

  it.effect('a room on a newer protocol sends the player to update', () =>
    Story.story(
      COOP,
      Story.given(inRoom(1)),
      Story.message(
        received(
          {
            _tag: 'Refused',
            reason: 'VersionMismatch',
            minVersion: PROTOCOL_VERSION + 1,
            maxVersion: PROTOCOL_VERSION + 1,
          },
          500,
        ),
      ),
      Story.expectOutMessage(OutMessage.NeededNewerBuild()),
      resolveRemember(),
      Story.model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Outdated') }),
        )
      }),
    ),
  )
})

describe('the network service', () => {
  it.effect(
    'RequestRoom runs against the service and reports its refusal',
    () =>
      Effect.gen(function* () {
        const fake = yield* makeFakeCoopNet(() => Effect.fail('Full'))
        const handlers = yield* Layer.build(
          Layer.provide(RequestRoom.layer, fake.layer),
        )
        const result = yield* Effect.provideContext(
          RequestRoom({
            request: RoomRequest.Join({ code: CODE }),
            name: 'Ana',
            look: 'Male.Curls.Black.Deep.Yellow',
            rank: 42,
            calling: 'Handyman',
            introSeen: true,
          }).effect,
          handlers,
        )
        expect(result).toEqual(Message.FailedRequestRoom({ problem: 'Full' }))
        const calls_1 = yield* fake.calls
        expect(calls_1).toEqual([
          {
            _tag: 'RequestRoom',
            request: RoomRequest.Join({ code: CODE }),
            name: 'Ana',
            look: 'Male.Curls.Black.Deep.Yellow',
            rank: 42,
            calling: 'Handyman',
            introSeen: true,
          },
        ])
      }),
  )
})
