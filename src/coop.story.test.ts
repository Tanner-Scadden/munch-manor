import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { CoopBinding } from './bindings'
import { Message as CoopMessage } from './coop/message'
import { LobbyChange, RoomRequest, Screen } from './coop/model'
import { freshRoom } from './coop/roomState'
import { CODE, lobbyOf, memberOf } from './coop/testing'
import {
  ChangeLobby,
  FocusCoopElement,
  RememberRoom,
  RequestRoom,
} from './coop/update'
import { update } from './main'
import { Message } from './message'
import { Lesson, type Model } from './model'
import { home } from './model.fixture'
import { type Appearance, lookCodeOf } from './playerData'
import { noRank, pointsForRank } from './rank'
import { FocusHomeButton } from './update/home'

const graduate = (current: Model): Model =>
  modifyFields(current, {
    lessons: lessons =>
      modifyFields(lessons, {
        openBreak: () => Lesson.Learned({ atMs: 0 }),
      }),
  })

const graduated = graduate(home)

const PICKED_LOOK: Appearance = {
  body: 'Slim',
  hairStyle: 'Ponytail',
  hairColor: 'Pink',
  skinTone: 'Tan',
  shirtColor: 'Purple',
  outfit: 'Dress',
  print: 'Rainbow',
  beard: true,
  glasses: false,
  hat: 'None',
  gunSkin: 'Stock',
}

const resolveFocusCoop = () =>
  Command.resolve(FocusCoopElement, CoopMessage.CompletedFocusCoopElement())

describe('co-op from home', () => {
  test('J and the CO-OP tile stay shut until the tutorial is done', () => {
    story(
      update,
      given(home),
      message(Message.PressedKey({ code: 'KeyJ' })),
      message(Message.ClickedCoopButton()),
      model(current => {
        expect(current.coop.screen._tag).toBe('Closed')
      }),
    )
  })

  test('J opens the hub, Escape closes it and lands back on the tile', () => {
    story(
      update,
      given(graduated),
      message(Message.PressedKey({ code: 'KeyJ' })),
      resolveFocusCoop(),
      model(current => {
        expect(current.coop.screen._tag).toBe('Hub')
      }),
      message(Message.PressedKey({ code: 'KeyE' })),
      model(current => {
        expect(current.home.mode).toBe('Campaign')
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      Command.resolve(
        FocusHomeButton({ button: 'Coop' }),
        Message.CompletedFocusHomeButton(),
      ),
      model(current => {
        expect(current.coop.screen._tag).toBe('Closed')
      }),
    )
  })

  test('a room link joins that room once the splash is gone', () => {
    story(
      update,
      given(graduated),
      message(Message.CompletedReadRoomLink({ maybeCode: Option.some(CODE) })),
      model(current => {
        expect(current.coop.screen).toEqual(
          Screen.Asking({ request: RoomRequest.Join({ code: CODE }) }),
        )
      }),
      Command.resolve(
        RequestRoom({
          request: RoomRequest.Join({ code: CODE }),
          name: '',
          look: lookCodeOf(graduated.appearance),
          rank: 1,
          calling: 'You',
        }),
        CoopMessage.FailedRequestRoom({ problem: 'NoRoom' }),
      ),
      Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      model(current => {
        expect(current.coop.screen._tag).toBe('Code')
      }),
    )
  })

  test('the saved display name, look, and rank go with the room request', () => {
    story(
      update,
      given(
        modifyFields(graduated, {
          playerName: () => 'Snackula',
          appearance: () => PICKED_LOOK,
          rank: () => ({ ...noRank, earnedPoints: pointsForRank(12) }),
        }),
      ),
      message(Message.ClickedCoopButton()),
      resolveFocusCoop(),
      message(toParentMessage(CoopBinding, CoopMessage.ClickedCreateButton())),
      Command.resolve(
        RequestRoom({
          request: RoomRequest.Create(),
          name: 'Snackula',
          look: 'Slim.Ponytail.Pink.Tan.Purple.CCBA',
          rank: 12,
          calling: 'You',
        }),
        CoopMessage.FailedRequestRoom({ problem: 'Offline' }),
      ),
      model(current => {
        expect(current.coop.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Offline') }),
        )
      }),
    )
  })

  test('Enter in the lobby is READY, not PLAY', () => {
    const inLobby = modifyFields(graduated, {
      coop: coop =>
        modifyFields(coop, {
          screen: () =>
            Screen.InRoom({
              room: {
                ...freshRoom(CODE, 0),
                maybePlayerId: Option.some('player-0'),
                maybeLobby: Option.some(lobbyOf([memberOf(0, 'Ana')])),
              },
            }),
        }),
    })
    story(
      update,
      given(inLobby),
      message(Message.PressedKey({ code: 'Enter' })),
      model(current => {
        expect(current.phase._tag).toBe('Ready')
      }),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        CoopMessage.CompletedChangeLobby(),
      ),
    )
  })
})
