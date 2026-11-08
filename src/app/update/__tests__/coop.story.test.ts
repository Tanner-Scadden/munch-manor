import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { LobbyChange, RoomRequest, Screen } from '../../../domain/coopRoom'
import { Message as CoopMessage } from '../../../features/coop/message'
import { freshRoom } from '../../../features/coop/roomState'
import { ChangeLobby } from '../../../features/coop/steps'
import { CODE, lobbyOf, memberOf } from '../../../features/coop/testing'
import { RememberRoom, RequestRoom } from '../../../features/coop/update'
import { type Appearance, lookCodeOf } from '../../../shared/playerData'
import { home, newPlayerReady } from '../../../test/model.fixture'
import { APPLICATION, resolveFocusCoop } from '../../../test/testing'
import { noRank, pointsForRank } from '../../../world/heroes/rank'
import { CoopBinding } from '../../bindings'
import { Message } from '../../message'
import { Lesson } from '../../model'
import { FocusHomeButton } from '../home'

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

describe('co-op from home', () => {
  it.effect(
    'a brand-new player opens co-op from the CO-OP tile, no tutorial first',
    () =>
      Story.story(
        APPLICATION,
        Story.given(newPlayerReady),
        Story.model(current => {
          expect(current.lessons.move).toEqual(Lesson.Pending())
          expect(current.lessons.openBreak).toEqual(Lesson.Pending())
        }),
        Story.message(Message.ClickedCoopButton()),
        resolveFocusCoop(),
        Story.model(current => {
          expect(current.coop.screen._tag).toBe('Hub')
        }),
      ),
  )

  it.effect('a brand-new player follows a room link into its room', () =>
    Story.story(
      APPLICATION,
      Story.given(newPlayerReady),
      Story.message(
        Message.CompletedReadRoomLink({ maybeCode: Option.some(CODE) }),
      ),
      Story.model(current => {
        expect(current.coop.screen).toEqual(
          Screen.Asking({ request: RoomRequest.Join({ code: CODE }) }),
        )
      }),
      Story.Command.resolve(
        RequestRoom({
          request: RoomRequest.Join({ code: CODE }),
          name: '',
          look: lookCodeOf(newPlayerReady.appearance),
          rank: 1,
          calling: 'You',
        }),
        CoopMessage.FailedRequestRoom({ problem: 'NoRoom' }),
      ),
      Story.Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
    ),
  )

  it.effect(
    'J opens the hub, Escape closes it and lands back on the tile',
    () =>
      Story.story(
        APPLICATION,
        Story.given(home),
        Story.message(Message.PressedKey({ code: 'KeyJ' })),
        resolveFocusCoop(),
        Story.model(current => {
          expect(current.coop.screen._tag).toBe('Hub')
        }),
        Story.message(Message.PressedKey({ code: 'KeyE' })),
        Story.model(current => {
          expect(current.home.mode).toBe('Campaign')
        }),
        Story.message(Message.PressedKey({ code: 'Escape' })),
        Story.Command.resolve(
          FocusHomeButton({ button: 'Coop' }),
          Message.CompletedFocusHomeButton(),
        ),
        Story.model(current => {
          expect(current.coop.screen._tag).toBe('Closed')
        }),
      ),
  )

  it.effect('a room link joins that room once the splash is gone', () =>
    Story.story(
      APPLICATION,
      Story.given(home),
      Story.message(
        Message.CompletedReadRoomLink({ maybeCode: Option.some(CODE) }),
      ),
      Story.model(current => {
        expect(current.coop.screen).toEqual(
          Screen.Asking({ request: RoomRequest.Join({ code: CODE }) }),
        )
      }),
      Story.Command.resolve(
        RequestRoom({
          request: RoomRequest.Join({ code: CODE }),
          name: '',
          look: lookCodeOf(home.appearance),
          rank: 1,
          calling: 'You',
        }),
        CoopMessage.FailedRequestRoom({ problem: 'NoRoom' }),
      ),
      Story.Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      Story.model(current => {
        expect(current.coop.screen._tag).toBe('Code')
      }),
    ),
  )

  it.effect(
    'the saved display name, look, and rank go with the room request',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(home, {
            playerName: () => 'Snackula',
            appearance: () => PICKED_LOOK,
            rank: () => ({ ...noRank, earnedPoints: pointsForRank(12) }),
          }),
        ),
        Story.message(Message.ClickedCoopButton()),
        resolveFocusCoop(),
        Story.messageIn(CoopBinding, CoopMessage.ClickedCreateButton()),
        Story.Command.resolve(
          RequestRoom({
            request: RoomRequest.Create(),
            name: 'Snackula',
            look: 'Slim.Ponytail.Pink.Tan.Purple.CCBA',
            rank: 12,
            calling: 'You',
          }),
          CoopMessage.FailedRequestRoom({ problem: 'Offline' }),
        ),
        Story.model(current => {
          expect(current.coop.screen).toEqual(
            Screen.Hub({ maybeProblem: Option.some('Offline') }),
          )
        }),
      ),
  )

  it.effect('Enter in the lobby is READY, not PLAY', () => {
    const inLobby = modifyFields(home, {
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
    return Story.story(
      APPLICATION,
      Story.given(inLobby),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.model(current => {
        expect(current.phase._tag).toBe('Ready')
      }),
      Story.Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        CoopMessage.CompletedChangeLobby(),
      ),
    )
  })
})
