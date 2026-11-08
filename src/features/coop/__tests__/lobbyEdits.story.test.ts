import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { LobbyChange } from '../../../domain/coopRoom'
import { GOOFY_NAMES } from '../../../domain/playerName'
import type { Calling } from '../../../shared/playerData'
import { resolveFocusCoop } from '../../../test/testing'
import { roomSettingsOf } from '../../../world/net/roomWorld'
import { Message as HeroPickerMessage } from '../../heroes/message'
import { isPickerOpen } from '../../heroes/model'
import { HeroPickerBinding } from '../bindings'
import { InMessage } from '../inMessage'
import { Message, OutMessage } from '../message'
import { type Model } from '../model'
import { CALLING_PILL_ID } from '../roomState'
import { ChangeLobby, FocusCoopElement } from '../steps'
import { lobbyOf, memberOf } from '../testing'
import {
  COOP,
  inRoom,
  lobbyUpdate,
  onHub,
  pressed,
  roomOf,
} from './story.fixture'

const tapCard = (calling: Calling) =>
  Story.messageIn(HeroPickerBinding, HeroPickerMessage.ClickedCard({ calling }))

const tapBuy = Story.messageIn(
  HeroPickerBinding,
  HeroPickerMessage.ClickedBuyButton(),
)

const isUp = (current: Model): boolean => isPickerOpen(current.heroPicker)

const focusPill = Story.Command.resolve(
  FocusCoopElement({ id: CALLING_PILL_ID }),
  Message.CompletedFocusCoopElement(),
)

describe('picking a hero in the lobby', () => {
  const ANA_RANK_4 = memberOf(0, 'Ana', true, '', false, 4)
  const BO = memberOf(1, 'Bo')
  const lobbyAt4 = lobbyOf([ANA_RANK_4, BO])
  const lobbied = Story.message(lobbyUpdate(lobbyAt4))

  it.effect('the pill and Y open the picker, and Y or Escape close it', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      lobbied,
      Story.model(current => {
        expect(isUp(current)).toBe(false)
      }),
      pressed('KeyY'),
      Story.model(current => {
        expect(isUp(current)).toBe(true)
      }),
      pressed('KeyY'),
      Story.model(current => {
        expect(isUp(current)).toBe(false)
      }),
      Story.message(Message.ClickedCallingPill()),
      Story.model(current => {
        expect(isUp(current)).toBe(true)
      }),
      pressed('Escape'),
      Story.model(current => {
        expect(isUp(current)).toBe(false)
      }),
    ),
  )

  it.effect('Enter and the picks wait while it is open', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      lobbied,
      Story.message(Message.ClickedCallingPill()),
      pressed('Enter'),
      pressed('KeyE'),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(isUp(current)).toBe(true)
      }),
    ),
  )

  it.effect(
    'a hero the rank reached goes to the lobby and the parent, and READY stays',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(0)),
        lobbied,
        Story.message(Message.ClickedCallingPill()),
        tapCard('Handyman'),
        Story.expectOutMessage(
          OutMessage.ChoseCalling({ calling: 'Handyman' }),
        ),
        Story.Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedMemberCalling({ calling: 'Handyman' }),
          }),
          Message.CompletedChangeLobby(),
        ),
        focusPill,
        Story.model(current => {
          expect(isUp(current)).toBe(false)
          expect(current.calling).toBe('Handyman')
          expect(
            Option.exists(roomOf(current).maybeLobby, lobby =>
              Array.every(
                lobby.members,
                member => member.ready === (member.slot === 0),
              ),
            ),
          ).toBe(true)
        }),
      ),
  )

  it.effect(
    'a hero the rank has not reached, or the one already worn, sends nothing',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(0)),
        lobbied,
        Story.message(Message.ClickedCallingPill()),
        tapCard('LineCook'),
        Story.Command.expectNone(),
        Story.expectNoOutMessage(),
        Story.model(current => {
          expect(isUp(current)).toBe(true)
        }),
        tapCard('You'),
        Story.expectNoOutMessage(),
        focusPill,
        Story.model(current => {
          expect(isUp(current)).toBe(false)
        }),
      ),
  )

  it.effect('a hero changed in the lobby is the one the start seats', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      lobbied,
      Story.message(
        lobbyUpdate({
          ...lobbyAt4,
          members: [{ ...ANA_RANK_4, calling: 'Handyman' }, BO],
        }),
      ),
      Story.model(changed => {
        const lobby = Option.getOrThrow(roomOf(changed).maybeLobby)
        expect(
          roomSettingsOf('Campaign', 'Normal', lobby.members).callings,
        ).toEqual([
          { slot: 0, calling: 'Handyman' },
          { slot: 1, calling: 'You' },
        ])
      }),
    ),
  )

  it.effect('a started run closes the picker', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      lobbied,
      Story.message(Message.ClickedCallingPill()),
      Story.message(lobbyUpdate({ ...lobbyAt4, status: 'Playing' })),
      Story.model(current => {
        expect(isUp(current)).toBe(false)
      }),
    ),
  )
})

describe('buying a hero in the lobby', () => {
  // NOTE: rank 7 has reached the Track Star (rank 6, 100 Bones), not the
  // Penny Pincher (rank 10).
  const ANA = memberOf(0, 'Ana', false, '', false, 7)
  const lobbyAt = lobbyOf([ANA, memberOf(1, 'Bo')])
  const withBones = (bones: number) =>
    Story.given(modifyFields(inRoom(0), { bones: () => bones }))
  const pickerUp = Story.steps(
    Story.message(lobbyUpdate(lobbyAt)),
    Story.message(Message.ClickedCallingPill()),
  )
  const tryingOf = (current: Model) => current.heroPicker.maybeTrying

  it.effect(
    'a hero for sale is tried on, not picked, and nothing is sent',
    () =>
      Story.story(
        COOP,
        withBones(150),
        pickerUp,
        tapCard('TrackStar'),
        Story.expectNoOutMessage(),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(tryingOf(current)).toEqual(Option.some('TrackStar'))
          expect(isUp(current)).toBe(true)
          expect(current.calling).toBe('You')
        }),
      ),
  )

  it.effect(
    'BUY asks the parent to spend the Bones, once, and the answer picks the hero',
    () =>
      Story.story(
        COOP,
        withBones(150),
        pickerUp,
        tapCard('TrackStar'),
        tapBuy,
        Story.expectOutMessage(
          OutMessage.BoughtCalling({ calling: 'TrackStar' }),
        ),
        Story.inMessage(
          InMessage.RequestedBoughtHero({
            calling: 'TrackStar',
            bought: ['hero:Handyman', 'hero:TrackStar'],
            bones: 50,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedMemberCalling({ calling: 'TrackStar' }),
          }),
          Message.CompletedChangeLobby(),
        ),
        focusPill,
        Story.model(current => {
          expect(current.calling).toBe('TrackStar')
          expect(current.bones).toBe(50)
          expect(isUp(current)).toBe(false)
          expect(tryingOf(current)).toEqual(Option.none())
        }),
        tapBuy,
        Story.expectNoOutMessage(),
      ),
  )

  it.effect('too few Bones, and BUY sends nothing', () =>
    Story.story(
      COOP,
      withBones(99),
      pickerUp,
      tapCard('TrackStar'),
      tapBuy,
      Story.expectNoOutMessage(),
      Story.model(current => {
        expect(tryingOf(current)).toEqual(Option.some('TrackStar'))
      }),
    ),
  )

  it.effect('a hero below your rank stays shut', () =>
    Story.story(
      COOP,
      withBones(1000),
      pickerUp,
      tapCard('PennyPincher'),
      Story.expectNoOutMessage(),
      Story.model(current => {
        expect(tryingOf(current)).toEqual(Option.none())
      }),
      tapBuy,
      Story.expectNoOutMessage(),
    ),
  )

  it.effect('closing the picker, or the room starting, ends the try-on', () =>
    Effect.all([
      Story.story(
        COOP,
        withBones(150),
        pickerUp,
        tapCard('TrackStar'),
        Story.messageIn(
          HeroPickerBinding,
          HeroPickerMessage.ClickedCloseButton(),
        ),
        Story.model(current => {
          expect(tryingOf(current)).toEqual(Option.none())
          expect(isUp(current)).toBe(false)
        }),
      ),
      Story.story(
        COOP,
        withBones(150),
        pickerUp,
        tapCard('TrackStar'),
        Story.message(lobbyUpdate({ ...lobbyAt, status: 'Playing' })),
        Story.model(current => {
          expect(tryingOf(current)).toEqual(Option.none())
        }),
      ),
    ]),
  )
})

describe('tapping a difficulty in the lobby', () => {
  const lobbyAt = lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')])
  const lobbied = Story.message(lobbyUpdate(lobbyAt))

  it.effect('the host changes it, and the room is told', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      lobbied,
      Story.message(Message.ClickedDifficultyPick({ difficulty: 'Hard' })),
      Story.Command.resolve(
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

  it.effect('a guest tap changes nothing but tells them the host picks', () =>
    Story.story(
      COOP,
      Story.given(inRoom(1)),
      lobbied,
      Story.message(Message.ClickedPickNudge({ reason: 'HostPicks' })),
      Story.Command.expectNone(),
      Story.model(current => {
        expect(roomOf(current).maybeNudge).toEqual(
          Option.some({ reason: 'HostPicks', count: 1 }),
        )
      }),
      Story.message(Message.ClickedPickNudge({ reason: 'HostPicks' })),
      Story.model(current => {
        expect(roomOf(current).maybeNudge).toEqual(
          Option.some({ reason: 'HostPicks', count: 2 }),
        )
      }),
    ),
  )

  it.effect(
    'the host on a locked Nightmare is told why, and nothing is sent',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(0)),
        lobbied,
        Story.message(
          Message.ClickedDifficultyPick({ difficulty: 'Nightmare' }),
        ),
        Story.message(Message.ClickedPickNudge({ reason: 'Locked' })),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(roomOf(current).maybeNudge).toEqual(
            Option.some({ reason: 'Locked', count: 1 }),
          )
          expect(
            Option.map(roomOf(current).maybeLobby, lobby => lobby.difficulty),
          ).toEqual(Option.some('Normal'))
        }),
      ),
  )
})

describe('renaming yourself in the lobby', () => {
  const lobbyAt = lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')])
  const lobbied = Story.message(lobbyUpdate(lobbyAt))
  const opened = Story.steps(
    lobbied,
    Story.message(Message.ClickedNameButton()),
    resolveFocusCoop(),
  )
  const draftOf = (current: Model) => roomOf(current).maybeNameDraft
  const nameOf = (current: Model) => Option.getOrThrow(draftOf(current))

  it.effect('the name button opens the field, prefilled with your name', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      opened,
      Story.model(current => {
        expect(draftOf(current)).toEqual(Option.some('Ana'))
      }),
    ),
  )

  it.effect('typing cleans the draft as the Profile does', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      opened,
      Story.message(
        Message.UpdatedNameDraft({ value: '  Gravy   Dave and more' }),
      ),
      Story.model(current => {
        expect(draftOf(current)).toEqual(Option.some('Gravy Dave a'))
      }),
    ),
  )

  it.effect(
    'saving sends the room and the parent the cleaned name, READY stays',
    () =>
      Story.story(
        COOP,
        Story.given(inRoom(0)),
        opened,
        Story.message(Message.UpdatedNameDraft({ value: 'Gravy Dave ' })),
        Story.message(Message.SubmittedName()),
        Story.expectOutMessage(OutMessage.ChoseName({ name: 'Gravy Dave' })),
        Story.Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedMemberName({ name: 'Gravy Dave' }),
          }),
          Message.CompletedChangeLobby(),
        ),
        resolveFocusCoop(),
        Story.model(current => {
          expect(draftOf(current)).toEqual(Option.none())
          expect(current.name).toBe('Gravy Dave')
        }),
      ),
  )

  it.effect(
    'an empty name, or the one already worn, only closes the field',
    () =>
      Effect.forEach(['   ', 'Ana'], value =>
        Story.story(
          COOP,
          Story.given(inRoom(0)),
          opened,
          Story.message(Message.UpdatedNameDraft({ value })),
          Story.message(Message.SubmittedName()),
          Story.expectNoOutMessage(),
          resolveFocusCoop(),
          Story.Command.expectNone(),
          Story.model(current => {
            expect(draftOf(current)).toEqual(Option.none())
          }),
        ),
      ),
  )

  it.effect('Escape and the X cancel, and send nothing', () =>
    Effect.forEach(
      [pressed('Escape'), Story.message(Message.ClickedNameCancel())],
      cancel =>
        Story.story(
          COOP,
          Story.given(inRoom(0)),
          opened,
          Story.message(Message.UpdatedNameDraft({ value: 'Nope' })),
          cancel,
          Story.expectNoOutMessage(),
          resolveFocusCoop(),
          Story.model(current => {
            expect(draftOf(current)).toEqual(Option.none())
            expect(current.name).toBe(onHub.name)
          }),
        ),
    ),
  )

  it.effect('the dice put a goofy name in the field, a new one each roll', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      opened,
      Story.message(Message.ClickedNameDice()),
      resolveFocusCoop(),
      Story.model(current => {
        expect(GOOFY_NAMES).toContain(nameOf(current))
        expect(current.name).toBe(onHub.name)
      }),
      Story.models(
        Story.steps(
          Story.message(Message.ClickedNameDice()),
          resolveFocusCoop(),
        ),
        (first: Model, second: Model) => {
          expect(GOOFY_NAMES).toContain(nameOf(second))
          expect(nameOf(second)).not.toBe(nameOf(first))
        },
      ),
    ),
  )

  it.effect('other lobby keys wait while the field is open', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      opened,
      pressed('Enter'),
      Story.Command.expectNone(),
      pressed('KeyE'),
      Story.Command.expectNone(),
    ),
  )

  it.effect('a started run closes the field', () =>
    Story.story(
      COOP,
      Story.given(inRoom(0)),
      opened,
      Story.message(lobbyUpdate({ ...lobbyAt, status: 'Playing' })),
      Story.model(current => {
        expect(draftOf(current)).toEqual(Option.none())
      }),
    ),
  )
})
