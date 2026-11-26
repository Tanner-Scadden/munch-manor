import { Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { Lesson } from '#app/model.ts'
import { FocusHomeButton } from '#app/update/home.ts'
import { LobbyChange, RoomRequest, Screen } from '#domain/coopRoom.ts'
import { CoopMessage } from '#features/coop/message.ts'
import { freshRoom } from '#features/coop/roomState.ts'
import { CODE, lobbyOf, memberOf } from '#features/coop/services/testing.ts'
import { ChangeLobby } from '#features/coop/steps.ts'
import { RememberRoom, RequestRoom } from '#features/coop/update.ts'
import { lookCodeOf } from '#shared/records/lookCodes.ts'
import type { Appearance } from '#shared/records/playerData.ts'
import { home, newPlayerReady } from '#test/model.fixture.ts'
import {
  checkModel,
  modelAfter,
  resolveFocusCoop,
  send,
  steps,
} from '#test/testing.ts'
import { noRank, pointsForRank } from '#world/heroes/rank.ts'

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
  propStyle: 'Stock',
}

describe('co-op from home', () => {
  it.effect(
    'a brand-new player opens co-op from the CO-OP tile, no tutorial first',
    () =>
      modelAfter(
        newPlayerReady,
        steps(
          checkModel(current => {
            expect(current.lessons.move).toEqual(Lesson.Pending())
            expect(current.lessons.openBreak).toEqual(Lesson.Pending())
          }),
          send(Message.ClickedCoopButton()),
          resolveFocusCoop,
          checkModel(current => {
            expect(current.coop.screen._tag).toBe('Hub')
          }),
        ),
      ),
  )

  it.effect('a brand-new player follows a room link into its room', () =>
    modelAfter(
      newPlayerReady,
      steps(
        send(Message.CompletedReadRoomLink({ maybeCode: Option.some(CODE) })),
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Asking({ request: RoomRequest.Join({ code: CODE }) }),
          )
        }),
        s =>
          s.resolve(
            RequestRoom.make({
              request: RoomRequest.Join({ code: CODE }),
              name: '',
              look: lookCodeOf(newPlayerReady.appearance),
              rank: 1,
              calling: 'You',
              introSeen: false,
            }),
            CoopMessage.FailedRequestRoom({ problem: 'NoRoom' }),
          ),
        s => s.resolve(RememberRoom, Component.noop),
      ),
    ),
  )

  it.effect(
    'J opens the hub, Escape closes it and lands back on the tile',
    () =>
      modelAfter(
        home,
        steps(
          send(Message.PressedKey({ code: 'KeyJ' })),
          resolveFocusCoop,
          checkModel(current => {
            expect(current.coop.screen._tag).toBe('Hub')
          }),
          send(Message.PressedKey({ code: 'KeyE' })),
          checkModel(current => {
            expect(current.home.mode).toBe('Campaign')
          }),
          send(Message.PressedKey({ code: 'Escape' })),
          s =>
            s.resolve(FocusHomeButton.make({ button: 'Coop' }), Component.noop),
          checkModel(current => {
            expect(current.coop.screen._tag).toBe('Closed')
          }),
        ),
      ),
  )

  it.effect('a room link joins that room once the splash is gone', () =>
    modelAfter(
      home,
      steps(
        send(Message.CompletedReadRoomLink({ maybeCode: Option.some(CODE) })),
        checkModel(current => {
          expect(current.coop.screen).toEqual(
            Screen.Asking({ request: RoomRequest.Join({ code: CODE }) }),
          )
        }),
        s =>
          s.resolve(
            RequestRoom.make({
              request: RoomRequest.Join({ code: CODE }),
              name: '',
              look: lookCodeOf(home.appearance),
              rank: 1,
              calling: 'You',
              introSeen: true,
            }),
            CoopMessage.FailedRequestRoom({ problem: 'NoRoom' }),
          ),
        s => s.resolve(RememberRoom, Component.noop),
        checkModel(current => {
          expect(current.coop.screen._tag).toBe('Code')
        }),
      ),
    ),
  )

  it.effect(
    'the saved display name, look, rank, and intro seen go with the room request',
    () =>
      modelAfter(
        UiStruct.evolve(home, {
          playerName: () => 'Snackula',
          appearance: () => PICKED_LOOK,
          rank: () => ({ ...noRank, earnedPoints: pointsForRank(12) }),
        }),
        steps(
          send(Message.ClickedCoopButton()),
          resolveFocusCoop,
          send(CoopMessage.ClickedCoopCreateButton()),
          s =>
            s.resolve(
              RequestRoom.make({
                request: RoomRequest.Create(),
                name: 'Snackula',
                look: 'Slim.Ponytail.Pink.Tan.Purple.CCBA',
                rank: 12,
                calling: 'You',
                introSeen: true,
              }),
              CoopMessage.FailedRequestRoom({ problem: 'Offline' }),
            ),
          checkModel(current => {
            expect(current.coop.screen).toEqual(
              Screen.Hub({ maybeProblem: Option.some('Offline') }),
            )
          }),
        ),
      ),
  )

  it.effect('Enter in the lobby is READY, not PLAY', () => {
    const inLobby = UiStruct.evolve(home, {
      coop: coop =>
        UiStruct.evolve(coop, {
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
    return modelAfter(
      inLobby,
      steps(
        send(Message.PressedKey({ code: 'Enter' })),
        checkModel(current => {
          expect(current.phase._tag).toBe('Ready')
        }),
        s =>
          s.resolve(
            ChangeLobby.make({
              change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
            }),
            Component.noop,
          ),
      ),
    )
  })
})
