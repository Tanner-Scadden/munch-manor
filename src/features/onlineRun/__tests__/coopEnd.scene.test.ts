import { Effect, Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect as expectValue, it } from '@effect/vitest'
import type { LobbyMember } from '@munch/netcode'

import { Message } from '../../../app/message'
import { Lesson, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { LobbyChange, Screen, maybeRoomOf } from '../../../domain/coopRoom'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  APPLICATION,
  endButtons,
  measureSurface,
  shareMountEnded,
  shareMountSettles,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  DEFAULT_ROOM_SETTINGS,
  startRoomWorld,
} from '../../../world/net/roomWorld'
import { Message as CoopMessage } from '../../coop/message'
import { freshRoom } from '../../coop/roomState'
import { ChangeLobby, FocusCoopElement } from '../../coop/steps'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { LeaveRoom, RememberRoom } from '../../coop/update'
import { isRunCardHeld } from '../../end/endBeat'

// An online co-op run's end card (src/screens/game/menus.ts, src/app/update/end.ts): the
// tally stays sharp with no co-op scrim over it, and its buttons are the
// room's: LEAVE, PLAY AGAIN (this player's READY, with the crew's heads),
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

const playAgain = Scene.role('button', { name: /^Play again/ })
const lobbyButton = Scene.role('button', { name: /^Lobby/ })
const leaveButton = Scene.role('button', { name: 'Leave the room' })
const heads = Scene.all.selector('.end-button-head')
const litHeads = Scene.all.selector('.end-button-head[data-in="In"]')

const readyUp = (ready: boolean) =>
  Story.Command.resolve(
    ChangeLobby({
      change: LobbyChange.ChangedReady({ ready, pingMs: 0 }),
    }),
    CoopMessage.CompletedChangeLobby(),
  )

describe("an online room's end card", () => {
  it.effect(
    'shows the tally with no scrim, and LEAVE, PLAY AGAIN, LOBBY, SHARE',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(lost),
        measureSurface,
        Scene.expect(Scene.selector('.coop[data-screen="RunCard"]')).toExist(),
        Scene.expect(Scene.selector('.coop-lobby')).toBeAbsent(),
        Scene.expect(Scene.selector('.coop-leave')).toBeAbsent(),
        Scene.expectAll(endButtons).toHaveCount(4),
        Scene.expect(Scene.first(endButtons)).toHaveText('LEAVEH'),
        Scene.expect(playAgain).toHaveAttr('aria-keyshortcuts', 'Enter'),
        Scene.expect(playAgain).toHaveAttr('aria-pressed', 'false'),
        Scene.expect(playAgain).toHaveAccessibleName(
          'Play again with this crew: 1 of 2 in',
        ),
        Scene.expectAll(heads).toHaveCount(2),
        Scene.expectAll(litHeads).toHaveCount(1),
        Scene.expect(lobbyButton).toHaveAttr('aria-keyshortcuts', 'L'),
        shareMountSettles('Cancelled'),
      ),
  )

  it.effect(
    'PLAY AGAIN readies this player in the room, and the heads light',
    () =>
      Effect.gen(function* () {
        yield* Scene.scene(
          APPLICATION,
          Scene.given(lost),
          measureSurface,
          shareMountSettles('Cancelled'),
          Scene.click(playAgain),
          Scene.Command.resolve(
            ChangeLobby({
              change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
            }),
            CoopMessage.CompletedChangeLobby(),
          ),
        )
        const lobbyIn = onRoomCard(
          Phase.GameOver({ wave: 4 }),
          RESTART_GRACE_MS,
          [memberOf(0, 'Ana', true), memberOf(OWN_SLOT, 'Bo', true)],
        )
        yield* Scene.scene(
          APPLICATION,
          Scene.given(lobbyIn),
          measureSurface,
          Scene.expect(playAgain).toHaveAttr('aria-pressed', 'true'),
          Scene.expectAll(litHeads).toHaveCount(2),
          shareMountSettles('Cancelled'),
        )
      }),
  )

  it.effect('after a win the room keeps going, so the button says so', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        onRoomCard(
          Phase.Escaped({ wave: 10 }),
          RESTART_GRACE_MS,
          [memberOf(0, 'Ana'), memberOf(OWN_SLOT, 'Bo')],
          'KeepGoing',
        ),
      ),
      measureSurface,
      Scene.expect(
        Scene.role('button', { name: /^Keep going with this crew/ }),
      ).toHaveText('KEEP GOINGENTER'),
      shareMountSettles('Cancelled'),
    ),
  )

  it.effect('LOBBY lets the lobby in, and LEAVE leaves the room', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(lost),
        measureSurface,
        shareMountSettles('Cancelled'),
        Scene.click(lobbyButton),
        shareMountEnded(),
        Scene.expect(Scene.selector('.coop[data-screen="Lobby"]')).toExist(),
        Scene.expect(playAgain).toBeAbsent(),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(lost),
        measureSurface,
        shareMountSettles('Cancelled'),
        Scene.click(leaveButton),
        Scene.Command.resolve(LeaveRoom, CoopMessage.CompletedLeaveRoom()),
        Scene.Command.resolve(
          RememberRoom,
          CoopMessage.CompletedRememberRoom(),
        ),
        Scene.Command.resolve(
          FocusCoopElement,
          CoopMessage.CompletedFocusCoopElement(),
        ),
        Scene.expect(Scene.selector('.coop[data-screen="Hub"]')).toExist(),
      )
    }),
  )
})

describe("an online room's end card from keys and taps", () => {
  it.effect(
    'the card holds until the player picks, then L lets the lobby in',
    () => {
      const later = modifyFields(lost, { screenMs: () => 60_000 })
      expectValue(isRunCardHeld(later)).toBe(true)
      return Story.story(
        APPLICATION,
        Story.given(later),
        Story.message(Message.PressedKey({ code: 'KeyL' })),
        Story.model(current => {
          expectValue(isRunCardHeld(current)).toBe(false)
        }),
      )
    },
  )

  it.effect('Enter is PLAY AGAIN, a second Enter takes it back', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(lost),
        Story.message(Message.PressedKey({ code: 'Enter' })),
        readyUp(true),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(
          onRoomCard(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS, [
            memberOf(0, 'Ana'),
            memberOf(OWN_SLOT, 'Bo', true),
          ]),
        ),
        Story.message(Message.ClickedPlayAgainButton()),
        readyUp(false),
      )
    }),
  )

  it.effect('before the grace a key only skips the beat', () =>
    Story.story(
      APPLICATION,
      Story.given(onRoomCard(Phase.GameOver({ wave: 4 }), 0)),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.model(current => {
        expectValue(current.screenMs).toBeGreaterThan(0)
        expectValue(isRunCardHeld(current)).toBe(true)
      }),
    ),
  )

  it.effect('a tap on the game never drops the card', () => {
    const later = modifyFields(lost, { screenMs: () => 60_000 })
    return Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(later),
        Story.message(Message.ClickedPlayAgainButton()),
        readyUp(true),
        Story.model(current => {
          expectValue(isRunCardHeld(current)).toBe(true)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(later),
        Story.message(
          Message.PressedPointer({
            pointerId: 1,
            device: 'Touch',
            clientX: 100,
            clientY: 100,
          }),
        ),
        Story.model(current => {
          expectValue(isRunCardHeld(current)).toBe(true)
        }),
      )
    })
  })

  it.effect('H leaves the room', () =>
    Story.story(
      APPLICATION,
      Story.given(lost),
      Story.message(Message.PressedKey({ code: 'KeyH' })),
      Story.model(current => {
        expectValue(
          Option.map(maybeRoomOf(current.coop), room => room.departure),
        ).toEqual(Option.some('Leaving'))
      }),
      Story.Command.resolve(LeaveRoom, CoopMessage.CompletedLeaveRoom()),
      Story.Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      Story.Command.resolve(
        FocusCoopElement,
        CoopMessage.CompletedFocusCoopElement(),
      ),
      Story.model(current => {
        expectValue(current.coop.screen._tag).toBe('Hub')
      }),
    ),
  )
})

describe("an online room's next run", () => {
  it.effect('starts straight from the card once everyone is in', () => {
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
    return Story.story(
      APPLICATION,
      Story.given(playing),
      Story.message(Message.TickedRoomFrame({ nowMs: 100 })),
      Story.model(current => {
        expectValue(current.phase._tag).toBe('Arriving')
        expectValue(current.isRunCardDropped).toBe(false)
      }),
    )
  })
})
