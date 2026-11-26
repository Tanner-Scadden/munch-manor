import { Array, Context, Effect, Function, Layer, Option } from 'effect'

import { Component, Query, Renderer, UiStruct } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { describe, expect, it } from '@effect/vitest'
import {
  type InputFrame,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  makeWriter,
} from '@munch/netcode'
import { RoomEvent } from '@munch/netcode/browser'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { FocusHomeButton } from '../../../app/update/home'
import { FetchBuild } from '../../../app/update/version'
import {
  LobbyChange,
  RoomRequest,
  Screen,
  coopWorld,
  noPresses,
} from '../../../domain/coopRoom'
import { VersionMessage } from '../../../platform/message'
import { playRoom } from '../../../test/roomTesting'
import {
  type StoryStep,
  checkModel,
  press,
  resolveAll,
  resolveFocusCoop,
  resolveRememberRoom,
  send,
  steps,
  storyOf,
} from '../../../test/testing'
import {
  AIM_REACH,
  FIRE_BUTTON,
  actionCodeOf,
  heldAction,
  seatActionOf,
} from '../../../world/net/roomWorld'
import { SeatAction } from '../../../world/step/stepWorld'
import { CoopMessage, CoopNotice } from '../message'
import { type Model as CoopModel, emptyQueue } from '../model'
import { cleanCode, freshRoom, pressAction } from '../roomState'
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
  RequestRoom,
  ResyncRoom,
  SendRoomFrames,
  asRequest,
  tickRoom,
  updateCoop,
} from '../update'
import {
  type Driven,
  argsIssued,
  byMessage,
  byRule,
  drivenFrom,
  inRoom,
  inRoomCoop,
  lobbyChanged,
  lobbyUpdate,
  onHub,
  roomOf,
  withCoop,
} from './story.fixture'

// Co-op in the root: its Messages are the root's, and its rules run as the
// root's Steps (src/app/update/coop.ts). What co-op tells the root (a
// notice) is checked by what the root does with it, or, where the root does
// nothing in its lobby (LeftRoom), on the rule's own result.

// NOTE: the mode and difficulty a key or tap sent the room's lobby.
const picksSent =
  (
    mode: 'Campaign' | 'Endless' | 'KeepGoing',
    difficulty: 'Easy' | 'Normal' | 'Hard' | 'Nightmare',
  ): StoryStep =>
  s =>
    s.resolve(
      ChangeLobby.make({
        change: LobbyChange.ChangedPicks({ mode, difficulty }),
      }),
      Component.noop,
    )

// NOTE: each room frame sends what the session owes; the sends pending are
// answered as sent, with nothing to count.
const framesSent: StoryStep = resolveAll(SendRoomFrames)(
  CoopMessage.CompletedSendRoomFrames({ bytes: [] }),
)

// NOTE: one frame of the room on the root's clock, in its lobby: the root
// ticks it with no controls, and what it owes the room is sent.
const tickAt = (nowMs: number): StoryStep =>
  steps(send(Message.TickedRoomFrame({ nowMs })), framesSent)

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
        names: Array.take(['Ana', 'Bo', 'Cy'], waitingCount),
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

const queueAnswerOf = (current: Model) =>
  Screen.isAnyOf(['Queue'])(current.coop.screen) &&
  current.coop.screen.queue.answer

describe('co-op hub', () => {
  it.effect('the X on the hub closes co-op and tells the root', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onHub)
      s.pipe(
        send(Message.ClickedCoopCloseButton()),
        checkModel(current => {
          expect(current.coop.screen._tag).toBe('Closed')
        }),
      ).resolve(FocusHomeButton.make({ button: 'Coop' }), Component.noop)
    }),
  )

  it.effect(
    'a code typed in any case, or pasted as a link, joins at five symbols',
    () =>
      Effect.gen(function* () {
        expect(cleanCode('mn-ch')).toBe('MNCH')
        expect(cleanCode('O0I1ab')).toBe('AB')
        expect(cleanCode(`https://munch.example/?room=${CODE}`)).toBe(CODE)
        const s = yield* storyOf(onHub)
        s.pipe(
          send(Message.ClickedCoopCodeButton()),
          resolveFocusCoop,
          send(Message.UpdatedCoopCode({ value: 'mn' })),
          checkModel(current => {
            expect(current.coop.screen).toEqual(
              Screen.Code({ typed: 'MN', maybeProblem: Option.none() }),
            )
          }),
          send(
            Message.UpdatedCoopCode({
              value: `https://x.example/?room=${CODE}`,
            }),
          ),
          checkModel(current => {
            expect(current.coop.screen._tag).toBe('Asking')
          }),
        ).resolve(
          RequestRoom.make({
            request: RoomRequest.Join({ code: CODE }),
            name: '',
            look: '',
            rank: 1,
            calling: 'You',
            introSeen: false,
          }),
          CoopMessage.FailedRequestRoom({ problem: 'NoRoom' }),
        )
        s.pipe(
          resolveRememberRoom,
          checkModel(current => {
            expect(current.coop.screen).toEqual(
              Screen.Code({ typed: CODE, maybeProblem: Option.some('NoRoom') }),
            )
          }),
        )
      }),
  )

  it.effect('NEW ROOM asks for a room and lands in its lobby', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onHub)
      s.send(Message.ClickedCoopCreateButton()).resolve(
        RequestRoom.make({
          request: RoomRequest.Create(),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
          introSeen: false,
        }),
        CoopMessage.SucceededRequestRoom({ code: CODE, slot: 0 }),
      )
      s.pipe(
        resolveRememberRoom,
        resolveFocusCoop,
        checkModel(current => {
          expect(roomOf(current).code).toBe(CODE)
          expect(roomOf(current).slot).toBe(0)
        }),
      )
    }),
  )
})

describe('QUICK PLAY', () => {
  it.effect(
    'the queue fills, the offer is accepted, and the match opens the room',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(onHub)
        s.pipe(
          send(Message.ClickedCoopQuickPlayButton()),
          send(waiting(2)),
          checkModel(current => {
            expect(current.coop.screen).toEqual(
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
          send(waiting(3, 3)),
          send(Message.ClickedCoopAcceptOfferButton()),
        ).resolve(AnswerOffer.make({ accept: true }), Component.noop)
        s.pipe(
          checkModel(current => {
            expect(queueAnswerOf(current)).toBe('Accepted')
          }),
          send(waiting(3, 3, 2)),
          checkModel(current => {
            expect(queueAnswerOf(current)).toBe('Accepted')
          }),
          send(matched),
          resolveRememberRoom,
          resolveFocusCoop,
          checkModel(current => {
            expect(roomOf(current).slot).toBe(1)
          }),
        )
      }),
  )

  it.effect(
    'keep waiting answers no and hides the offer until the next one',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(onHub)
        s.pipe(
          send(Message.ClickedCoopQuickPlayButton()),
          send(waiting(2, 2)),
          send(Message.ClickedCoopKeepWaitingButton()),
        ).resolve(AnswerOffer.make({ accept: false }), Component.noop)
        s.pipe(
          send(waiting(2)),
          checkModel(current => {
            expect(queueAnswerOf(current)).toBe('Unanswered')
          }),
        )
      }),
  )

  it.effect('the X leaves the queue', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onHub)
      s.pipe(
        send(Message.ClickedCoopQuickPlayButton()),
        send(Message.ClickedCoopCancelQueueButton()),
      ).resolve(CancelQuickPlay, Component.noop)
      s.pipe(
        checkModel(current => {
          expect(current.coop.screen._tag).toBe('Hub')
        }),
      )
    }),
  )

  it.effect('a dropped queue says so on the hub', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onHub)
      s.pipe(
        send(Message.ClickedCoopQuickPlayButton()),
        send(
          Message.ReceivedQuickPlayEvent({
            event: { _tag: 'Dropped', reason: 'Closed' },
          }),
        ),
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Hub({ maybeProblem: Option.some('Dropped') }),
          )
        }),
      )
    }),
  )
})

describe('the lobby', () => {
  it.effect(
    'READY writes the toggle for this seat, and again to take it back',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inRoom(1))
        s.pipe(
          send(lobbyUpdate(lobbyOf(TWO))),
          checkModel(current => {
            expect(roomOf(current).maybePlayerId).toEqual(
              Option.some('player-1'),
            )
          }),
          send(Message.ClickedCoopReadyButton()),
          lobbyChanged(LobbyChange.ChangedReady({ ready: true, pingMs: 0 })),
          send(
            lobbyUpdate(lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
          ),
          send(Message.ClickedCoopReadyButton()),
          lobbyChanged(LobbyChange.ChangedReady({ ready: false, pingMs: 0 })),
        )
      }),
  )

  it.effect('only the host may kick', () =>
    Effect.gen(function* () {
      const guest = yield* storyOf(inRoom(1))
      guest
        .pipe(
          send(lobbyUpdate(lobbyOf(TWO))),
          send(Message.ClickedCoopKickButton({ playerId: 'player-0' })),
        )
        .expectNone()
      const host = yield* storyOf(inRoom(0))
      host.pipe(
        send(lobbyUpdate(lobbyOf(TWO))),
        send(Message.ClickedCoopKickButton({ playerId: 'player-1' })),
        lobbyChanged(LobbyChange.KickedPlayer({ playerId: 'player-1' })),
      )
    }),
  )

  it.effect(
    'the host picks the mode and difficulty; the others only see them',
    () =>
      Effect.gen(function* () {
        const guest = yield* storyOf(inRoom(1))
        guest.pipe(
          send(lobbyUpdate(lobbyOf(TWO))),
          send(Message.ClickedCoopModePick({ mode: 'Endless' })),
          send(Message.ClickedCoopReadyButton()),
          lobbyChanged(LobbyChange.ChangedReady({ ready: true, pingMs: 0 })),
        )
        const host = yield* storyOf(inRoom(0))
        host
          .pipe(
            send(lobbyUpdate(lobbyOf(TWO))),
            send(Message.ClickedCoopModePick({ mode: 'Endless' })),
            picksSent('Endless', 'Normal'),
            send(Message.ClickedCoopDifficultyPick({ difficulty: 'Hard' })),
            picksSent('Campaign', 'Hard'),
            send(
              Message.ClickedCoopDifficultyPick({ difficulty: 'Nightmare' }),
            ),
            send(Message.ClickedCoopModePick({ mode: 'KeepGoing' })),
            send(Message.ClickedCoopModePick({ mode: 'Campaign' })),
          )
          .expectNone()
      }),
  )

  it.effect(
    'the host turns run modifiers on and off; the others only see them',
    () =>
      Effect.gen(function* () {
        const modifiers = (mask: number) =>
          lobbyChanged(LobbyChange.ChangedModifiers({ modifiers: mask }))
        const guest = yield* storyOf(inRoom(1))
        guest
          .pipe(
            send(lobbyUpdate(lobbyOf(TWO))),
            send(Message.ClickedCoopModifierPick({ modifier: 'Glass' })),
          )
          .expectNone()
        const host = yield* storyOf(inRoom(0))
        host.pipe(
          send(lobbyUpdate(lobbyOf(TWO))),
          send(Message.ClickedCoopModifierPick({ modifier: 'Glass' })),
          modifiers(8),
          send(lobbyUpdate({ ...lobbyOf(TWO), modifiers: 8 })),
          send(Message.ClickedCoopModifierPick({ modifier: 'BigCrowd' })),
          modifiers(10),
          send(lobbyUpdate({ ...lobbyOf(TWO), modifiers: 10 })),
          send(Message.ClickedCoopModifierPick({ modifier: 'Glass' })),
          modifiers(2),
        )
      }),
  )

  // NOTE: owner, 2026-11-12: on Dare the host picks the break's clock.
  it.effect(
    'on Dare the host steps the break clock; above Dare and for a guest it sends nothing',
    () =>
      Effect.gen(function* () {
        const dare = { ...lobbyOf(TWO), difficulty: 'Easy' as const }
        const clock = (seconds: number) =>
          lobbyChanged(LobbyChange.ChangedEasyBreak({ seconds }))
        const host = yield* storyOf(inRoom(0))
        host.pipe(
          send(lobbyUpdate(dare)),
          send(Message.ClickedCoopEasyBreakPick()),
          clock(60),
          send(lobbyUpdate({ ...dare, easyBreakSeconds: 20 })),
          send(Message.ClickedCoopEasyBreakPick()),
          clock(0),
        )
        const aboveDare = yield* storyOf(inRoom(0))
        aboveDare
          .pipe(
            send(lobbyUpdate(lobbyOf(TWO))),
            send(Message.ClickedCoopEasyBreakPick()),
          )
          .expectNone()
        const guest = yield* storyOf(inRoom(1))
        guest
          .pipe(
            send(lobbyUpdate(dare)),
            send(Message.ClickedCoopEasyBreakPick()),
          )
          .expectNone()
      }),
  )

  it.effect('a host in a room that has started picks no modifiers', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        send(lobbyUpdate(lobbyOf(TWO, 'Playing'))),
        send(Message.ClickedCoopModifierPick({ modifier: 'Glass' })),
      ).expectNone()
    }),
  )

  it.effect('E and X step the picks, past Nightmare until it is unlocked', () =>
    Effect.gen(function* () {
      const hard = { ...lobbyOf(TWO), difficulty: 'Hard' as const }
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        send(lobbyUpdate(hard)),
        press('KeyX'),
        picksSent('Campaign', 'Easy'),
        press('KeyE'),
        picksSent('Endless', 'Hard'),
        send(
          lobbyUpdate({
            ...hard,
            members: [memberOf(0, 'Ana', false, '', true), memberOf(1, 'Bo')],
          }),
        ),
        press('KeyX'),
        picksSent('Campaign', 'Nightmare'),
      )
      const keepGoing = yield* storyOf(inRoom(0))
      keepGoing.pipe(
        send(
          lobbyUpdate({ ...lobbyOf(TWO), mode: 'Endless', canKeepGoing: true }),
        ),
        press('KeyE'),
        picksSent('KeepGoing', 'Normal'),
      )
    }),
  )

  it.effect('a kicked player lands on the hub with the news', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(1))
      s.pipe(
        send(lobbyUpdate(lobbyOf(TWO))),
        send(lobbyUpdate(lobbyOf([memberOf(0, 'Ana')]))),
        resolveRememberRoom,
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Hub({ maybeProblem: Option.some('Kicked') }),
          )
        }),
      )
    }),
  )

  it.effect('LEAVE says goodbye, then lands on the hub', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(1))
      s.pipe(
        send(lobbyUpdate(lobbyOf(TWO))),
        send(Message.ClickedCoopLeaveButton()),
        checkModel(current => {
          expect(roomOf(current).departure).toBe('Leaving')
        }),
      )
      // NOTE: co-op tells the root the room is gone (LeftRoom), which the
      // root answers only for a run it holds.
      expect(
        updateCoop(CoopMessage.CompletedLeaveRoom())(s.model.coop).notice,
      ).toEqual(CoopNotice.LeftRoom())
      s.resolve(LeaveRoom, CoopMessage.CompletedLeaveRoom()).pipe(
        resolveRememberRoom,
        resolveFocusCoop,
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Hub({ maybeProblem: Option.none() }),
          )
        }),
      )
    }),
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
  CoopMessage.ReceivedRoomEvent({
    event: RoomEvent.cases.Received.make({ frame, bytes: 40, atMs }),
    atMs,
  })

const welcomeMessage = (tick: number, atMs: number) =>
  received(
    { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick },
    atMs,
  )

const welcome = (tick: number, atMs: number): StoryStep =>
  send(welcomeMessage(tick, atMs))

// NOTE: the room says Welcome and sends its first Snapshot: a run under way.
const online: StoryStep = steps(
  welcome(0, 1000),
  send(received(snapshotFrame(10), 1010)),
)

it.effect('a second LEAVE while leaving sends nothing more', () =>
  Effect.gen(function* () {
    const s = yield* storyOf(
      withCoop(
        UiStruct.evolve(inRoomCoop(1), {
          screen: () =>
            Screen.InRoom({
              room: { ...freshRoom(CODE, 1), departure: 'Leaving' },
            }),
        }),
      ),
    )
    s.send(Message.ClickedCoopLeaveButton()).expectNone()
  }),
)

// CO-OP'S RULES ALONE

// NOTE: the root's requests a run in the root makes (src/app/update/
// coopPlay.ts): a room frame with this client's controls, held for
// hit-stop or not, and a press. Played on co-op's rules alone.
const tickWith =
  (nowMs: number, controls: typeof NEUTRAL_INPUT, isPictureHeld = false) =>
  (driven: Driven): Driven =>
    byRule(asRequest(tickRoom({ controls, nowMs, isPictureHeld })))(driven)

const pressSeat =
  (action: SeatAction) =>
  (driven: Driven): Driven =>
    byRule(asRequest(coop => ({ model: pressAction(coop, action) })))(driven)

const roomIn = (driven: Driven) =>
  Option.getOrThrow(
    Screen.isAnyOf(['InRoom'])(driven.coop.screen)
      ? Option.some(driven.coop.screen.room)
      : Option.none(),
  )

const run = (
  start: Driven,
  ...each: ReadonlyArray<(driven: Driven) => Driven>
): Driven => Array.reduce(each, start, (driven, step) => step(driven))

// NOTE: the Input frames the SendRoomFrames issued carry.
const sentInputs = (driven: Driven): ReadonlyArray<InputFrame> =>
  Array.flatMap(argsIssued(SendRoomFrames)(driven), ({ frames }) =>
    Array.filter(
      frames,
      (frame): frame is InputFrame => frame._tag === 'Input',
    ),
  )

// NOTE: the room online in its run, as the root's messages leave it.
const live: Driven = run(
  drivenFrom(inRoomCoop(0)),
  byMessage(welcomeMessage(0, 1000)),
  byMessage(received(snapshotFrame(10), 1010)),
)

describe('predicted shots', () => {
  const TRIGGER = { ...NEUTRAL_INPUT, aimX: AIM_REACH, buttons: FIRE_BUTTON }

  // NOTE: the shots predicted over `frames` frames of 16 ms from `fromMs`,
  // each frame's count read as the drawing reads it, and co-op after.
  const shotsOver = (
    start: CoopModel,
    controls: typeof NEUTRAL_INPUT,
    fromMs: number,
    frames: number,
  ) =>
    Array.reduce(
      Array.range(1, frames),
      { current: drivenFrom(start), shots: 0 },
      ({ current, shots }, frame) => {
        const ticked = tickWith(fromMs + frame * 16, controls)(current)
        return {
          current: ticked,
          shots: shots + roomIn(ticked).predictedShots,
        }
      },
    )

  it.effect('holding the trigger fires at once, each shot counted once', () =>
    Effect.sync(() => {
      const held = shotsOver(live.coop, TRIGGER, 1010, 30)
      expect(held.shots).toBeGreaterThanOrEqual(3)
      expect(held.shots).toBeLessThanOrEqual(4)
      expect(
        Option.match(roomIn(held.current).session.predicted, {
          onNone: () => -1,
          onSome: own => own.player.recoilRemainingMs,
        }),
      ).toBeGreaterThanOrEqual(0)
      const corrected = byMessage(received(snapshotFrame(40), 1500))(
        held.current,
      )
      const after = shotsOver(corrected.coop, NEUTRAL_INPUT, 1500, 10)
      expect(after.shots).toBe(0)
    }),
  )

  it.effect('a released trigger fires nothing', () =>
    Effect.sync(() => {
      expect(shotsOver(live.coop, NEUTRAL_INPUT, 1010, 30).shots).toBe(0)
    }),
  )
})

describe('the room', () => {
  it.effect(
    'a dropped socket shows Away, and the rejoin snapshot brings the room back',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inRoom(0))
        s.pipe(
          online,
          checkModel(current => {
            expect(roomOf(current).link).toBe('Online')
            expect(roomOf(current).session.phase._tag).toBe('Playing')
          }),
          send(
            Message.ReceivedRoomEvent({
              event: RoomEvent.cases.Dropped.make({ reason: 'Socket ended' }),
              atMs: 2000,
            }),
          ),
          checkModel(current => {
            expect(roomOf(current).link).toBe('Reconnecting')
          }),
          send(
            Message.ReceivedRoomEvent({
              event: RoomEvent.cases.Connecting.make({ attempt: 0 }),
              atMs: 2300,
            }),
          ),
          checkModel(current => {
            expect(roomOf(current).link).toBe('Reconnecting')
          }),
          welcome(90, 2400),
          send(received(snapshotFrame(90), 2410)),
          checkModel(current => {
            expect(roomOf(current).link).toBe('Online')
          }),
        )
      }),
  )

  it.effect(
    "a run's network numbers count a reconnect and its pings, and a new run starts them afresh",
    () =>
      Effect.gen(function* () {
        const ponged = (sentMs: number, atMs: number) =>
          send(
            Message.ReceivedRoomEvent({
              event: RoomEvent.cases.Ponged.make({ sentMs, atMs }),
              atMs,
            }),
          )
        const connecting = (atMs: number) =>
          send(
            Message.ReceivedRoomEvent({
              event: RoomEvent.cases.Connecting.make({ attempt: 0 }),
              atMs,
            }),
          )
        const s = yield* storyOf(inRoom(0))
        s.pipe(
          online,
          ponged(1100, 1180),
          connecting(2000),
          welcome(90, 2400),
          send(received(snapshotFrame(90), 2410)),
          ponged(2500, 2560),
          checkModel(current => {
            const { net } = roomOf(current).session.stats
            expect(net.reconnects).toBe(1)
            expect(net.rtt.total).toBe(2)
          }),
          welcome(0, 9000),
          checkModel(current => {
            const { net } = roomOf(current).session.stats
            expect(net.reconnects).toBe(0)
            expect(net.rtt.total).toBe(0)
          }),
        )
      }),
  )

  it.effect(
    'a Delta that cannot apply asks for a new socket once, and its Snapshot brings the picture back',
    () =>
      Effect.gen(function* () {
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
        const s = yield* storyOf(inRoom(0))
        s.pipe(online, send(orphan(40))).resolve(ResyncRoom, Component.noop)
        s.pipe(
          checkModel(current => {
            expect(roomOf(current).session.isResyncing).toBe(true)
            expect(roomOf(current).session.stats.resyncs).toBe(1)
          }),
          send(orphan(43)),
        ).expectNone()
        s.pipe(
          send(received(snapshotFrame(60), 1300)),
          checkModel(current => {
            expect(roomOf(current).session.isResyncing).toBe(false)
            expect(
              Array.map(roomOf(current).session.frames, frame => frame.tick),
            ).toEqual([60])
          }),
        )
      }),
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
        Effect.gen(function* () {
          const s = yield* storyOf(inRoom(0))
          s.pipe(
            online,
            send(dropped(2000)),
            tickAt(3000),
            checkModel(ticked => {
              expect(roomOf(ticked).link).toBe('Reconnecting')
              expect(roomOf(ticked).droppedAtMs).toEqual(Option.some(3000))
            }),
            tickAt(22_900),
            checkModel(current => {
              expect(roomOf(current).link).toBe('Reconnecting')
            }),
            tickAt(23_000),
            checkModel(lost => {
              expect(roomOf(lost).link).toBe('Lost')
            }),
            // NOTE: the room answers again: back Online, the clock cleared.
            send(received(snapshotFrame(30), 24_000)),
            checkModel(back => {
              expect(roomOf(back).link).toBe('Online')
              expect(roomOf(back).droppedAtMs).toEqual(Option.none())
            }),
            framesSent,
          )
        }),
    )

    it.effect(
      'gives up past the rejoin window, back on the hub with LOST',
      () =>
        Effect.gen(function* () {
          const s = yield* storyOf(inRoom(0))
          s.pipe(
            online,
            send(dropped(2000)),
            tickAt(3000),
            tickAt(3000 + 135_000),
            checkModel(gone => {
              expect(gone.coop.screen).toEqual(
                Screen.Hub({ maybeProblem: Option.some('Dropped') }),
              )
            }),
            framesSent,
            resolveRememberRoom,
          )
        }),
    )
  })

  it.effect("a run's controls go to the room and the World comes back", () =>
    Effect.sync(() => {
      const walking = { ...NEUTRAL_INPUT, moveX: 127 }
      const first = tickWith(1200, walking)(live)
      expect(Option.isSome(roomIn(first).maybeWorld)).toBe(true)
      const second = tickWith(1400, walking)(first)
      expect(
        Array.some(sentInputs(second), input =>
          Array.some(input.samples, sample => sample.input.moveX === 127),
        ),
      ).toBe(true)
    }),
  )

  it.effect('a press rides the inputs as a held value, one at a time', () =>
    Effect.sync(() => {
      const world = stagedWorld([0, 1], []).world
      const heldOf = (driven: Driven) => roomIn(driven).presses.held
      const queued = run(
        live,
        pressSeat(SeatAction.Swap()),
        pressSeat(SeatAction.Ready()),
      )
      expect(roomIn(queued).presses.queued.length).toBe(2)
      const first = tickWith(1100, NEUTRAL_INPUT)(queued)
      expect(seatActionOf(world, heldOf(first))).toEqual(
        Option.some(SeatAction.Swap()),
      )
      const second = tickWith(1150, NEUTRAL_INPUT)(first)
      expect(heldOf(second)).not.toBe(heldOf(first))
      expect(seatActionOf(world, heldOf(second))).toEqual(
        Option.some(SeatAction.Ready()),
      )
      const third = tickWith(1300, NEUTRAL_INPUT)(second)
      // NOTE: both held presses rode the inputs the three frames sent.
      const actions = Array.flatMap(sentInputs(third), input =>
        Array.map(input.samples, sample =>
          seatActionOf(world, sample.input.action),
        ),
      )
      expect(actions).toContainEqual(Option.some(SeatAction.Swap()))
      expect(actions).toContainEqual(Option.some(SeatAction.Ready()))
    }),
  )

  it.effect(
    'a new run in the same room takes presses from its first tick, however late the last run pressed',
    () =>
      Effect.sync(() => {
        // NOTE: the first run: a press 60 seconds in, so its heldFrom is far out.
        const late = run(
          live,
          tickWith(61_000, NEUTRAL_INPUT),
          pressSeat(SeatAction.Reload()),
          tickWith(61_100, NEUTRAL_INPUT),
        )
        expect(roomIn(late).presses.held).not.toBe(0)
        // NOTE: the second run: the room says Welcome at tick 0 again.
        const again = run(
          late,
          byMessage(welcomeMessage(0, 70_000)),
          byMessage(received(snapshotFrame(0), 70_010)),
        )
        expect(roomIn(again).presses).toEqual(noPresses)
        const held = run(
          again,
          pressSeat(SeatAction.Ready()),
          ...Array.map(Array.range(1, 6), frame =>
            tickWith(70_100 + frame * 50, NEUTRAL_INPUT),
          ),
        )
        expect(roomIn(held).presses.held).toBe(
          heldAction(actionCodeOf(SeatAction.Ready()), 1),
        )
      }),
  )

  it.effect(
    'each event of the room reaches the drawing once, after any hit-stop',
    () =>
      Effect.sync(() => {
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
        const landed = run(
          drivenFrom(inRoomCoop(0)),
          byMessage(welcomeMessage(0, 1000)),
          byMessage(
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
          byMessage(
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
        )
        const { drawn } = Array.reduce(
          [1600, 1700, 1800, 1900, 2000],
          { current: landed, drawn: 0 },
          ({ current, drawn: sum }, nowMs) => {
            const ticked = tickWith(nowMs, NEUTRAL_INPUT, nowMs < 1750)(current)
            return {
              current: ticked,
              drawn: sum + roomIn(ticked).frameEvents.length,
            }
          },
        )
        expect(eventsIn).toBeGreaterThan(0)
        expect(drawn).toBe(eventsIn)
      }),
  )

  it.effect('a Kicked frame ends the room', () =>
    Effect.gen(function* () {
      const kicked = received({ _tag: 'Kicked' }, 500)
      expect(updateCoop(kicked)(inRoomCoop(1)).notice).toEqual(
        CoopNotice.LeftRoom(),
      )
      const s = yield* storyOf(inRoom(1))
      s.pipe(
        send(kicked),
        resolveRememberRoom,
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Hub({ maybeProblem: Option.some('Kicked') }),
          )
        }),
      )
    }),
  )

  it.effect('a room on a newer protocol sends the player to update', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(1))
      s.pipe(
        send(
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
        resolveRememberRoom,
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Hub({ maybeProblem: Option.some('Outdated') }),
          )
        }),
      ).resolve(
        FetchBuild,
        VersionMessage.FailedFetchBuild({ reason: 'offline' }),
      )
    }),
  )
})

// NOTE: element operations with no elements to reach, as on a server.
const NO_ELEMENTS: Context.Service.Shape<typeof Html.Host> = {
  focus: Function.constVoid,
  blur: Function.constVoid,
  scrollIntoView: Function.constVoid,
  measure: () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }),
  select: Function.constVoid,
  requestSubmit: Function.constFalse,
  showPicker: Function.constFalse,
}

describe('the network service', () => {
  it.effect(
    'RequestRoom runs against the service and reports its refusal',
    () =>
      Effect.gen(function* () {
        const fake = yield* makeFakeCoopNet(() => Effect.fail('Full'))
        // NOTE: a Command's body may read what the runtime provides as it
        // runs (Effect UI's framework services): none here, so the refs
        // find nothing, the cache is a fresh one, and no element is there.
        const handlers = yield* Layer.build(
          Layer.mergeAll(
            Layer.provide(RequestRoom.layer, fake.layer),
            Query.layer(),
            Layer.succeed(Renderer.Refs, {
              lookup: () => Effect.succeedNone,
            }),
            Layer.succeed(Html.Host, NO_ELEMENTS),
          ),
        )
        const request = Context.get(
          handlers,
          RequestRoom,
        )({
          request: RoomRequest.Join({ code: CODE }),
          name: 'Ana',
          look: 'Male.Curls.Black.Deep.Yellow',
          rank: 42,
          calling: 'Handyman',
          introSeen: true,
        })
        const result = yield* Effect.provideContext(request, handlers)
        expect(result).toEqual(
          CoopMessage.FailedRequestRoom({ problem: 'Full' }),
        )
        const calls = yield* fake.calls
        expect(calls).toEqual([
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
