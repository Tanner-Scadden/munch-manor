import { Array, Effect, Layer, Option, Schema } from 'effect'
import {
  Command,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import {
  type ClientFrame,
  type InputFrame,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  makeWriter,
} from '@munch/netcode'
import { RoomEvent } from '@munch/netcode/browser'

import { playRoom } from '../roomTesting'
import { AIM_REACH, FIRE_BUTTON, seatActionOf } from '../roomWorld'
import { SeatAction } from '../stepWorld'
import { Message, OutMessage } from './message'
import {
  LobbyChange,
  type Model,
  type Room,
  RoomRequest,
  Screen,
  emptyQueue,
  initialModel,
} from './model'
import { cleanCode, freshRoom, maybeRoomOf, pressAction } from './roomState'
import { coopWorld } from './seam'
import {
  CODE,
  lobbyOf,
  makeFakeCoopNet,
  memberOf,
  stagedWorld,
} from './testing'
import {
  AnswerOffer,
  CancelQuickPlay,
  ChangeLobby,
  FocusCoopElement,
  LeaveRoom,
  RememberRoom,
  RequestRoom,
  ResyncRoom,
  SendRoomFrames,
  open,
  pressKey,
  tickRoom,
  update,
} from './update'

const onHub: Model = open(initialModel, '', Option.none()).model

const resolveFocus = () =>
  Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement())

const resolveRemember = () =>
  Command.resolve(RememberRoom, Message.CompletedRememberRoom())

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

const roomOf = (current: Model): Room => Option.getOrThrow(maybeRoomOf(current))

const inRoom = (slot: number): Model =>
  modifyFields(onHub, {
    screen: () => Screen.InRoom({ room: freshRoom(CODE, slot) }),
  })

const lobbyUpdate = (lobby: ReturnType<typeof lobbyOf>) =>
  Message.ReceivedLobbyEvent({ event: { _tag: 'Updated', lobby } })

const TWO = [memberOf(0, 'Ana'), memberOf(1, 'Bo')]

const decodeChange = Schema.decodeUnknownOption(
  Schema.Struct({ change: LobbyChange }),
)

const picked = (current: Model, code: string) =>
  Array.flatMap(pressKey(current, code).commands ?? [], command =>
    Option.match(decodeChange(command.args), {
      onNone: () => [],
      onSome: ({ change }) =>
        LobbyChange.isAnyOf(['ChangedPicks'])(change)
          ? [change.mode, change.difficulty]
          : [],
    }),
  )

describe('co-op hub', () => {
  test('the X on the hub closes co-op and tells the parent', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedCloseButton()),
      model(current => {
        expect(current.screen._tag).toBe('Closed')
      }),
      expectOutMessage(OutMessage.ClosedCoop()),
    )
  })

  test('a code typed in any case, or pasted as a link, joins at five symbols', () => {
    expect(cleanCode('mn-ch')).toBe('MNCH')
    expect(cleanCode('O0I1ab')).toBe('AB')
    expect(cleanCode(`https://munch.example/?room=${CODE}`)).toBe(CODE)
    story(
      update,
      given(onHub),
      message(Message.ClickedCodeButton()),
      resolveFocus(),
      message(Message.UpdatedCode({ value: 'mn' })),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Code({ typed: 'MN', maybeProblem: Option.none() }),
        )
      }),
      message(
        Message.UpdatedCode({ value: `https://x.example/?room=${CODE}` }),
      ),
      model(current => {
        expect(current.screen._tag).toBe('Asking')
      }),
      Command.resolve(
        RequestRoom({
          request: RoomRequest.Join({ code: CODE }),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
        }),
        Message.FailedRequestRoom({ problem: 'NoRoom' }),
      ),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Code({ typed: CODE, maybeProblem: Option.some('NoRoom') }),
        )
      }),
    )
  })

  test('NEW ROOM asks for a room and lands in its lobby', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedCreateButton()),
      Command.resolve(
        RequestRoom({
          request: RoomRequest.Create(),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
        }),
        Message.SucceededRequestRoom({ code: CODE, slot: 0 }),
      ),
      resolveRemember(),
      resolveFocus(),
      model(current => {
        expect(roomOf(current).code).toBe(CODE)
        expect(roomOf(current).slot).toBe(0)
      }),
    )
  })
})

describe('QUICK PLAY', () => {
  test('the queue fills, the offer is accepted, and the match opens the room', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(waiting(2)),
      model(current => {
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
      message(waiting(3, 3)),
      message(Message.ClickedAcceptOfferButton()),
      Command.resolve(
        AnswerOffer({ accept: true }),
        Message.CompletedAnswerOffer(),
      ),
      model(current => {
        expect(
          Screen.isAnyOf(['Queue'])(current.screen) &&
            current.screen.queue.answer,
        ).toBe('Accepted')
      }),
      message(waiting(3, 3, 2)),
      model(current => {
        expect(
          Screen.isAnyOf(['Queue'])(current.screen) &&
            current.screen.queue.answer,
        ).toBe('Accepted')
      }),
      message(matched),
      resolveRemember(),
      resolveFocus(),
      model(current => {
        expect(roomOf(current).slot).toBe(1)
      }),
    )
  })

  test('keep waiting answers no and hides the offer until the next one', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(waiting(2, 2)),
      message(Message.ClickedKeepWaitingButton()),
      Command.resolve(
        AnswerOffer({ accept: false }),
        Message.CompletedAnswerOffer(),
      ),
      message(waiting(2)),
      model(current => {
        expect(
          Screen.isAnyOf(['Queue'])(current.screen) &&
            current.screen.queue.answer,
        ).toBe('Unanswered')
      }),
    )
  })

  test('the X leaves the queue', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(Message.ClickedCancelQueueButton()),
      Command.resolve(CancelQuickPlay, Message.CompletedCancelQuickPlay()),
      model(current => {
        expect(current.screen._tag).toBe('Hub')
      }),
    )
  })

  test('a dropped queue says so on the hub', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(
        Message.ReceivedQuickPlayEvent({
          event: { _tag: 'Dropped', reason: 'Closed' },
        }),
      ),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Dropped') }),
        )
      }),
    )
  })
})

describe('the lobby', () => {
  test('READY writes the toggle for this seat, and again to take it back', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      model(current => {
        expect(roomOf(current).maybePlayerId).toEqual(Option.some('player-1'))
      }),
      message(Message.ClickedReadyButton()),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        Message.CompletedChangeLobby(),
      ),
      message(
        lobbyUpdate(lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
      ),
      message(Message.ClickedReadyButton()),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: false, pingMs: 0 }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('only the host may kick', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedKickButton({ playerId: 'player-0' })),
      Command.expectNone(),
    )
    story(
      update,
      given(inRoom(0)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedKickButton({ playerId: 'player-1' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.KickedPlayer({ playerId: 'player-1' }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('the host picks the mode and difficulty; the others only see them', () => {
    const picks = (
      mode: 'Campaign' | 'Endless' | 'KeepGoing',
      difficulty: 'Easy' | 'Normal' | 'Hard' | 'Nightmare',
    ) => ChangeLobby({ change: LobbyChange.ChangedPicks({ mode, difficulty }) })
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedModePick({ mode: 'Endless' })),
      message(Message.ClickedReadyButton()),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
    story(
      update,
      given(inRoom(0)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedModePick({ mode: 'Endless' })),
      Command.resolve(
        picks('Endless', 'Normal'),
        Message.CompletedChangeLobby(),
      ),
      message(Message.ClickedDifficultyPick({ difficulty: 'Hard' })),
      Command.resolve(
        picks('Campaign', 'Hard'),
        Message.CompletedChangeLobby(),
      ),
      message(Message.ClickedDifficultyPick({ difficulty: 'Nightmare' })),
      message(Message.ClickedModePick({ mode: 'KeepGoing' })),
      message(Message.ClickedModePick({ mode: 'Campaign' })),
      Command.expectNone(),
    )
  })

  test('E and X step the picks, past Nightmare until it is unlocked', () => {
    const hard = { ...lobbyOf(TWO), difficulty: 'Hard' as const }
    story(
      update,
      given(inRoom(0)),
      message(lobbyUpdate(hard)),
      model(current => {
        expect(picked(current, 'KeyX')).toEqual(['Campaign', 'Easy'])
        expect(picked(current, 'KeyE')).toEqual(['Endless', 'Hard'])
        const unlocked = update(
          current,
          lobbyUpdate({
            ...hard,
            members: [memberOf(0, 'Ana', false, '', true), memberOf(1, 'Bo')],
          }),
        ).model
        expect(picked(unlocked, 'KeyX')).toEqual(['Campaign', 'Nightmare'])
      }),
    )
    story(
      update,
      given(inRoom(0)),
      message(
        lobbyUpdate({ ...lobbyOf(TWO), mode: 'Endless', canKeepGoing: true }),
      ),
      model(current => {
        expect(picked(current, 'KeyE')).toEqual(['KeepGoing', 'Normal'])
      }),
    )
  })

  test('a kicked player lands on the hub with the news', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(lobbyUpdate(lobbyOf([memberOf(0, 'Ana')]))),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Kicked') }),
        )
      }),
    )
  })

  test('LEAVE says goodbye, then lands on the hub', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedLeaveButton()),
      model(current => {
        expect(roomOf(current).departure).toBe('Leaving')
      }),
      Command.resolve(LeaveRoom, Message.CompletedLeaveRoom()),
      expectOutMessage(OutMessage.LeftRoom()),
      resolveRemember(),
      resolveFocus(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.none() }),
        )
      }),
    )
  })
})

// NOTE: the Input frames a return's SendRoomFrames carry.
const sentInputs = (
  commands: ReadonlyArray<{ readonly name: string; readonly args?: unknown }>,
): ReadonlyArray<InputFrame> =>
  commands.flatMap(command => {
    const args = command.args
    if (
      command.name !== SendRoomFrames.name ||
      typeof args !== 'object' ||
      args === null ||
      !('frames' in args) ||
      !globalThis.Array.isArray(args.frames)
    ) {
      return []
    }
    return args.frames.filter(
      (frame: ClientFrame): frame is InputFrame => frame._tag === 'Input',
    )
  })

const snapshotFrame = (tick: number) => {
  const writer = makeWriter()
  coopWorld.snapshot(writer, stagedWorld([0, 1]))
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

test('a second LEAVE while leaving sends nothing more', () => {
  story(
    update,
    given(
      modifyFields(inRoom(1), {
        screen: () =>
          Screen.InRoom({
            room: { ...freshRoom(CODE, 1), departure: 'Leaving' },
          }),
      }),
    ),
    message(Message.ClickedLeaveButton()),
    Command.expectNone(),
  )
})

describe('predicted shots', () => {
  const live = (): Model =>
    [
      received(
        { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
        1000,
      ),
      received(snapshotFrame(10), 1010),
    ].reduce((current, next) => update(current, next).model, inRoom(0))

  const TRIGGER = { ...NEUTRAL_INPUT, aimX: AIM_REACH, buttons: FIRE_BUTTON }

  const shotsOver = (
    start: Model,
    controls: typeof NEUTRAL_INPUT,
    fromMs: number,
    frames: number,
  ) =>
    Array.reduce(
      Array.range(1, frames),
      { current: start, shots: 0 },
      ({ current, shots }, frame) => {
        const ticked = tickRoom(current, controls, fromMs + frame * 16).model
        return {
          current: ticked,
          shots: shots + roomOf(ticked).predictedShots,
        }
      },
    )

  test('holding the trigger fires at once, each shot counted once', () => {
    const held = shotsOver(live(), TRIGGER, 1010, 30)
    expect(held.shots).toBeGreaterThanOrEqual(3)
    expect(held.shots).toBeLessThanOrEqual(4)
    const ownShots = (current: Model) =>
      Option.match(roomOf(current).session.predicted, {
        onNone: () => -1,
        onSome: own => own.player.recoilRemainingMs,
      })
    expect(ownShots(held.current)).toBeGreaterThanOrEqual(0)
    const corrected = update(
      held.current,
      received(snapshotFrame(40), 1500),
    ).model
    const after = shotsOver(corrected, NEUTRAL_INPUT, 1500, 10)
    expect(after.shots).toBe(0)
  })

  test('a released trigger fires nothing', () => {
    expect(shotsOver(live(), NEUTRAL_INPUT, 1010, 30).shots).toBe(0)
  })
})

describe('the room', () => {
  test('a dropped socket shows Away, and the rejoin snapshot brings the room back', () => {
    story(
      update,
      given(inRoom(0)),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(received(snapshotFrame(10), 1010)),
      model(current => {
        expect(roomOf(current).link).toBe('Online')
        expect(roomOf(current).session.phase._tag).toBe('Playing')
      }),
      message(
        Message.ReceivedRoomEvent({
          event: RoomEvent.cases.Dropped.make({ reason: 'Socket ended' }),
          atMs: 2000,
        }),
      ),
      model(current => {
        expect(roomOf(current).link).toBe('Reconnecting')
      }),
      message(
        Message.ReceivedRoomEvent({
          event: RoomEvent.cases.Connecting.make({ attempt: 0 }),
          atMs: 2300,
        }),
      ),
      model(current => {
        expect(roomOf(current).link).toBe('Reconnecting')
      }),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 90 },
          2400,
        ),
      ),
      message(received(snapshotFrame(90), 2410)),
      model(current => {
        expect(roomOf(current).link).toBe('Online')
      }),
    )
  })

  test('a Delta that cannot apply asks for a new socket once, and its Snapshot brings the picture back', () => {
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
    story(
      update,
      given(inRoom(0)),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(received(snapshotFrame(10), 1010)),
      message(orphan(40)),
      Command.resolve(ResyncRoom, Message.CompletedResyncRoom()),
      model(current => {
        expect(roomOf(current).session.isResyncing).toBe(true)
        expect(roomOf(current).session.stats.resyncs).toBe(1)
      }),
      message(orphan(43)),
      Command.expectNone(),
      message(received(snapshotFrame(60), 1300)),
      model(current => {
        expect(roomOf(current).session.isResyncing).toBe(false)
        expect(roomOf(current).session.frames.map(frame => frame.tick)).toEqual(
          [60],
        )
      }),
    )
  })

  test('the controls from the parent go to the room and the World comes back', () => {
    const walking = { ...NEUTRAL_INPUT, moveX: 127 }
    story(
      update,
      given(inRoom(0)),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(received(snapshotFrame(10), 1010)),
      model(current => {
        const ticked = tickRoom(current, walking, 1200)
        expect(Option.isSome(roomOf(ticked.model).maybeWorld)).toBe(true)
        const later = tickRoom(ticked.model, walking, 1400)
        const inputs = [
          ...sentInputs(ticked.commands ?? []),
          ...sentInputs(later.commands ?? []),
        ]
        expect(
          inputs.some(input =>
            input.samples.some(sample => sample.input.moveX === 127),
          ),
        ).toBe(true)
      }),
    )
  })

  test('a press rides the inputs as a held value, one at a time', () => {
    story(
      update,
      given(inRoom(0)),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(received(snapshotFrame(10), 1010)),
      model(current => {
        const pressed = pressAction(
          pressAction(current, SeatAction.Swap()),
          SeatAction.Ready(),
        )
        expect(roomOf(pressed).presses.queued.length).toBe(2)
        const firstTick = tickRoom(pressed, NEUTRAL_INPUT, 1100)
        const first = firstTick.model
        const firstHeld = roomOf(first).presses.held
        expect(seatActionOf(stagedWorld([0, 1]).world, firstHeld)).toEqual(
          Option.some(SeatAction.Swap()),
        )
        const secondTick = tickRoom(first, NEUTRAL_INPUT, 1150)
        const second = secondTick.model
        const secondHeld = roomOf(second).presses.held
        expect(secondHeld).not.toBe(firstHeld)
        expect(seatActionOf(stagedWorld([0, 1]).world, secondHeld)).toEqual(
          Option.some(SeatAction.Ready()),
        )
        const sent = tickRoom(second, NEUTRAL_INPUT, 1300)
        const actions = [
          ...sentInputs(firstTick.commands ?? []),
          ...sentInputs(secondTick.commands ?? []),
          ...sentInputs(sent.commands ?? []),
        ].flatMap(input => input.samples.map(sample => sample.input.action))
        expect(actions).toContain(firstHeld)
        expect(actions).toContain(secondHeld)
      }),
    )
  })

  test('each event of the room reaches the drawing once, after any hit-stop', () => {
    const played = playRoom(stagedWorld([0, 1]), 600)
    const later = playRoom(played, 30)
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
    story(
      update,
      given(inRoom(0)),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(
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
      message(
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
      model(current => {
        const drawn = Array.reduce(
          [1600, 1700, 1800, 1900, 2000],
          { model: current, events: 0 },
          (state, nowMs) => {
            const ticked = tickRoom(
              state.model,
              NEUTRAL_INPUT,
              nowMs,
              nowMs < 1750,
            ).model
            return {
              model: ticked,
              events: state.events + roomOf(ticked).frameEvents.length,
            }
          },
        )
        expect(eventsIn).toBeGreaterThan(0)
        expect(drawn.events).toBe(eventsIn)
      }),
    )
  })

  test('a Kicked frame ends the room', () => {
    story(
      update,
      given(inRoom(1)),
      message(received({ _tag: 'Kicked' }, 500)),
      expectOutMessage(OutMessage.LeftRoom()),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Kicked') }),
        )
      }),
    )
  })

  test('a room on a newer protocol sends the player to update', () => {
    story(
      update,
      given(inRoom(1)),
      message(
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
      expectOutMessage(OutMessage.NeededNewerBuild()),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Outdated') }),
        )
      }),
    )
  })
})

describe('the network service', () => {
  it.effect(
    'RequestRoom runs against the service and reports its refusal',
    () =>
      Effect.gen(function* () {
        const fake = yield* makeFakeCoopNet(() => Effect.fail('Full'))
        const result = yield* Effect.provide(
          RequestRoom({
            request: RoomRequest.Join({ code: CODE }),
            name: 'Ana',
            look: 'Male.Curls.Black.Deep.Yellow',
            rank: 42,
            calling: 'Handyman',
          }).effect,
          Layer.provide(RequestRoom.layer, fake.layer),
        )
        expect(result).toEqual(Message.FailedRequestRoom({ problem: 'Full' }))
        expect(yield* fake.calls).toEqual([
          {
            _tag: 'RequestRoom',
            request: RoomRequest.Join({ code: CODE }),
            name: 'Ana',
            look: 'Male.Curls.Black.Deep.Yellow',
            rank: 42,
            calling: 'Handyman',
          },
        ])
      }),
  )
})
