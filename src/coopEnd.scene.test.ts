import { Option } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  first,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import {
  Command as StoryCommand,
  message,
  model,
  story,
  given as storyGiven,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect as expectValue, test } from 'vitest'

import type { LobbyMember } from '@munch/netcode'

import { RESTART_GRACE_MS } from './constants'
import { Message as CoopMessage } from './coop/message'
import { LobbyChange, Screen } from './coop/model'
import { freshRoom, maybeRoomOf } from './coop/roomState'
import { CODE, lobbyOf, memberOf, playingSession } from './coop/testing'
import {
  ChangeLobby,
  FocusCoopElement,
  LeaveRoom,
  RememberRoom,
} from './coop/update'
import { isRunCardHeld } from './endBeat'
import { update } from './main'
import { Message } from './message'
import { Lesson, type Model, Phase, initialModel } from './model'
import { DEFAULT_ROOM_SETTINGS, startRoomWorld } from './roomWorld'
import {
  ROOT,
  endButtons,
  measureSurface,
  shareMountEnded,
  shareMountSettles,
} from './testing'
import { asVeteran } from './veteran'

// An online co-op run's end card (src/menus.ts, src/update/end.ts): the
// tally stays sharp with no co-op scrim over it, and its buttons are the
// room's: LEAVE, RUN IT BACK (this player's READY, with the crew's heads),
// LOBBY, and SHARE.

const OWN_SLOT = 1

const onRoomCard = (
  phase: Phase,
  screenMs: number,
  members: ReadonlyArray<LobbyMember> = [
    memberOf(0, 'Ana', true),
    memberOf(OWN_SLOT, 'Bo'),
  ],
  mode: 'Campaign' | 'KeepGoing' = 'Campaign',
): Model =>
  modifyFields(asVeteran(initialModel), {
    lessons: lessons =>
      modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
    phase: () => phase,
    screenMs: () => screenMs,
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Screen.InRoom({
            room: {
              ...freshRoom(CODE, OWN_SLOT),
              maybePlayerId: Option.some(`player-${OWN_SLOT}`),
              maybeLobby: Option.some({ ...lobbyOf(members), mode }),
              link: 'Online',
            },
          }),
      }),
  })

const lost = onRoomCard(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)

const runItBack = role('button', { name: /^Run it back/ })
const lobbyButton = role('button', { name: /^Lobby/ })
const leaveButton = role('button', { name: 'Leave the room' })
const heads = all.selector('.end-button-head')
const litHeads = all.selector('.end-button-head[data-in="In"]')

const readyUp = (ready: boolean) =>
  StoryCommand.resolve(
    ChangeLobby({
      change: LobbyChange.ChangedReady({ ready, pingMs: 0 }),
    }),
    CoopMessage.CompletedChangeLobby(),
  )

describe("an online room's end card", () => {
  test('shows the tally with no scrim, and LEAVE, RUN IT BACK, LOBBY, SHARE', () => {
    scene(
      ROOT,
      given(lost),
      measureSurface,
      expect(selector('.coop[data-screen="RunCard"]')).toExist(),
      expect(selector('.coop-lobby')).toBeAbsent(),
      expect(selector('.coop-leave')).toBeAbsent(),
      expectAll(endButtons).toHaveCount(4),
      expect(first(endButtons)).toHaveText('LEAVEH'),
      expect(runItBack).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(runItBack).toHaveAttr('aria-pressed', 'false'),
      expect(runItBack).toHaveAccessibleName(
        'Run it back with this crew: 1 of 2 in',
      ),
      expectAll(heads).toHaveCount(2),
      expectAll(litHeads).toHaveCount(1),
      expect(lobbyButton).toHaveAttr('aria-keyshortcuts', 'L'),
      shareMountSettles('Cancelled'),
    )
  })

  test('RUN IT BACK readies this player in the room, and the heads light', () => {
    scene(
      ROOT,
      given(lost),
      measureSurface,
      shareMountSettles('Cancelled'),
      click(runItBack),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        CoopMessage.CompletedChangeLobby(),
      ),
    )
    const lobbyIn = onRoomCard(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS, [
      memberOf(0, 'Ana', true),
      memberOf(OWN_SLOT, 'Bo', true),
    ])
    scene(
      ROOT,
      given(lobbyIn),
      measureSurface,
      expect(runItBack).toHaveAttr('aria-pressed', 'true'),
      expectAll(litHeads).toHaveCount(2),
      shareMountSettles('Cancelled'),
    )
  })

  test('after a win the room keeps going, so the button says so', () => {
    scene(
      ROOT,
      given(
        onRoomCard(
          Phase.Victory(),
          RESTART_GRACE_MS,
          [memberOf(0, 'Ana'), memberOf(OWN_SLOT, 'Bo')],
          'KeepGoing',
        ),
      ),
      measureSurface,
      expect(role('button', { name: /^Keep going with this crew/ })).toHaveText(
        'KEEP GOINGENTER',
      ),
      shareMountSettles('Cancelled'),
    )
  })

  test('LOBBY lets the lobby in, and LEAVE leaves the room', () => {
    scene(
      ROOT,
      given(lost),
      measureSurface,
      shareMountSettles('Cancelled'),
      click(lobbyButton),
      shareMountEnded(),
      expect(selector('.coop[data-screen="Lobby"]')).toExist(),
      expect(runItBack).toBeAbsent(),
    )
    scene(
      ROOT,
      given(lost),
      measureSurface,
      shareMountSettles('Cancelled'),
      click(leaveButton),
      Command.resolve(LeaveRoom, CoopMessage.CompletedLeaveRoom()),
      Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      Command.resolve(
        FocusCoopElement,
        CoopMessage.CompletedFocusCoopElement(),
      ),
      expect(selector('.coop[data-screen="Hub"]')).toExist(),
    )
  })
})

describe("an online room's end card from keys and taps", () => {
  test('the card holds until the player picks, then L lets the lobby in', () => {
    const later = modifyFields(lost, { screenMs: () => 60_000 })
    expectValue(isRunCardHeld(later)).toBe(true)
    story(
      update,
      storyGiven(later),
      message(Message.PressedKey({ code: 'KeyL' })),
      model(current => {
        expectValue(isRunCardHeld(current)).toBe(false)
      }),
    )
  })

  test('Enter is RUN IT BACK, a second Enter takes it back', () => {
    story(
      update,
      storyGiven(lost),
      message(Message.PressedKey({ code: 'Enter' })),
      readyUp(true),
    )
    story(
      update,
      storyGiven(
        onRoomCard(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS, [
          memberOf(0, 'Ana'),
          memberOf(OWN_SLOT, 'Bo', true),
        ]),
      ),
      message(Message.ClickedRunItBackButton()),
      readyUp(false),
    )
  })

  test('before the grace a key only skips the beat', () => {
    story(
      update,
      storyGiven(onRoomCard(Phase.GameOver({ wave: 4 }), 0)),
      message(Message.PressedKey({ code: 'Enter' })),
      model(current => {
        expectValue(current.screenMs).toBeGreaterThan(0)
        expectValue(isRunCardHeld(current)).toBe(true)
      }),
    )
  })

  test('a tap on the game never drops the card', () => {
    const later = modifyFields(lost, { screenMs: () => 60_000 })
    expectValue(
      isRunCardHeld(update(later, Message.ClickedRunItBackButton()).model),
    ).toBe(true)
    story(
      update,
      storyGiven(later),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Touch',
          clientX: 100,
          clientY: 100,
        }),
      ),
      model(current => {
        expectValue(isRunCardHeld(current)).toBe(true)
      }),
    )
  })

  test('H leaves the room', () => {
    story(
      update,
      storyGiven(lost),
      message(Message.PressedKey({ code: 'KeyH' })),
      model(current => {
        expectValue(
          Option.map(maybeRoomOf(current.coop), room => room.departure),
        ).toEqual(Option.some('Leaving'))
      }),
      StoryCommand.resolve(LeaveRoom, CoopMessage.CompletedLeaveRoom()),
      StoryCommand.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      StoryCommand.resolve(
        FocusCoopElement,
        CoopMessage.CompletedFocusCoopElement(),
      ),
      model(current => {
        expectValue(current.coop.screen._tag).toBe('Hub')
      }),
    )
  })
})

describe("an online room's next run", () => {
  test('starts straight from the card once everyone is in', () => {
    const nextWorld = startRoomWorld([0, OWN_SLOT], 9, DEFAULT_ROOM_SETTINGS)
    const playing = modifyFields(lost, {
      isRunCardDropped: () => true,
      coop: coop =>
        modifyFields(coop, {
          screen: () =>
            Option.match(maybeRoomOf(coop), {
              onNone: () => coop.screen,
              onSome: room =>
                Screen.InRoom({
                  room: {
                    ...room,
                    maybeLobby: Option.some(
                      lobbyOf(
                        [memberOf(0, 'Ana'), memberOf(OWN_SLOT, 'Bo')],
                        'Playing',
                      ),
                    ),
                    session: playingSession(nextWorld, OWN_SLOT),
                  },
                }),
            }),
        }),
    })
    story(
      update,
      storyGiven(playing),
      message(Message.TickedRoomFrame({ nowMs: 100 })),
      model(current => {
        expectValue(current.phase._tag).toBe('Preparation')
        expectValue(current.isRunCardDropped).toBe(false)
      }),
    )
  })
})
