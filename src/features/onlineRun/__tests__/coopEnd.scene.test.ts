import { Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { describe, expect as expectValue, it } from '@effect/vitest'
import type { LobbyMember } from '@munch/netcode'

import { Message } from '../../../app/message'
import { Lesson, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { LobbyChange, Screen, maybeRoomOf } from '../../../domain/coopRoom'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  byClass,
  endButtons,
  expectAttr,
  firstOf,
  measureSurface,
  shareMountSettles,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type RootStep,
  checkModel,
  resolveFocusCoop,
  sceneOf,
  send,
  storyOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  DEFAULT_ROOM_SETTINGS,
  startRoomWorld,
} from '../../../world/net/roomWorld'
import { freshRoom } from '../../coop/roomState'
import { ChangeLobby } from '../../coop/steps'
import { CODE, lobbyOf, memberOf, playingSession } from '../../coop/testing'
import { LeaveRoom, RememberRoom } from '../../coop/update'
import { isRunCardHeld } from '../../end/endBeat'
import { coopScreen } from './onlineRun.fixture'

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
  UiStruct.evolve(asVeteran(initialModel), {
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        openBreak: () => Lesson.Learned({ atMs: 0 }),
      }),
    phase: () => phase,
    screenMs: () => screenMs,
    coop: coop =>
      UiStruct.evolve(coop, {
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

const playAgain = HtmlLocator.role('button', { name: /^Play again/ })
const lobbyButton = HtmlLocator.role('button', { name: /^Lobby/ })
const leaveButton = HtmlLocator.role('button', { name: 'Leave the room' })
const heads = byClass('end-button-head')
const litHeads = withAttrs({ 'data-in': 'In' })(heads)

const readyUp =
  (ready: boolean): RootStep =>
  s =>
    s.resolve(
      ChangeLobby.make({
        change: LobbyChange.ChangedReady({ ready, pingMs: 0 }),
      }),
      Component.noop,
    )

// NOTE: LEAVE done: co-op remembers no room and focuses its hub.
const leaveDone: RootStep = s =>
  resolveFocusCoop(
    s
      .resolve(LeaveRoom, Message.CompletedLeaveRoom())
      .resolve(RememberRoom, Component.noop),
  )

describe("an online room's end card", () => {
  it.effect(
    'shows the tally with no scrim, and LEAVE, PLAY AGAIN, LOBBY, SHARE',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(lost)
        s.pipe(
          measureSurface,
          shareMountSettles('Cancelled'),
          expectAttr(playAgain, 'aria-keyshortcuts', 'Enter'),
          expectAttr(playAgain, 'aria-pressed', 'false'),
          expectAttr(lobbyButton, 'aria-keyshortcuts', 'L'),
        )
          .expect(coopScreen('RunCard'))
          .toExist()
          .expect(byClass('coop-lobby'))
          .toBeAbsent()
          .expect(byClass('coop-leave'))
          .toBeAbsent()
          .expect(endButtons)
          .toHaveCount(4)
          .expect(firstOf(endButtons))
          .toHaveText('LEAVEH')
          .expect(playAgain)
          .toHaveAccessibleName('Play again with this crew: 1 of 2 in')
          .expect(heads)
          .toHaveCount(2)
          .expect(litHeads)
          .toHaveCount(1)
      }),
  )

  it.effect(
    'PLAY AGAIN readies this player in the room, and the heads light',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(lost)
        s.pipe(measureSurface, shareMountSettles('Cancelled'))
          .click(playAgain)
          .pipe(readyUp(true))
        const lobbyIn = onRoomCard(
          Phase.GameOver({ wave: 4 }),
          RESTART_GRACE_MS,
          [memberOf(0, 'Ana', true), memberOf(OWN_SLOT, 'Bo', true)],
        )
        const after = yield* sceneOf(lobbyIn)
        after
          .pipe(
            measureSurface,
            shareMountSettles('Cancelled'),
            expectAttr(playAgain, 'aria-pressed', 'true'),
          )
          .expect(litHeads)
          .toHaveCount(2)
      }),
  )

  it.effect('after a win the room keeps going, so the button says so', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        onRoomCard(
          Phase.Escaped({ wave: 10 }),
          RESTART_GRACE_MS,
          [memberOf(0, 'Ana'), memberOf(OWN_SLOT, 'Bo')],
          'KeepGoing',
        ),
      )
      s.pipe(measureSurface, shareMountSettles('Cancelled'))
        .expect(
          HtmlLocator.role('button', { name: /^Keep going with this crew/ }),
        )
        .toHaveText('KEEP GOINGENTER')
    }),
  )

  it.effect('LOBBY lets the lobby in, and LEAVE leaves the room', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(lost)
      s.pipe(measureSurface, shareMountSettles('Cancelled'))
        .click(lobbyButton)
        .expect(coopScreen('Lobby'))
        .toExist()
        .expect(playAgain)
        .toBeAbsent()
      const leaving = yield* sceneOf(lost)
      leaving
        .pipe(measureSurface, shareMountSettles('Cancelled'))
        .click(leaveButton)
        .pipe(leaveDone)
        .expect(coopScreen('Hub'))
        .toExist()
    }),
  )
})

describe("an online room's end card from keys and taps", () => {
  it.effect(
    'the card holds until the player picks, then L lets the lobby in',
    () =>
      Effect.gen(function* () {
        const later = UiStruct.evolve(lost, { screenMs: () => 60_000 })
        expectValue(isRunCardHeld(later)).toBe(true)
        const s = yield* storyOf(later)
        s.pipe(
          send(Message.PressedKey({ code: 'KeyL' })),
          checkModel(current => {
            expectValue(isRunCardHeld(current)).toBe(false)
          }),
        )
      }),
  )

  it.effect('Enter is PLAY AGAIN, a second Enter takes it back', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(lost)
      s.pipe(send(Message.PressedKey({ code: 'Enter' })), readyUp(true))
      const ready = yield* storyOf(
        onRoomCard(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS, [
          memberOf(0, 'Ana'),
          memberOf(OWN_SLOT, 'Bo', true),
        ]),
      )
      ready.pipe(send(Message.ClickedPlayAgainButton()), readyUp(false))
    }),
  )

  it.effect('before the grace a key only skips the beat', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onRoomCard(Phase.GameOver({ wave: 4 }), 0))
      s.pipe(
        send(Message.PressedKey({ code: 'Enter' })),
        checkModel(current => {
          expectValue(current.screenMs).toBeGreaterThan(0)
          expectValue(isRunCardHeld(current)).toBe(true)
        }),
      )
    }),
  )

  it.effect('a tap on the game never drops the card', () =>
    Effect.gen(function* () {
      const later = UiStruct.evolve(lost, { screenMs: () => 60_000 })
      const s = yield* storyOf(later)
      s.pipe(
        send(Message.ClickedPlayAgainButton()),
        readyUp(true),
        checkModel(current => {
          expectValue(isRunCardHeld(current)).toBe(true)
        }),
      )
      const tapped = yield* storyOf(later)
      tapped.pipe(
        send(
          Message.PressedPointer({
            pointerId: 1,
            device: 'Touch',
            clientX: 100,
            clientY: 100,
          }),
        ),
        checkModel(current => {
          expectValue(isRunCardHeld(current)).toBe(true)
        }),
      )
    }),
  )

  it.effect('H leaves the room', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(lost)
      s.pipe(
        send(Message.PressedKey({ code: 'KeyH' })),
        checkModel(current => {
          expectValue(
            Option.map(maybeRoomOf(current.coop), room => room.departure),
          ).toEqual(Option.some('Leaving'))
        }),
        leaveDone,
        checkModel(current => {
          expectValue(current.coop.screen._tag).toBe('Hub')
        }),
      )
    }),
  )
})

describe("an online room's next run", () => {
  it.effect('starts straight from the card once everyone is in', () =>
    Effect.gen(function* () {
      const nextWorld = startRoomWorld([0, OWN_SLOT], 9, DEFAULT_ROOM_SETTINGS)
      const playing = UiStruct.evolve(lost, {
        coop: coop =>
          UiStruct.evolve(coop, {
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
        endCard: UiStruct.evolve({ isRunCardDropped: () => true }),
      })
      const s = yield* storyOf(playing)
      s.pipe(
        send(Message.TickedRoomFrame({ nowMs: 100 })),
        checkModel(current => {
          expectValue(current.phase._tag).toBe('Arriving')
          expectValue(current.endCard.isRunCardDropped).toBe(false)
        }),
      )
    }),
  )
})
