import { Option } from 'effect'
import {
  Command,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  type,
  withViewInputs,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { defaultAppearance } from '../model'
import { type Appearance, lookCodeOf } from '../playerData'
import { badgeImage } from '../rankArt'
import { portraitOf } from './icons'
import { seatLook } from './looks'
import { Message } from './message'
import {
  LobbyChange,
  type Model,
  type Room,
  RoomRequest,
  Screen,
  emptyQueue,
  initialModel,
} from './model'
import { freshRoom } from './roomState'
import { CODE, lobbyOf, memberOf, playingSession, stagedWorld } from './testing'
import {
  AnswerOffer,
  CancelQuickPlay,
  ChangeLobby,
  CopyRoomCode,
  FocusCoopElement,
  LeaveRoom,
  RememberRoom,
  RequestRoom,
  ShareRoomLink,
  update,
} from './update'
import { view as coopView } from './view'

const view = withViewInputs(coopView, {
  look: defaultAppearance,
  isKeyboard: false,
  isRunCardUp: false,
})()

const at = (screen: Screen): Model =>
  modifyFields(initialModel, { screen: () => screen })

const onHub = at(Screen.Hub({ maybeProblem: Option.none() }))

const roomWith = (overrides: Partial<Room>): Model =>
  at(Screen.InRoom({ room: { ...freshRoom(CODE, 0), ...overrides } }))

const lobbyRoom = (members: ReadonlyArray<ReturnType<typeof memberOf>>) =>
  roomWith({
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members)),
    link: 'Online',
  })

const quickPlayButton = role('button', {
  name: 'Quick play: join players anywhere',
})

describe('the hub', () => {
  test('QUICK PLAY, CODE, and NEW ROOM are the three ways in', () => {
    scene(
      { update, view },
      given(onHub),
      expect(quickPlayButton).toExist(),
      expect(role('button', { name: 'Join a friend with a code' })).toExist(),
      expect(role('button', { name: 'Make a room for friends' })).toExist(),
      click(quickPlayButton),
      expect(selector('[data-screen="Queue"]')).toExist(),
    )
  })

  test('a problem shows as an alert', () => {
    scene(
      { update, view },
      given(at(Screen.Hub({ maybeProblem: Option.some('Kicked') }))),
      expect(role('alert', { name: 'The host kicked you.' })).toExist(),
    )
  })

  test('NEW ROOM asks for a room', () => {
    scene(
      { update, view },
      given(onHub),
      click(role('button', { name: 'Make a room for friends' })),
      expect(role('status', { name: 'Finding the room' })).toExist(),
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
      Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      expect(role('button', { name: 'Share the room link' })).toExist(),
    )
  })
})

describe('the code', () => {
  test('five symbols typed into the slots join that room', () => {
    scene(
      { update, view },
      given(at(Screen.Code({ typed: '', maybeProblem: Option.none() }))),
      expect(role('button', { name: 'Join' })).toBeDisabled(),
      type(role('textbox', { name: 'Room code' }), 'mnch'),
      expect(role('button', { name: 'Join' })).toBeDisabled(),
      type(role('textbox', { name: 'Room code' }), 'mnch7'),
      Command.resolve(
        RequestRoom({
          request: RoomRequest.Join({ code: CODE }),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
        }),
        Message.FailedRequestRoom({ problem: 'Full' }),
      ),
      Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      expect(role('alert', { name: 'That room is full.' })).toExist(),
    )
  })

  test('back returns to the hub', () => {
    scene(
      { update, view },
      given(at(Screen.Code({ typed: 'AB', maybeProblem: Option.none() }))),
      click(role('button', { name: 'Back' })),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      expect(quickPlayButton).toExist(),
    )
  })
})

describe('the queue', () => {
  test('heads fill the seats and the offer starts with fewer', () => {
    scene(
      { update, view },
      given(
        at(
          Screen.Queue({
            queue: {
              ...emptyQueue,
              names: ['Ana', 'Bo', 'Cy'],
              waiting: 3,
              position: 1,
              offerPlayers: 3,
              accepted: 1,
            },
          }),
        ),
      ),
      expect(role('list', { name: '3 of 4 players here' })).toExist(),
      click(role('button', { name: 'Start with 3 players. 1 said yes' })),
      Command.resolve(
        AnswerOffer({ accept: true }),
        Message.CompletedAnswerOffer(),
      ),
      expect(role('button', { name: 'Keep waiting for four' })).not.toExist(),
      click(role('button', { name: 'Stop looking' })),
      Command.resolve(CancelQuickPlay, Message.CompletedCancelQuickPlay()),
      expect(quickPlayButton).toExist(),
    )
  })
})

describe('the lobby', () => {
  test('seats show names, the host crown, and READY stamps', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
      expect(role('listitem', { name: 'Ana, you, host' })).toExist(),
      expect(role('listitem', { name: 'Bo, ready' })).toExist(),
      expect(role('listitem', { name: 'Empty seat' })).toExist(),
      expect(role('button', { name: 'Kick Bo' })).toExist(),
      click(role('button', { name: 'READY' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        Message.CompletedChangeLobby(),
      ),
      click(role('button', { name: 'Kick Bo' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.KickedPlayer({ playerId: 'player-1' }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('the host taps a mode and a skull; Nightmare stays padlocked', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')])),
      expect(role('group', { name: 'Mode' })).toExist(),
      expect(role('button', { name: 'Campaign' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      expect(role('button', { name: 'Keep going' })).not.toExist(),
      expect(role('button', { name: 'Nightmare, locked' })).toHaveAttr(
        'aria-disabled',
        'true',
      ),
      click(role('button', { name: 'Endless' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedPicks({
            mode: 'Endless',
            difficulty: 'Normal',
          }),
        }),
        Message.CompletedChangeLobby(),
      ),
      click(role('button', { name: 'Hard' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedPicks({
            mode: 'Campaign',
            difficulty: 'Hard',
          }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('a guest sees the picks as icons, and KEEP GOING after a win', () => {
    scene(
      { update, view },
      given(
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some({
            ...lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
            mode: 'KeepGoing',
            canKeepGoing: true,
            difficulty: 'Hard',
          }),
        }),
      ),
      expect(selector('[aria-label="Keep going, Hard"]')).toExist(),
      expect(role('button', { name: 'Keep going' })).toHaveAttr(
        'aria-disabled',
        'true',
      ),
      expect(role('button', { name: 'Hard' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
    )
  })

  test('each seat wears the look its player sent, or its seat look', () => {
    const sent: Appearance = {
      body: 'Broad',
      hairStyle: 'Long',
      hairColor: 'Pink',
      skinTone: 'Fair',
      shirtColor: 'Purple',
      outfit: 'Dress',
      print: 'Stripes',
      beard: true,
      glasses: true,
    }
    scene(
      { update, view },
      given(
        lobbyRoom([
          memberOf(0, 'Ana'),
          memberOf(1, 'Bo', false, lookCodeOf(sent)),
          memberOf(2, 'Cy', false, 'Robot.Chrome'),
        ]),
      ),
      expect(selector('[aria-label="Bo"] .coop-seat-head')).toHaveStyle(
        'background-image',
        portraitOf(sent),
      ),
      expect(selector('[aria-label="Cy"] .coop-seat-head')).toHaveStyle(
        'background-image',
        portraitOf(seatLook(2)),
      ),
      expect(
        selector('[aria-label="Ana, you, host"] .coop-seat-head'),
      ).toHaveStyle('background-image', portraitOf(defaultAppearance)),
    )
  })

  test("each seat shows its player's rank badge and number beside the name", () => {
    const woodSrc = Option.getOrThrow(badgeImage('Wood')).src
    const silverSrc = Option.getOrThrow(badgeImage('Silver')).src
    scene(
      { update, view },
      given(
        lobbyRoom([
          memberOf(0, 'Ana'),
          memberOf(1, 'Bo', false, '', false, 12),
          memberOf(2, 'Cy', false, '', false, 33),
          memberOf(3, 'Dee', false, '', false, 999),
        ]),
      ),
      expect(selector('[aria-label="Ana, you, host"] .coop-rank')).toHaveText(
        '1',
      ),
      expect(selector('[aria-label="Bo"] .coop-rank')).toHaveText('12'),
      expect(selector('[aria-label="Dee"] .coop-rank')).toHaveText('999'),
      expect(
        selector('[aria-label="Ana, you, host"] .coop-rank img'),
      ).toHaveAttr('src', woodSrc),
      expect(selector('[aria-label="Cy"] .coop-rank')).toHaveAttr(
        'data-tier',
        'Silver',
      ),
      expect(selector('[aria-label="Cy"] .coop-rank img')).toHaveAttr(
        'src',
        silverSrc,
      ),
    )
  })

  test('each seat shows its link as bars, yours from your own pings', () => {
    const room = {
      ...freshRoom(CODE, 0),
      maybePlayerId: Option.some('player-0'),
      maybeLobby: Option.some(
        lobbyOf([
          { ...memberOf(0, 'Ana'), pingMs: 300 },
          { ...memberOf(1, 'Bo'), pingMs: 150 },
          memberOf(2, 'Cy'),
        ]),
      ),
      link: 'Online' as const,
    }
    scene(
      { update, view },
      given(
        at(
          Screen.InRoom({
            room: { ...room, session: { ...room.session, rttMs: 42 } },
          }),
        ),
      ),
      expect(role('img', { name: '42 ms' })).toHaveAttr('data-ping', 'Good'),
      expect(role('img', { name: '150 ms' })).toHaveAttr('data-ping', 'Ok'),
      expect(role('img', { name: '300 ms' })).not.toExist(),
      expect(selector('[aria-label="Cy"] .coop-ping')).not.toExist(),
    )
  })

  test('a guest sees no kick', () => {
    scene(
      { update, view },
      given(
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some(
            lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
          ),
        }),
      ),
      expect(role('button', { name: 'Kick Ana' })).not.toExist(),
    )
  })

  test('share and leave', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana')])),
      expect(
        role('button', { name: 'Room code M N C H 7, tap to copy' }),
      ).toExist(),
      click(role('button', { name: 'Share the room link' })),
      Command.resolve(
        ShareRoomLink({ code: CODE }),
        Message.CompletedShareRoomLink({ share: 'Copied' }),
      ),
      expect(role('button', { name: 'Link copied' })).toExist(),
      click(role('button', { name: 'Leave the room' })),
      expect(role('button', { name: 'Leave the room' })).toBeDisabled(),
      Command.resolve(LeaveRoom, Message.CompletedLeaveRoom()),
      Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      expect(quickPlayButton).toExist(),
    )
  })
})

describe('the room code', () => {
  const codeButton = role('button', { name: /^Room code M N C H 7/ })

  test('a tap copies it, and COPIED! flashes afresh for each copy', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana')])),
      expect(selector('.coop-room-code-copied')).toBeAbsent(),
      click(codeButton),
      Command.resolve(
        CopyRoomCode({ code: CODE }),
        Message.CompletedCopyRoomCode({ copy: 'Copied' }),
      ),
      expect(selector('.coop-room-code-copied')).toHaveText('COPIED!'),
      expect(codeButton).toHaveAccessibleName('Room code M N C H 7, copied'),
      click(codeButton),
      Command.resolve(
        CopyRoomCode({ code: CODE }),
        Message.CompletedCopyRoomCode({ copy: 'Copied' }),
      ),
      expect(selector('.coop-room-code-copied')).toHaveText('COPIED!'),
    )
  })

  test('a clipboard that refuses shows nothing', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana')])),
      click(codeButton),
      Command.resolve(
        CopyRoomCode({ code: CODE }),
        Message.CompletedCopyRoomCode({ copy: 'Failed' }),
      ),
      expect(selector('.coop-room-code-copied')).toBeAbsent(),
    )
  })
})

describe('the arena', () => {
  const world = stagedWorld([0, 1])
  const playing = (overrides: Partial<Room> = {}) =>
    roomWith({
      maybePlayerId: Option.some('player-0'),
      maybeLobby: Option.some(
        lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')], 'Playing'),
      ),
      link: 'Online',
      session: playingSession(world, 0),
      maybeWorld: Option.some(world),
      ...overrides,
    })

  test('the game shows through, with a leave button and the link numbers', () => {
    scene(
      { update, view },
      given(playing()),
      expect(selector('.coop[data-screen="Arena"]')).toExist(),
      expect(selector('canvas')).not.toExist(),
      expect(selector('.coop-net[data-slot="0"]')).toExist(),
      expect(role('button', { name: 'Leave the room' })).toExist(),
    )
  })

  test('a dropped link shows Away', () => {
    scene(
      { update, view },
      given(playing({ link: 'Reconnecting' })),
      expect(role('status', { name: 'Reconnecting' })).toExist(),
    )
  })

  test('the lobby waits behind the run end card, drawing nothing over it, then crowns the MVP', () => {
    const back = modifyFields(initialModel, {
      screen: () =>
        Screen.InRoom({
          room: {
            ...freshRoom(CODE, 0),
            maybeLobby: Option.some({
              ...lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
              result: Option.some({
                round: 1,
                reason: 'GameOver' as const,
                ticks: 600,
                scores: [
                  { playerId: 'player-0', slot: 0, score: 3 },
                  { playerId: 'player-1', slot: 1, score: 9 },
                ],
              }),
            }),
          },
        }),
    })
    const heldView = withViewInputs(coopView, {
      look: defaultAppearance,
      isKeyboard: false,
      isRunCardUp: true,
    })()
    scene(
      { update, view: heldView },
      given(back),
      expect(selector('#coop-ready')).toBeAbsent(),
      expect(role('listitem', { name: 'Bo: 9, MVP' })).toBeAbsent(),
      expect(role('button', { name: /^Leave/ })).toBeAbsent(),
      expect(selector('.coop[data-screen="RunCard"]')).toExist(),
    )
    scene(
      { update, view },
      given(back),
      expect(role('listitem', { name: 'Bo: 9, MVP' })).toExist(),
      expect(role('listitem', { name: 'Ana: 3' })).toExist(),
      expect(selector('.coop-result-crown')).toExist(),
      expect(selector('[aria-label="Bo: 9, MVP"] .coop-result-rank')).toExist(),
    )
  })
})
