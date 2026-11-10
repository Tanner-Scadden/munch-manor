import { Effect, Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { defaultAppearance } from '../../../app/model'
import { portraitOf } from '../../../art/coopIcons'
import { badgeImage } from '../../../art/rankArt'
import { seatLook } from '../../../art/seatLooks'
import {
  LobbyChange,
  type Room,
  RoomRequest,
  Screen,
} from '../../../domain/coopRoom'
import { type Appearance, lookCodeOf } from '../../../shared/playerData'
import type { ViewInputs } from '../block'
import { Message } from '../message'
import { type Model, emptyQueue } from '../model'
import { freshRoom } from '../roomState'
import { ChangeLobby, FocusCoopElement } from '../steps'
import {
  CODE,
  lobbyOf,
  memberOf,
  playingSession,
  stagedWorld,
} from '../testing'
import {
  AnswerOffer,
  CancelQuickPlay,
  CopyRoomCode,
  LeaveRoom,
  RememberRoom,
  RequestRoom,
  ShareRoomLink,
} from '../update'
import { COOP, coopAt as at } from './story.fixture'

const VIEW_INPUTS: ViewInputs = {
  look: defaultAppearance,
  isKeyboard: false,
  isRunCardUp: false,
  bought: ['hero:Handyman'],
  bones: 0,
}

const COOP_SCENE = { ...COOP, viewInputs: VIEW_INPUTS }

const onHub = at(Screen.Hub({ maybeProblem: Option.none() }))

const roomWith = (overrides: Partial<Room>): Model =>
  at(Screen.InRoom({ room: { ...freshRoom(CODE, 0), ...overrides } }))

const lobbyRoom = (members: ReadonlyArray<ReturnType<typeof memberOf>>) =>
  roomWith({
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members)),
    link: 'Online',
  })

const quickPlayButton = Scene.role('button', {
  name: 'Quick play: join players anywhere',
})

describe('the hub', () => {
  it.effect('QUICK PLAY, CODE, and NEW ROOM are the three ways in', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(onHub),
      Scene.expect(quickPlayButton).toExist(),
      Scene.expect(
        Scene.role('button', { name: 'Join a friend with a code' }),
      ).toExist(),
      Scene.expect(
        Scene.role('button', { name: 'Make a room for friends' }),
      ).toExist(),
      Scene.click(quickPlayButton),
      Scene.expect(Scene.selector('[data-screen="Queue"]')).toExist(),
    ),
  )

  it.effect('a problem shows as an alert', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(at(Screen.Hub({ maybeProblem: Option.some('Kicked') }))),
      Scene.expect(
        Scene.role('alert', { name: 'The host kicked you.' }),
      ).toExist(),
    ),
  )

  it.effect('a new room in flight shows its door, and a code its tiles', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        COOP_SCENE,
        Scene.given(at(Screen.Asking({ request: RoomRequest.Create() }))),
        Scene.expect(
          Scene.selector('[data-request="Create"] .coop-door'),
        ).toExist(),
        Scene.expect(Scene.selector('.coop-check-tiles')).not.toExist(),
      )
      yield* Scene.scene(
        COOP_SCENE,
        Scene.given(
          at(Screen.Asking({ request: RoomRequest.Join({ code: CODE }) })),
        ),
        Scene.expect(
          Scene.role('status', { name: 'Finding the room' }),
        ).toExist(),
        Scene.expect(
          Scene.selector('[data-request="Join"] .coop-check-tiles'),
        ).toHaveText(CODE),
      )
    }),
  )

  it.effect('NEW ROOM asks for a room', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(onHub),
      Scene.click(Scene.role('button', { name: 'Make a room for friends' })),
      Scene.expect(
        Scene.role('status', { name: 'Finding the room' }),
      ).toExist(),
      Scene.Command.resolve(
        RequestRoom({
          request: RoomRequest.Create(),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
        }),
        Message.SucceededRequestRoom({ code: CODE, slot: 0 }),
      ),
      Scene.Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.expect(
        Scene.role('button', { name: 'Share the room link' }),
      ).toExist(),
    ),
  )
})

describe('the code', () => {
  it.effect('five symbols typed into the slots join that room', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(at(Screen.Code({ typed: '', maybeProblem: Option.none() }))),
      Scene.expect(Scene.role('button', { name: 'Join' })).toBeDisabled(),
      Scene.type(Scene.role('textbox', { name: 'Room code' }), 'mnch'),
      Scene.expect(Scene.role('button', { name: 'Join' })).toBeDisabled(),
      Scene.type(Scene.role('textbox', { name: 'Room code' }), 'mnch7'),
      Scene.Command.resolve(
        RequestRoom({
          request: RoomRequest.Join({ code: CODE }),
          name: '',
          look: '',
          rank: 1,
          calling: 'You',
        }),
        Message.FailedRequestRoom({ problem: 'Full' }),
      ),
      Scene.Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Scene.expect(
        Scene.role('alert', { name: 'That room is full.' }),
      ).toExist(),
    ),
  )

  it.effect('back returns to the hub', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(
        at(Screen.Code({ typed: 'AB', maybeProblem: Option.none() })),
      ),
      Scene.click(Scene.role('button', { name: 'Back' })),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.expect(quickPlayButton).toExist(),
    ),
  )
})

describe('the queue', () => {
  it.effect('heads fill the seats and the offer starts with fewer', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(
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
      Scene.expect(
        Scene.role('list', { name: '3 of 4 players here' }),
      ).toExist(),
      Scene.click(
        Scene.role('button', { name: 'Start with 3 players. 1 said yes' }),
      ),
      Scene.Command.resolve(
        AnswerOffer({ accept: true }),
        Message.CompletedAnswerOffer(),
      ),
      Scene.expect(
        Scene.role('button', { name: 'Keep waiting for four' }),
      ).not.toExist(),
      Scene.click(Scene.role('button', { name: 'Stop looking' })),
      Scene.Command.resolve(
        CancelQuickPlay,
        Message.CompletedCancelQuickPlay(),
      ),
      Scene.expect(quickPlayButton).toExist(),
    ),
  )
})

describe('the lobby', () => {
  it.effect('seats show names, the host crown, and READY stamps', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
      Scene.expect(
        Scene.role('listitem', { name: 'Ana, you, host, rank 1' }),
      ).toExist(),
      Scene.expect(
        Scene.role('listitem', { name: 'Bo, rank 1, ready' }),
      ).toExist(),
      Scene.expect(Scene.role('listitem', { name: 'Empty seat' })).toExist(),
      Scene.expect(Scene.role('button', { name: 'Kick Bo' })).toExist(),
      Scene.click(Scene.role('button', { name: 'READY' })),
      Scene.Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedReady({ ready: true, pingMs: 0 }),
        }),
        Message.CompletedChangeLobby(),
      ),
      Scene.click(Scene.role('button', { name: 'Kick Bo' })),
      Scene.Command.resolve(
        ChangeLobby({
          change: LobbyChange.KickedPlayer({ playerId: 'player-1' }),
        }),
        Message.CompletedChangeLobby(),
      ),
    ),
  )

  it.effect('the host taps a mode and a skull; Nightmare stays padlocked', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')])),
      Scene.expect(Scene.role('group', { name: 'Mode' })).toExist(),
      Scene.expect(Scene.role('button', { name: 'Campaign' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      Scene.expect(Scene.role('button', { name: 'Keep going' })).not.toExist(),
      Scene.expect(
        Scene.role('button', { name: 'Triple Dog Dare, locked' }),
      ).toHaveAttr('aria-disabled', 'true'),
      Scene.click(Scene.role('button', { name: 'Endless' })),
      Scene.Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedPicks({
            mode: 'Endless',
            difficulty: 'Normal',
          }),
        }),
        Message.CompletedChangeLobby(),
      ),
      Scene.click(Scene.role('button', { name: 'Triple Dare' })),
      Scene.Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedPicks({
            mode: 'Campaign',
            difficulty: 'Hard',
          }),
        }),
        Message.CompletedChangeLobby(),
      ),
    ),
  )

  it.effect(
    'the modifiers are four tiles and their bonus; the host taps one',
    () =>
      Effect.gen(function* () {
        const withMask = (mask: number) =>
          roomWith({
            maybePlayerId: Option.some('player-0'),
            maybeLobby: Option.some({
              ...lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
              modifiers: mask,
            }),
          })
        yield* Scene.scene(
          COOP_SCENE,
          Scene.given(withMask(0)),
          Scene.expect(Scene.role('group', { name: 'Modifiers' })).toExist(),
          Scene.expect(
            Scene.role('button', { name: 'Friendly Fire, +15%, off' }),
          ).toExist(),
          Scene.expect(Scene.role('status', { name: 'Bonus +0%' })).toExist(),
          Scene.click(Scene.role('button', { name: 'Glass, +350%, off' })),
          Scene.Command.resolve(
            ChangeLobby({
              change: LobbyChange.ChangedModifiers({ modifiers: 8 }),
            }),
            Message.CompletedChangeLobby(),
          ),
        )
        yield* Scene.scene(
          COOP_SCENE,
          Scene.given(withMask(9)),
          Scene.expect(
            Scene.role('button', { name: 'Friendly Fire, +15%, on' }),
          ).toHaveAttr('aria-pressed', 'true'),
          Scene.expect(
            Scene.role('button', { name: 'Glass, +350%, on' }),
          ).toHaveAttr('aria-pressed', 'true'),
          Scene.expect(
            Scene.role('button', { name: 'Broke, +75%, off' }),
          ).toHaveAttr('aria-pressed', 'false'),
          Scene.expect(Scene.role('status', { name: 'Bonus +365%' })).toExist(),
          Scene.click(Scene.role('button', { name: 'Glass, +350%, on' })),
          Scene.Command.resolve(
            ChangeLobby({
              change: LobbyChange.ChangedModifiers({ modifiers: 1 }),
            }),
            Message.CompletedChangeLobby(),
          ),
        )
      }),
  )

  it.effect(
    'a guest sees the tiles still, and a tap on one says the host picks',
    () =>
      Scene.scene(
        COOP_SCENE,
        Scene.given(
          roomWith({
            slot: 1,
            maybePlayerId: Option.some('player-1'),
            maybeLobby: Option.some({
              ...lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
              modifiers: 4,
            }),
          }),
        ),
        Scene.expect(
          Scene.role('button', { name: 'Broke, +75%, on' }),
        ).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(Scene.role('status', { name: 'Bonus +75%' })).toExist(),
      ),
  )

  // NOTE: Scene treats aria-disabled as disabled and refuses the click, but a
  // browser delivers it: the taps themselves are Story tests (story.test.ts).
  it.effect('a tap on a pick that is not yours leaves a note in place', () =>
    Effect.gen(function* () {
      const guest = (reason: 'HostPicks' | 'Locked') =>
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some(
            lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
          ),
          maybeNudge: Option.some({ reason, count: 1 }),
        })
      yield* Scene.scene(
        COOP_SCENE,
        Scene.given(guest('HostPicks')),
        Scene.expect(Scene.selector('.coop-nudge')).toHaveText('HOST PICKS'),
        Scene.expect(Scene.selector('.coop-crown-flash-b')).toExist(),
      )
      yield* Scene.scene(
        COOP_SCENE,
        Scene.given(guest('Locked')),
        Scene.expect(Scene.selector('.coop-nudge')).toHaveText(
          'Escape on Triple Dare to unlock',
        ),
        Scene.expect(Scene.selector('.coop-crown-flash-b')).not.toExist(),
      )
      yield* Scene.scene(
        COOP_SCENE,
        Scene.given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')])),
        Scene.expect(Scene.selector('.coop-nudge')).not.toExist(),
      )
    }),
  )

  it.effect('your own name is a button; the field saves it for the room', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')])),
      Scene.expect(Scene.role('button', { name: 'Bo, rank 1' })).not.toExist(),
      Scene.expect(
        Scene.role('button', { name: 'Your name: Ana. Change it' }),
      ).toExist(),
      Scene.click(Scene.role('button', { name: 'Your name: Ana. Change it' })),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.expect(Scene.role('dialog', { name: 'Your name' })).toExist(),
      Scene.expect(Scene.selector('.coop-name-input')).toHaveValue('Ana'),
      Scene.click(Scene.role('button', { name: 'Roll a goofy name' })),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.click(Scene.role('button', { name: 'Cancel' })),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.expect(Scene.role('dialog', { name: 'Your name' })).not.toExist(),
    ),
  )

  it.effect('a guest sees the picks as icons, and KEEP GOING after a win', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some({
            ...lobbyOf([
              memberOf(0, 'Ana'),
              memberOf(1, 'Bo', false, '', false, 1, 'TrackStar'),
            ]),
            mode: 'KeepGoing',
            canKeepGoing: true,
            difficulty: 'Hard',
          }),
        }),
      ),
      Scene.expect(
        Scene.selector('[aria-label="Keep going, Triple Dare"]'),
      ).toExist(),
      Scene.expect(Scene.role('button', { name: 'Keep going' })).toHaveAttr(
        'aria-disabled',
        'true',
      ),
      Scene.expect(Scene.role('button', { name: 'Triple Dare' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
    ),
  )

  it.effect(
    'each seat wears the look its player sent, or its seat look',
    () => {
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
        hat: 'None',
        gunSkin: 'Stock',
      }
      return Scene.scene(
        COOP_SCENE,
        Scene.given(
          lobbyRoom([
            memberOf(0, 'Ana'),
            memberOf(1, 'Bo', false, lookCodeOf(sent)),
            memberOf(2, 'Cy', false, 'Robot.Chrome'),
          ]),
        ),
        Scene.expect(
          Scene.selector('[aria-label="Bo, rank 1"] .coop-seat-head'),
        ).toHaveStyle('background-image', portraitOf(sent)),
        Scene.expect(
          Scene.selector('[aria-label="Cy, rank 1"] .coop-seat-head'),
        ).toHaveStyle('background-image', portraitOf(seatLook(2))),
        Scene.expect(
          Scene.selector(
            '[aria-label="Ana, you, host, rank 1"] .coop-seat-head',
          ),
        ).toHaveStyle('background-image', portraitOf(defaultAppearance)),
      )
    },
  )

  it.effect(
    "each seat shows its player's rank badge and number beside the name",
    () => {
      const woodSrc = Option.getOrThrow(badgeImage('Wood')).src
      const silverSrc = Option.getOrThrow(badgeImage('Silver')).src
      return Scene.scene(
        COOP_SCENE,
        Scene.given(
          lobbyRoom([
            memberOf(0, 'Ana'),
            memberOf(1, 'Bo', false, '', false, 12),
            memberOf(2, 'Cy', false, '', false, 33),
            memberOf(3, 'Dee', false, '', false, 999),
          ]),
        ),
        Scene.expect(
          Scene.selector('[aria-label="Ana, you, host, rank 1"] .coop-rank'),
        ).toHaveText('1'),
        Scene.expect(
          Scene.selector('[aria-label="Bo, rank 12"] .coop-rank'),
        ).toHaveText('12'),
        Scene.expect(
          Scene.selector('[aria-label="Dee, rank 999"] .coop-rank'),
        ).toHaveText('999'),
        Scene.expect(
          Scene.selector(
            '[aria-label="Ana, you, host, rank 1"] .coop-rank img',
          ),
        ).toHaveAttr('src', woodSrc),
        Scene.expect(
          Scene.selector('[aria-label="Cy, rank 33"] .coop-rank'),
        ).toHaveAttr('data-tier', 'Silver'),
        Scene.expect(
          Scene.selector('[aria-label="Cy, rank 33"] .coop-rank img'),
        ).toHaveAttr('src', silverSrc),
      )
    },
  )

  it.effect(
    "each seat shows its player's calling prop beside the rank, YOU none",
    () =>
      Scene.scene(
        COOP_SCENE,
        Scene.given(
          lobbyRoom([
            memberOf(0, 'Ana'),
            memberOf(1, 'Bo', false, '', false, 4, 'Handyman'),
            memberOf(2, 'Cy', false, '', false, 16, 'LineCook'),
            memberOf(3, 'Dee', false, '', false, 7, 'Wizard'),
          ]),
        ),
        Scene.expect(
          Scene.selector('[aria-label="Ana, you, host, rank 1"] .coop-calling'),
        ).toBeAbsent(),
        Scene.expect(
          Scene.selector('[aria-label="Bo, rank 4, Handyman"] .coop-calling'),
        ).toHaveAttr('data-calling', 'Handyman'),
        Scene.expect(
          Scene.selector('[aria-label="Cy, rank 16, Line Cook"] .coop-calling'),
        ).toHaveAttr('data-calling', 'LineCook'),
        Scene.expect(
          Scene.selector('[aria-label="Dee, rank 7"] .coop-calling'),
        ).toBeAbsent(),
        // NOTE: the portrait wears the prop too; a word that is no calling does not.
        Scene.expect(
          Scene.selector('[aria-label="Bo, rank 4, Handyman"] .coop-seat-head'),
        ).toHaveStyle('background-image', portraitOf(seatLook(1), 'Handyman')),
        Scene.expect(
          Scene.selector('[aria-label="Dee, rank 7"] .coop-seat-head'),
        ).toHaveStyle('background-image', portraitOf(seatLook(3))),
      ),
  )

  it.effect('a seat reads aloud its player, rank, hero, and READY', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(
        lobbyRoom([
          memberOf(0, 'Ana', false, '', false, 7),
          memberOf(1, 'Bo', true, '', false, 16, 'LineCook'),
          memberOf(2, 'Cy', false, '', false, 3, 'Wizard'),
        ]),
      ),
      Scene.expect(
        Scene.role('listitem', { name: 'Ana, you, host, rank 7' }),
      ).toExist(),
      Scene.expect(
        Scene.role('listitem', { name: 'Bo, rank 16, Line Cook, ready' }),
      ).toExist(),
      Scene.expect(Scene.role('listitem', { name: 'Cy, rank 3' })).toExist(),
    ),
  )

  it.effect('the hero pill opens a picker of cards with their specials', () => {
    const picking = (rank: number) =>
      lobbyRoom([memberOf(0, 'Ana', false, '', false, rank)])
    return Scene.scene(
      COOP_SCENE,
      Scene.given(picking(4)),
      Scene.expect(Scene.selector('.coop-calling-picker')).toBeAbsent(),
      Scene.click(Scene.role('button', { name: /^Hero: YOU/ })),
      Scene.expect(Scene.selector('.coop-calling-picker')).toExist(),
      Scene.expect(
        Scene.selector('[data-calling="Handyman"] .calling-special'),
      ).toHaveText('+Traps 50% sturdier'),
      Scene.expect(
        Scene.selector('[data-calling="Handyman"][data-lock="Owned"]'),
      ).toExist(),
      Scene.expect(
        Scene.selector(
          '[data-calling="Handyman"] [data-sign="Drawback"] .calling-special-line',
        ),
      ).toHaveText('4 max hearts'),
      Scene.expect(
        Scene.selector(
          '[data-calling="PennyPincher"] [data-sign="Perk"] .calling-special-line',
        ),
      ).toHaveText('Kills drop 50% more keys'),
      Scene.expect(
        Scene.selector('[data-calling="LineCook"][data-lock="Locked"]'),
      ).toExist(),
      Scene.expect(
        Scene.selector('[data-calling="LineCook"] .calling-special-line'),
      ).toHaveText('Starts with Pressure Cooker'),
      Scene.expect(
        Scene.selector('[data-calling="LineCook"] .rank-number'),
      ).toHaveText('15'),
      Scene.click(
        Scene.role('button', {
          name: /^Handyman\. Plus: Traps 50% sturdier/,
        }),
      ),
      Scene.Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedMemberCalling({ calling: 'Handyman' }),
        }),
        Message.CompletedChangeLobby(),
      ),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.expect(Scene.selector('.coop-calling-picker')).toBeAbsent(),
    )
  })

  it.effect(
    'each seat shows its link as bars, yours from your own pings',
    () => {
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
      return Scene.scene(
        COOP_SCENE,
        Scene.given(
          at(
            Screen.InRoom({
              room: { ...room, session: { ...room.session, rttMs: 42 } },
            }),
          ),
        ),
        Scene.expect(Scene.role('img', { name: '42 ms' })).toHaveAttr(
          'data-ping',
          'Good',
        ),
        Scene.expect(Scene.role('img', { name: '150 ms' })).toHaveAttr(
          'data-ping',
          'Ok',
        ),
        Scene.expect(Scene.role('img', { name: '300 ms' })).not.toExist(),
        Scene.expect(
          Scene.selector('[aria-label="Cy"] .coop-ping'),
        ).not.toExist(),
      )
    },
  )

  it.effect('a guest sees no kick', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some(
            lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
          ),
        }),
      ),
      Scene.expect(Scene.role('button', { name: 'Kick Ana' })).not.toExist(),
    ),
  )

  it.effect('share and leave', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(lobbyRoom([memberOf(0, 'Ana')])),
      Scene.expect(
        Scene.role('button', { name: 'Room code M N C H 7, tap to copy' }),
      ).toExist(),
      Scene.click(Scene.role('button', { name: 'Share the room link' })),
      Scene.Command.resolve(
        ShareRoomLink({ code: CODE }),
        Message.CompletedShareRoomLink({ share: 'Copied' }),
      ),
      Scene.expect(Scene.role('button', { name: 'Link copied' })).toExist(),
      Scene.click(Scene.role('button', { name: 'Leave the room' })),
      Scene.expect(
        Scene.role('button', { name: 'Leave the room' }),
      ).toBeDisabled(),
      Scene.Command.resolve(LeaveRoom, Message.CompletedLeaveRoom()),
      Scene.Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Scene.Command.resolve(
        FocusCoopElement,
        Message.CompletedFocusCoopElement(),
      ),
      Scene.expect(quickPlayButton).toExist(),
    ),
  )
})

describe('the room code', () => {
  const codeButton = Scene.role('button', { name: /^Room code M N C H 7/ })

  it.effect('a tap copies it, and COPIED! flashes afresh for each copy', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(lobbyRoom([memberOf(0, 'Ana')])),
      Scene.expect(Scene.selector('.coop-room-code-copied')).toBeAbsent(),
      Scene.click(codeButton),
      Scene.Command.resolve(
        CopyRoomCode({ code: CODE }),
        Message.CompletedCopyRoomCode({ copy: 'Copied' }),
      ),
      Scene.expect(Scene.selector('.coop-room-code-copied')).toHaveText(
        'COPIED!',
      ),
      Scene.expect(codeButton).toHaveAccessibleName(
        'Room code M N C H 7, copied',
      ),
      Scene.click(codeButton),
      Scene.Command.resolve(
        CopyRoomCode({ code: CODE }),
        Message.CompletedCopyRoomCode({ copy: 'Copied' }),
      ),
      Scene.expect(Scene.selector('.coop-room-code-copied')).toHaveText(
        'COPIED!',
      ),
    ),
  )

  it.effect('a clipboard that refuses shows nothing', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(lobbyRoom([memberOf(0, 'Ana')])),
      Scene.click(codeButton),
      Scene.Command.resolve(
        CopyRoomCode({ code: CODE }),
        Message.CompletedCopyRoomCode({ copy: 'Failed' }),
      ),
      Scene.expect(Scene.selector('.coop-room-code-copied')).toBeAbsent(),
    ),
  )
})

describe('the arena', () => {
  const world = stagedWorld([0, 1], [])
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

  it.effect(
    'the game shows through, with a leave button and the link numbers',
    () =>
      Scene.scene(
        COOP_SCENE,
        Scene.given(playing()),
        Scene.expect(Scene.selector('.coop[data-screen="Arena"]')).toExist(),
        Scene.expect(Scene.selector('canvas')).not.toExist(),
        Scene.expect(Scene.selector('.coop-net[data-slot="0"]')).toExist(),
        Scene.expect(
          Scene.role('button', { name: 'Leave the room' }),
        ).toExist(),
      ),
  )

  it.effect('a dropped link shows Away', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(playing({ link: 'Reconnecting' })),
      Scene.expect(Scene.role('status', { name: 'Reconnecting' })).toExist(),
    ),
  )

  it.effect('a link lost for good says so and offers LEAVE', () =>
    Scene.scene(
      COOP_SCENE,
      Scene.given(playing({ link: 'Lost' })),
      Scene.expect(Scene.role('alert')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Leave the room' })).toExist(),
    ),
  )

  it.effect(
    'the lobby waits behind the run end card, drawing nothing over it, then crowns the MVP',
    () =>
      Effect.gen(function* () {
        const back = modifyFields(
          at(Screen.Hub({ maybeProblem: Option.none() })),
          {
            bought: () => [],
            screen: () =>
              Screen.InRoom({
                room: {
                  ...freshRoom(CODE, 0),
                  maybeLobby: Option.some({
                    ...lobbyOf([
                      memberOf(0, 'Ana'),
                      memberOf(1, 'Bo', false, '', false, 1, 'TrackStar'),
                    ]),
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
          },
        )
        yield* Scene.scene(
          {
            ...COOP,
            viewInputs: { ...VIEW_INPUTS, isRunCardUp: true, bought: [] },
          },
          Scene.given(back),
          Scene.expect(Scene.selector('#coop-ready')).toBeAbsent(),
          Scene.expect(
            Scene.role('listitem', { name: 'Bo: rank 1, Track Star, 9, MVP' }),
          ).toBeAbsent(),
          Scene.expect(Scene.role('button', { name: /^Leave/ })).toBeAbsent(),
          Scene.expect(
            Scene.selector('.coop[data-screen="RunCard"]'),
          ).toExist(),
        )
        yield* Scene.scene(
          COOP_SCENE,
          Scene.given(back),
          Scene.expect(
            Scene.role('listitem', { name: 'Bo: rank 1, Track Star, 9, MVP' }),
          ).toExist(),
          Scene.expect(
            Scene.role('listitem', { name: 'Ana: rank 1, 3' }),
          ).toExist(),
          Scene.expect(Scene.selector('.coop-result-crown')).toExist(),
          Scene.expect(
            Scene.selector(
              '[aria-label="Bo: rank 1, Track Star, 9, MVP"] .coop-result-rank',
            ),
          ).toExist(),
          Scene.expect(
            Scene.selector(
              '[aria-label="Bo: rank 1, Track Star, 9, MVP"] .coop-result-calling',
            ),
          ).toHaveAttr('data-calling', 'TrackStar'),
          Scene.expect(
            Scene.selector(
              '[aria-label="Ana: rank 1, 3"] .coop-result-calling',
            ),
          ).toBeAbsent(),
        )
      }),
  )
})
