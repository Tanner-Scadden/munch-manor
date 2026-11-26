import { Array, Effect, Match, Option, Schema, type Scope } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, defaultAppearance } from '../../../app/model'
import { portraitOf } from '../../../art/coopIcons'
import { badgeImage } from '../../../art/rankArt'
import { seatLook } from '../../../art/seatLooks'
import {
  LobbyChange,
  type Room,
  RoomRequest,
  Screen,
} from '../../../domain/coopRoom'
import { lookCodeOf } from '../../../shared/lookCodes'
import type { Appearance } from '../../../shared/playerData'
import {
  button,
  byClass,
  childrenOf,
  expectAttr,
  expectStyle,
  firstOf,
  measureSurface,
  withAttrs,
} from '../../../test/sceneTesting'
import {
  type AppScene,
  type SceneStep,
  resolveFocusCoop,
  resolveRememberRoom,
  sceneOf,
} from '../../../test/testing'
import { HeroPicker, HeroPickerProps } from '../../heroes/block'
import { Events as HeroPickerEvents } from '../../heroes/message'
import { CoopMessage } from '../message'
import { emptyQueue } from '../model'
import { freshRoom } from '../roomState'
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
  RequestRoom,
  ShareRoomLink,
} from '../update'
import { coopAt, lobbyChanged } from './story.fixture'

const at = (screen: Screen): Model =>
  UiStruct.evolve(coopAt(screen), {
    appearance: () => defaultAppearance,
    lastDevice: () => 'Touch',
  })

const coopSceneOf = (
  model: Model,
): Effect.Effect<AppScene, never, Scope.Scope> =>
  Effect.map(sceneOf(model), measureSurface)

const onHub = at(Screen.Hub({ maybeProblem: Option.none() }))

const roomWith = (overrides: Partial<Room>): Model =>
  at(Screen.InRoom({ room: { ...freshRoom(CODE, 0), ...overrides } }))

const lobbyRoom = (members: ReadonlyArray<ReturnType<typeof memberOf>>) =>
  roomWith({
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members)),
    link: 'Online',
  })

const quickPlayButton = button('Quick play: join players anywhere')

const findingRoom = HtmlLocator.role('status', { name: 'Finding the room' })

const inLabelled = (label: string, name: string): Locator.Locator =>
  Locator.inside(Locator.attr('aria-label', label), byClass(name))

const inCalling = (calling: string, locator: Locator.Locator) =>
  Locator.inside(Locator.attr('data-calling', calling), locator)

const ask = (request: RoomRequest) =>
  RequestRoom.make({
    request,
    name: '',
    look: '',
    rank: 1,
    calling: 'You',
    introSeen: false,
  })

const PICKER_KEY = 'coop-hero-picker'

const isPickerProps = Schema.is(HeroPickerProps)

const pickerPropsIn = (s: AppScene): Option.Option<HeroPickerProps> =>
  Array.findFirst(childrenOf(s.view), node =>
    Match.value(node).pipe(
      Match.tag('Child', child =>
        child.key === PICKER_KEY && isPickerProps(child.props)
          ? Option.some(child.props)
          : Option.none(),
      ),
      Match.orElse(() => Option.none()),
    ),
  )

const expectPicker =
  (isUp: boolean): SceneStep =>
  s =>
    s.check(() => {
      expect(Option.isSome(pickerPropsIn(s))).toBe(isUp)
    })

const pickerSceneIn = (
  s: AppScene,
): Effect.Effect<HtmlScene.Steps<typeof HeroPicker>, never, Scope.Scope> =>
  HtmlScene.make(
    HeroPicker,
    Option.getOrThrowWith(
      pickerPropsIn(s),
      () => new Error('co-op draws no hero picker'),
    ),
  )

describe('the hub', () => {
  it.effect('QUICK PLAY, CODE, and NEW ROOM are the three ways in', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(onHub)
      s.expect(quickPlayButton)
        .toExist()
        .expect(button('Join a friend with a code'))
        .toExist()
        .expect(button('Make a room for friends'))
        .toExist()
        .click(quickPlayButton)
        .expect(Locator.attr('data-screen', 'Queue'))
        .toExist()
    }),
  )

  it.effect('a problem shows as an alert', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        at(Screen.Hub({ maybeProblem: Option.some('Kicked') })),
      )
      s.expect(
        HtmlLocator.role('alert', { name: 'The host kicked you.' }),
      ).toExist()
    }),
  )

  it.effect('a new room in flight shows its door, and a code its tiles', () =>
    Effect.gen(function* () {
      const create = yield* coopSceneOf(
        at(Screen.Asking({ request: RoomRequest.Create() })),
      )
      create
        .expect(
          Locator.inside(
            Locator.attr('data-request', 'Create'),
            byClass('coop-door'),
          ),
        )
        .toExist()
        .expect(byClass('coop-check-tiles'))
        .toBeAbsent()
      const join = yield* coopSceneOf(
        at(Screen.Asking({ request: RoomRequest.Join({ code: CODE }) })),
      )
      join
        .expect(findingRoom)
        .toExist()
        .expect(
          Locator.inside(
            Locator.attr('data-request', 'Join'),
            byClass('coop-check-tiles'),
          ),
        )
        .toHaveText(CODE)
    }),
  )

  it.effect('NEW ROOM asks for a room', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(onHub)
      s.click(button('Make a room for friends'))
        .expect(findingRoom)
        .toExist()
        .resolve(
          ask(RoomRequest.Create()),
          CoopMessage.SucceededRequestRoom({ code: CODE, slot: 0 }),
        )
        .pipe(resolveRememberRoom, resolveFocusCoop)
        .expect(button('I dare you: share the room link'))
        .toExist()
    }),
  )
})

describe('the code', () => {
  it.effect('five symbols typed into the slots join that room', () =>
    Effect.gen(function* () {
      const field = HtmlLocator.role('textbox', { name: 'Room code' })
      const join = button('Join')
      const s = yield* coopSceneOf(
        at(Screen.Code({ typed: '', maybeProblem: Option.none() })),
      )
      s.expect(join)
        .toBeDisabled()
        .type(field, 'mnch')
        .expect(join)
        .toBeDisabled()
        .type(field, 'mnch7')
        .resolve(
          ask(RoomRequest.Join({ code: CODE })),
          CoopMessage.FailedRequestRoom({ problem: 'Full' }),
        )
        .pipe(resolveRememberRoom)
        .expect(HtmlLocator.role('alert', { name: 'That room is full.' }))
        .toExist()
    }),
  )

  it.effect('back returns to the hub', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        at(Screen.Code({ typed: 'AB', maybeProblem: Option.none() })),
      )
      s.click(button('Back'))
        .pipe(resolveFocusCoop)
        .expect(quickPlayButton)
        .toExist()
    }),
  )
})

describe('the queue', () => {
  it.effect('heads fill the seats and the offer starts with fewer', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
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
      )
      s.expect(HtmlLocator.role('list', { name: '3 of 4 players here' }))
        .toExist()
        .click(button('Start with 3 players. 1 said yes'))
        .resolve(AnswerOffer.make({ accept: true }), Component.noop)
        .expect(button('Keep waiting for four'))
        .toBeAbsent()
        .click(button('Stop looking'))
        .resolve(CancelQuickPlay, Component.noop)
        .expect(quickPlayButton)
        .toExist()
    }),
  )
})

describe('the lobby', () => {
  it.effect('seats show names, the host crown, and READY stamps', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)]),
      )
      s.expect(HtmlLocator.role('listitem', { name: 'Ana, you, host, rank 1' }))
        .toExist()
        .expect(HtmlLocator.role('listitem', { name: 'Bo, rank 1, ready' }))
        .toExist()
        .expect(HtmlLocator.role('listitem', { name: 'Empty seat' }))
        .toExist()
        .expect(button('Kick Bo'))
        .toExist()
        .click(button('READY'))
        .pipe(
          lobbyChanged(LobbyChange.ChangedReady({ ready: true, pingMs: 0 })),
        )
        .click(button('Kick Bo'))
        .pipe(lobbyChanged(LobbyChange.KickedPlayer({ playerId: 'player-1' })))
    }),
  )

  it.effect('the host taps a mode and a skull; Nightmare stays padlocked', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
      )
      s.expect(HtmlLocator.role('group', { name: 'Mode' }))
        .toExist()
        .pipe(expectAttr(button('Campaign'), 'aria-pressed', 'true'))
        .expect(button('Keep going'))
        .toBeAbsent()
        .pipe(
          expectAttr(
            button('Triple Dog Dare, locked'),
            'aria-disabled',
            'true',
          ),
        )
        .click(button('Endless'))
        .pipe(
          lobbyChanged(
            LobbyChange.ChangedPicks({ mode: 'Endless', difficulty: 'Normal' }),
          ),
        )
        .click(button('Triple Dare'))
        .pipe(
          lobbyChanged(
            LobbyChange.ChangedPicks({ mode: 'Campaign', difficulty: 'Hard' }),
          ),
        )
    }),
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
        const none = yield* coopSceneOf(withMask(0))
        none
          .expect(HtmlLocator.role('group', { name: 'Modifiers' }))
          .toExist()
          .expect(button('Friendly Fire, +15%, off'))
          .toExist()
          .expect(HtmlLocator.role('status', { name: 'Bonus +0%' }))
          .toExist()
          .click(button('Glass, +350%, off'))
          .pipe(lobbyChanged(LobbyChange.ChangedModifiers({ modifiers: 8 })))
        const some = yield* coopSceneOf(withMask(9))
        some
          .pipe(
            expectAttr(
              button('Friendly Fire, +15%, on'),
              'aria-pressed',
              'true',
            ),
            expectAttr(button('Glass, +350%, on'), 'aria-pressed', 'true'),
            expectAttr(button('Broke, +75%, off'), 'aria-pressed', 'false'),
          )
          .expect(HtmlLocator.role('status', { name: 'Bonus +365%' }))
          .toExist()
          .click(button('Glass, +350%, on'))
          .pipe(lobbyChanged(LobbyChange.ChangedModifiers({ modifiers: 1 })))
      }),
  )

  it.effect(
    'a guest sees the tiles still, and a tap on one says the host picks',
    () =>
      Effect.gen(function* () {
        const s = yield* coopSceneOf(
          roomWith({
            slot: 1,
            maybePlayerId: Option.some('player-1'),
            maybeLobby: Option.some({
              ...lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
              modifiers: 4,
            }),
          }),
        )
        s.pipe(expectAttr(button('Broke, +75%, on'), 'aria-disabled', 'true'))
          .expect(HtmlLocator.role('status', { name: 'Bonus +75%' }))
          .toExist()
      }),
  )

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
      const hostPicks = yield* coopSceneOf(guest('HostPicks'))
      hostPicks
        .expect(byClass('coop-nudge'))
        .toHaveText('HOST PICKS')
        .expect(byClass('coop-crown-flash-b'))
        .toExist()
      const locked = yield* coopSceneOf(guest('Locked'))
      locked
        .expect(byClass('coop-nudge'))
        .toHaveText('Escape on Triple Dare to unlock')
        .expect(byClass('coop-crown-flash-b'))
        .toBeAbsent()
      const host = yield* coopSceneOf(
        lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
      )
      host.expect(byClass('coop-nudge')).toBeAbsent()
    }),
  )

  it.effect('your own name is a button; the field saves it for the room', () =>
    Effect.gen(function* () {
      const nameButton = button('Your name: Ana. Change it')
      const nameDialog = HtmlLocator.role('dialog', { name: 'Your name' })
      const s = yield* coopSceneOf(
        lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
      )
      s.expect(button('Bo, rank 1'))
        .toBeAbsent()
        .expect(nameButton)
        .toExist()
        .click(nameButton)
        .pipe(resolveFocusCoop)
        .expect(nameDialog)
        .toExist()
        .expect(byClass('coop-name-input'))
        .toHaveValue('Ana')
        .click(button('Roll a goofy name'))
        .pipe(resolveFocusCoop)
        .click(button('Cancel'))
        .pipe(resolveFocusCoop)
        .expect(nameDialog)
        .toBeAbsent()
    }),
  )

  it.effect('a guest sees the picks as icons, and KEEP GOING after a win', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
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
      )
      s.expect(Locator.attr('aria-label', 'Keep going, Triple Dare'))
        .toExist()
        .pipe(
          expectAttr(button('Keep going'), 'aria-disabled', 'true'),
          expectAttr(button('Triple Dare'), 'aria-pressed', 'true'),
        )
    }),
  )

  it.effect('each seat wears the look its player sent, or its seat look', () =>
    Effect.gen(function* () {
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
        propStyle: 'Stock',
      }
      const s = yield* coopSceneOf(
        lobbyRoom([
          memberOf(0, 'Ana'),
          memberOf(1, 'Bo', false, lookCodeOf(sent)),
          memberOf(2, 'Cy', false, 'Robot.Chrome'),
        ]),
      )
      s.pipe(
        expectStyle(
          inLabelled('Bo, rank 1', 'coop-seat-head'),
          'background-image',
          portraitOf(sent),
        ),
        expectStyle(
          inLabelled('Cy, rank 1', 'coop-seat-head'),
          'background-image',
          portraitOf(seatLook(2)),
        ),
        expectStyle(
          inLabelled('Ana, you, host, rank 1', 'coop-seat-head'),
          'background-image',
          portraitOf(defaultAppearance),
        ),
      )
    }),
  )

  it.effect(
    "each seat shows its player's rank badge and number beside the name",
    () =>
      Effect.gen(function* () {
        const woodSrc = Option.getOrThrow(badgeImage('Wood')).src
        const silverSrc = Option.getOrThrow(badgeImage('Silver')).src
        const s = yield* coopSceneOf(
          lobbyRoom([
            memberOf(0, 'Ana'),
            memberOf(1, 'Bo', false, '', false, 12),
            memberOf(2, 'Cy', false, '', false, 33),
            memberOf(3, 'Dee', false, '', false, 999),
          ]),
        )
        s.expect(inLabelled('Ana, you, host, rank 1', 'coop-rank'))
          .toHaveText('1')
          .expect(inLabelled('Bo, rank 12', 'coop-rank'))
          .toHaveText('12')
          .expect(inLabelled('Dee, rank 999', 'coop-rank'))
          .toHaveText('999')
          .pipe(
            expectAttr(
              Locator.inside(
                inLabelled('Ana, you, host, rank 1', 'coop-rank'),
                Locator.tag('img'),
              ),
              'src',
              woodSrc,
            ),
            expectAttr(
              inLabelled('Cy, rank 33', 'coop-rank'),
              'data-tier',
              'Silver',
            ),
            expectAttr(
              Locator.inside(
                inLabelled('Cy, rank 33', 'coop-rank'),
                Locator.tag('img'),
              ),
              'src',
              silverSrc,
            ),
          )
      }),
  )

  it.effect(
    "each seat shows its player's calling prop beside the rank, YOU none",
    () =>
      Effect.gen(function* () {
        const s = yield* coopSceneOf(
          lobbyRoom([
            memberOf(0, 'Ana'),
            memberOf(1, 'Bo', false, '', false, 4, 'Handyman'),
            memberOf(2, 'Cy', false, '', false, 16, 'LineCook'),
            memberOf(3, 'Dee', false, '', false, 7, 'Wizard'),
          ]),
        )
        s.expect(inLabelled('Ana, you, host, rank 1', 'coop-calling'))
          .toBeAbsent()
          .pipe(
            expectAttr(
              inLabelled('Bo, rank 4, Handyman', 'coop-calling'),
              'data-calling',
              'Handyman',
            ),
            expectAttr(
              inLabelled('Cy, rank 16, Line Cook', 'coop-calling'),
              'data-calling',
              'LineCook',
            ),
          )
          .expect(inLabelled('Dee, rank 7', 'coop-calling'))
          .toBeAbsent()
          .pipe(
            expectStyle(
              inLabelled('Bo, rank 4, Handyman', 'coop-seat-head'),
              'background-image',
              portraitOf(seatLook(1), 'Handyman'),
            ),
            expectStyle(
              inLabelled('Dee, rank 7', 'coop-seat-head'),
              'background-image',
              portraitOf(seatLook(3)),
            ),
          )
      }),
  )

  it.effect('a seat reads aloud its player, rank, hero, and READY', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        lobbyRoom([
          memberOf(0, 'Ana', false, '', false, 7),
          memberOf(1, 'Bo', true, '', false, 16, 'LineCook'),
          memberOf(2, 'Cy', false, '', false, 3, 'Wizard'),
        ]),
      )
      s.expect(HtmlLocator.role('listitem', { name: 'Ana, you, host, rank 7' }))
        .toExist()
        .expect(
          HtmlLocator.role('listitem', {
            name: 'Bo, rank 16, Line Cook, ready',
          }),
        )
        .toExist()
        .expect(HtmlLocator.role('listitem', { name: 'Cy, rank 3' }))
        .toExist()
    }),
  )

  it.effect('the hero pill opens a picker of cards with their specials', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        lobbyRoom([memberOf(0, 'Ana', false, '', false, 4)]),
      )
      s.pipe(expectPicker(false))
        .click(button(/^Hero: YOU/))
        .pipe(expectPicker(true))
      const picker = yield* pickerSceneIn(s)
      picker
        .expect(byClass('coop-calling-picker'))
        .toExist()
        .expect(firstOf(inCalling('Handyman', byClass('calling-special'))))
        .toHaveText('+Traps 50% sturdier')
        .expect(
          withAttrs({ 'data-lock': 'Owned' })(
            Locator.attr('data-calling', 'Handyman'),
          ),
        )
        .toExist()
        .expect(
          inCalling(
            'Handyman',
            Locator.inside(
              Locator.attr('data-sign', 'Drawback'),
              byClass('calling-special-line'),
            ),
          ),
        )
        .toHaveText('4 max hearts')
        .expect(
          inCalling(
            'PennyPincher',
            Locator.inside(
              Locator.attr('data-sign', 'Perk'),
              byClass('calling-special-line'),
            ),
          ),
        )
        .toHaveText('Kills drop 50% more keys')
        .expect(
          withAttrs({ 'data-lock': 'Locked' })(
            Locator.attr('data-calling', 'LineCook'),
          ),
        )
        .toExist()
        .expect(firstOf(inCalling('LineCook', byClass('calling-special-line'))))
        .toHaveText('Starts with Pressure Cooker')
        .expect(inCalling('LineCook', byClass('rank-number')))
        .toHaveText('15')
        .click(button(/^Handyman\. Plus: Traps 50% sturdier/))
        .emitted(HeroPickerEvents.Picked({ calling: 'Handyman' }))
      s.childEmit(
        HeroPicker,
        PICKER_KEY,
        HeroPickerEvents.Picked({ calling: 'Handyman' }),
      ).pipe(
        lobbyChanged(LobbyChange.ChangedMemberCalling({ calling: 'Handyman' })),
        resolveFocusCoop,
        expectPicker(false),
      )
    }),
  )

  it.effect('each seat shows its link as bars, yours from your own pings', () =>
    Effect.gen(function* () {
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
      const s = yield* coopSceneOf(
        at(
          Screen.InRoom({
            room: { ...room, session: { ...room.session, rttMs: 42 } },
          }),
        ),
      )
      s.pipe(
        expectAttr(
          HtmlLocator.role('img', { name: '42 ms' }),
          'data-ping',
          'Good',
        ),
        expectAttr(
          HtmlLocator.role('img', { name: '150 ms' }),
          'data-ping',
          'Ok',
        ),
      )
        .expect(HtmlLocator.role('img', { name: '300 ms' }))
        .toBeAbsent()
        .expect(inLabelled('Cy', 'coop-ping'))
        .toBeAbsent()
    }),
  )

  it.effect('a guest sees no kick', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some(
            lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
          ),
        }),
      )
      s.expect(button('Kick Ana')).toBeAbsent()
    }),
  )

  it.effect('share and leave', () =>
    Effect.gen(function* () {
      const leave = button('Leave the room')
      const s = yield* coopSceneOf(lobbyRoom([memberOf(0, 'Ana')]))
      s.expect(button('Room code M N C H 7, tap to copy'))
        .toExist()
        .click(button('I dare you: share the room link'))
        .resolve(
          ShareRoomLink.make({ code: CODE }),
          CoopMessage.CompletedShareRoomLink({ share: 'Copied' }),
        )
        .expect(button('Link copied'))
        .toExist()
        .click(leave)
        .expect(leave)
        .toBeDisabled()
        .resolve(LeaveRoom, CoopMessage.CompletedLeaveRoom())
        .pipe(resolveRememberRoom, resolveFocusCoop)
        .expect(quickPlayButton)
        .toExist()
    }),
  )
})

describe('the room code', () => {
  const codeButton = button(/^Room code M N C H 7/)
  const copied = byClass('coop-room-code-copied')
  const copy = CopyRoomCode.make({ code: CODE })

  it.effect('a tap copies it, and COPIED! flashes afresh for each copy', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(lobbyRoom([memberOf(0, 'Ana')]))
      s.expect(copied)
        .toBeAbsent()
        .click(codeButton)
        .resolve(copy, CoopMessage.CompletedCopyRoomCode({ copy: 'Copied' }))
        .expect(copied)
        .toHaveText('COPIED!')
        .expect(codeButton)
        .toHaveAccessibleName('Room code M N C H 7, copied')
        .click(codeButton)
        .resolve(copy, CoopMessage.CompletedCopyRoomCode({ copy: 'Copied' }))
        .expect(copied)
        .toHaveText('COPIED!')
    }),
  )

  it.effect('a clipboard that refuses shows nothing', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(lobbyRoom([memberOf(0, 'Ana')]))
      s.click(codeButton)
        .resolve(copy, CoopMessage.CompletedCopyRoomCode({ copy: 'Failed' }))
        .expect(copied)
        .toBeAbsent()
    }),
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
      Effect.gen(function* () {
        const s = yield* coopSceneOf(playing())
        s.expect(withAttrs({ 'data-screen': 'Arena' })(byClass('coop')))
          .toExist()
          .expect(Locator.inside(byClass('coop'), Locator.tag('canvas')))
          .toBeAbsent()
          .expect(withAttrs({ 'data-slot': '0' })(byClass('coop-net')))
          .toExist()
          .expect(button('Leave the room'))
          .toExist()
      }),
  )

  it.effect('a dropped link shows Away', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(playing({ link: 'Reconnecting' }))
      s.expect(HtmlLocator.role('status', { name: 'Reconnecting' })).toExist()
    }),
  )

  it.effect('a link lost for good says so and offers LEAVE', () =>
    Effect.gen(function* () {
      const s = yield* coopSceneOf(playing({ link: 'Lost' }))
      s.expect(Locator.inside(byClass('coop'), HtmlLocator.role('alert')))
        .toExist()
        .expect(button('Leave the room'))
        .toExist()
    }),
  )

  it.effect(
    'the lobby waits behind the run end card, drawing nothing over it, then crowns the MVP',
    () =>
      Effect.gen(function* () {
        const back = UiStruct.evolve(onHub, {
          boughtCosmetics: () => [],
          coop: coop =>
            UiStruct.evolve(coop, {
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
            }),
        })
        const mvp = 'Bo: rank 1, Track Star, 9, MVP'
        const card = yield* coopSceneOf(
          UiStruct.evolve(back, { phase: () => Phase.GameOver({ wave: 1 }) }),
        )
        card
          .expect(Locator.attr('id', 'coop-ready'))
          .toBeAbsent()
          .expect(HtmlLocator.role('listitem', { name: mvp }))
          .toBeAbsent()
          .expect(Locator.inside(byClass('coop'), button(/^Leave/)))
          .toBeAbsent()
          .expect(withAttrs({ 'data-screen': 'RunCard' })(byClass('coop')))
          .toExist()
        const lobby = yield* coopSceneOf(back)
        lobby
          .expect(HtmlLocator.role('listitem', { name: mvp }))
          .toExist()
          .expect(HtmlLocator.role('listitem', { name: 'Ana: rank 1, 3' }))
          .toExist()
          .expect(byClass('coop-result-crown'))
          .toExist()
          .expect(inLabelled(mvp, 'coop-result-rank'))
          .toExist()
          .pipe(
            expectAttr(
              inLabelled(mvp, 'coop-result-calling'),
              'data-calling',
              'TrackStar',
            ),
          )
          .expect(inLabelled('Ana: rank 1, 3', 'coop-result-calling'))
          .toBeAbsent()
      }),
  )
})
