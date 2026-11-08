import { Array, Effect, Option } from 'effect'
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  inMessage,
  message,
  messageIn,
  model,
  story,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import type { Calling } from '../../../shared/playerData'
import { roomSettingsOf } from '../../../world/net/roomWorld'
import { Message as HeroPickerMessage } from '../../heroes/message'
import { isPickerOpen } from '../../heroes/model'
import { GOOFY_NAMES } from '../../profile/profile'
import { HeroPickerBinding } from '../bindings'
import { CoopBlock } from '../block'
import { InMessage } from '../inMessage'
import { CoopLayer } from '../layer'
import { Message, OutMessage } from '../message'
import { LobbyChange, type Model } from '../model'
import { update } from '../pureCoop'
import { CALLING_PILL_ID } from '../roomState'
import { ChangeLobby, FocusCoopElement } from '../steps'
import { lobbyOf, memberOf } from '../testing'
import { pressKey } from '../update'
import { inRoom, lobbyUpdate, picked, roomOf } from './story.fixture'

const CO_OP = { block: CoopBlock, layer: CoopLayer }

const pressed = (code: string) =>
  inMessage(InMessage.RequestedPressKey({ code }))

const tapCard = (calling: Calling) =>
  messageIn(HeroPickerBinding, HeroPickerMessage.ClickedCard({ calling }))

const tapBuy = messageIn(
  HeroPickerBinding,
  HeroPickerMessage.ClickedBuyButton(),
)

const isUp = (current: Model): boolean => isPickerOpen(current.heroPicker)

const focusPill = Command.resolve(
  FocusCoopElement({ id: CALLING_PILL_ID }),
  Message.CompletedFocusCoopElement(),
)

describe('picking a hero in the lobby', () => {
  const ANA_RANK_4 = memberOf(0, 'Ana', true, '', false, 4)
  const BO = memberOf(1, 'Bo')
  const lobbyAt4 = lobbyOf([ANA_RANK_4, BO])
  const lobbied = (): Model => update(inRoom(0), lobbyUpdate(lobbyAt4)).model

  it.effect('the pill and Y open the picker, and Y or Escape close it', () =>
    story(
      CO_OP,
      given(lobbied()),
      model(current => {
        expect(isUp(current)).toBe(false)
      }),
      pressed('KeyY'),
      model(current => {
        expect(isUp(current)).toBe(true)
      }),
      pressed('KeyY'),
      model(current => {
        expect(isUp(current)).toBe(false)
      }),
      message(Message.ClickedCallingPill()),
      model(current => {
        expect(isUp(current)).toBe(true)
      }),
      pressed('Escape'),
      model(current => {
        expect(isUp(current)).toBe(false)
      }),
    ),
  )

  it.effect('Enter and the picks wait while it is open', () =>
    story(
      CO_OP,
      given(lobbied()),
      message(Message.ClickedCallingPill()),
      pressed('Enter'),
      pressed('KeyE'),
      Command.expectNone(),
      model(current => {
        expect(isUp(current)).toBe(true)
      }),
    ),
  )

  it.effect(
    'a hero the rank reached goes to the lobby and the parent, and READY stays',
    () =>
      story(
        CO_OP,
        given(lobbied()),
        message(Message.ClickedCallingPill()),
        tapCard('Handyman'),
        expectOutMessage(OutMessage.ChoseCalling({ calling: 'Handyman' })),
        Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedMemberCalling({ calling: 'Handyman' }),
          }),
          Message.CompletedChangeLobby(),
        ),
        focusPill,
        model(current => {
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
      story(
        CO_OP,
        given(lobbied()),
        message(Message.ClickedCallingPill()),
        tapCard('LineCook'),
        Command.expectNone(),
        expectNoOutMessage(),
        model(current => {
          expect(isUp(current)).toBe(true)
        }),
        tapCard('You'),
        expectNoOutMessage(),
        focusPill,
        model(current => {
          expect(isUp(current)).toBe(false)
        }),
      ),
  )

  test('a hero changed in the lobby is the one the start seats', () => {
    const changed = update(
      lobbied(),
      lobbyUpdate({
        ...lobbyAt4,
        members: [{ ...ANA_RANK_4, calling: 'Handyman' }, BO],
      }),
    ).model
    const lobby = Option.getOrThrow(roomOf(changed).maybeLobby)
    expect(
      roomSettingsOf('Campaign', 'Normal', lobby.members).callings,
    ).toEqual([
      { slot: 0, calling: 'Handyman' },
      { slot: 1, calling: 'You' },
    ])
  })

  it.effect('a started run closes the picker', () =>
    story(
      CO_OP,
      given(lobbied()),
      message(Message.ClickedCallingPill()),
      message(lobbyUpdate({ ...lobbyAt4, status: 'Playing' })),
      model(current => {
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
  const lobbied = (bones: number): Model =>
    modifyFields(update(inRoom(0), lobbyUpdate(lobbyAt)).model, {
      bones: () => bones,
    })
  const pickerWith = (bones: number) =>
    given(update(lobbied(bones), Message.ClickedCallingPill()).model)
  const tryingOf = (current: Model) => current.heroPicker.maybeTrying

  it.effect(
    'a hero for sale is tried on, not picked, and nothing is sent',
    () =>
      story(
        CO_OP,
        pickerWith(150),
        tapCard('TrackStar'),
        expectNoOutMessage(),
        Command.expectNone(),
        model(current => {
          expect(tryingOf(current)).toEqual(Option.some('TrackStar'))
          expect(isUp(current)).toBe(true)
          expect(current.calling).toBe('You')
        }),
      ),
  )

  it.effect(
    'BUY asks the parent to spend the Bones, once, and the answer picks the hero',
    () =>
      story(
        CO_OP,
        pickerWith(150),
        tapCard('TrackStar'),
        tapBuy,
        expectOutMessage(OutMessage.BoughtCalling({ calling: 'TrackStar' })),
        inMessage(
          InMessage.RequestedBoughtHero({
            calling: 'TrackStar',
            bought: ['hero:Handyman', 'hero:TrackStar'],
            bones: 50,
          }),
        ),
        expectNoOutMessage(),
        Command.resolve(
          ChangeLobby({
            change: LobbyChange.ChangedMemberCalling({ calling: 'TrackStar' }),
          }),
          Message.CompletedChangeLobby(),
        ),
        focusPill,
        model(current => {
          expect(current.calling).toBe('TrackStar')
          expect(current.bones).toBe(50)
          expect(isUp(current)).toBe(false)
          expect(tryingOf(current)).toEqual(Option.none())
        }),
        tapBuy,
        expectNoOutMessage(),
      ),
  )

  it.effect('too few Bones, and BUY sends nothing', () =>
    story(
      CO_OP,
      pickerWith(99),
      tapCard('TrackStar'),
      tapBuy,
      expectNoOutMessage(),
      model(current => {
        expect(tryingOf(current)).toEqual(Option.some('TrackStar'))
      }),
    ),
  )

  it.effect('a hero below your rank stays shut', () =>
    story(
      CO_OP,
      pickerWith(1000),
      tapCard('PennyPincher'),
      expectNoOutMessage(),
      model(current => {
        expect(tryingOf(current)).toEqual(Option.none())
      }),
      tapBuy,
      expectNoOutMessage(),
    ),
  )

  it.effect('closing the picker, or the room starting, ends the try-on', () =>
    Effect.all([
      story(
        CO_OP,
        pickerWith(150),
        tapCard('TrackStar'),
        messageIn(HeroPickerBinding, HeroPickerMessage.ClickedCloseButton()),
        model(current => {
          expect(tryingOf(current)).toEqual(Option.none())
          expect(isUp(current)).toBe(false)
        }),
      ),
      story(
        CO_OP,
        pickerWith(150),
        tapCard('TrackStar'),
        message(lobbyUpdate({ ...lobbyAt, status: 'Playing' })),
        model(current => {
          expect(tryingOf(current)).toEqual(Option.none())
        }),
      ),
    ]),
  )
})

describe('tapping a difficulty in the lobby', () => {
  const lobbyAt = lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')])
  const as = (slot: number): Model =>
    update(inRoom(slot), lobbyUpdate(lobbyAt)).model
  const changes = (result: {
    commands?: ReadonlyArray<{ name: string }> | undefined
  }) => Array.map(result.commands ?? [], command => command.name)

  test('the host changes it, and the room is told', () => {
    story(
      update,
      given(as(0)),
      message(Message.ClickedDifficultyPick({ difficulty: 'Hard' })),
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

  test('a guest tap changes nothing but tells them the host picks', () => {
    const tapped = update(
      as(1),
      Message.ClickedPickNudge({ reason: 'HostPicks' }),
    )
    expect(changes(tapped)).toEqual([])
    expect(roomOf(tapped.model).maybeNudge).toEqual(
      Option.some({ reason: 'HostPicks', count: 1 }),
    )
    const again = update(
      tapped.model,
      Message.ClickedPickNudge({ reason: 'HostPicks' }),
    )
    expect(roomOf(again.model).maybeNudge).toEqual(
      Option.some({ reason: 'HostPicks', count: 2 }),
    )
  })

  test('the host on a locked Nightmare is told why, and nothing is sent', () => {
    const tapped = update(
      update(as(0), Message.ClickedDifficultyPick({ difficulty: 'Nightmare' }))
        .model,
      Message.ClickedPickNudge({ reason: 'Locked' }),
    )
    expect(changes(tapped)).toEqual([])
    expect(roomOf(tapped.model).maybeNudge).toEqual(
      Option.some({ reason: 'Locked', count: 1 }),
    )
    expect(
      Option.map(roomOf(tapped.model).maybeLobby, lobby => lobby.difficulty),
    ).toEqual(Option.some('Normal'))
  })
})

describe('renaming yourself in the lobby', () => {
  const lobbyAt = lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')])
  const lobbied = (): Model => update(inRoom(0), lobbyUpdate(lobbyAt)).model
  const opened = (): Model =>
    update(lobbied(), Message.ClickedNameButton()).model
  const draftOf = (current: Model) => roomOf(current).maybeNameDraft

  test('the name button opens the field, prefilled with your name', () => {
    story(
      update,
      given(lobbied()),
      message(Message.ClickedNameButton()),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      model(current => {
        expect(draftOf(current)).toEqual(Option.some('Ana'))
      }),
    )
  })

  test('typing cleans the draft as the Profile does', () => {
    const typed = update(
      opened(),
      Message.UpdatedNameDraft({ value: '  Gravy   Dave and more' }),
    ).model
    expect(draftOf(typed)).toEqual(Option.some('Gravy Dave a'))
  })

  test('saving sends the room and the parent the cleaned name, READY stays', () => {
    story(
      update,
      given(opened()),
      message(Message.UpdatedNameDraft({ value: 'Gravy Dave ' })),
      message(Message.SubmittedName()),
      expectOutMessage(OutMessage.ChoseName({ name: 'Gravy Dave' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.ChangedMemberName({ name: 'Gravy Dave' }),
        }),
        Message.CompletedChangeLobby(),
      ),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      model(current => {
        expect(draftOf(current)).toEqual(Option.none())
        expect(current.name).toBe('Gravy Dave')
      }),
    )
  })

  test('an empty name, or the one already worn, only closes the field', () => {
    for (const value of ['   ', 'Ana']) {
      const submitted = update(
        update(opened(), Message.UpdatedNameDraft({ value })).model,
        Message.SubmittedName(),
      )
      expect(draftOf(submitted.model)).toEqual(Option.none())
      expect(submitted.outMessage).toBeUndefined()
      expect(
        Array.map(submitted.commands ?? [], command => command.name),
      ).not.toContain(ChangeLobby.name)
    }
  })

  test('Escape and the X cancel, and send nothing', () => {
    const typed = update(
      opened(),
      Message.UpdatedNameDraft({ value: 'Nope' }),
    ).model
    for (const cancelled of [
      pressKey(typed, 'Escape'),
      update(typed, Message.ClickedNameCancel()),
    ]) {
      expect(draftOf(cancelled.model)).toEqual(Option.none())
      expect(cancelled.outMessage).toBeUndefined()
      expect(cancelled.model.name).toBe(typed.name)
    }
  })

  test('the dice put a goofy name in the field, a new one each roll', () => {
    const first = update(opened(), Message.ClickedNameDice()).model
    const second = update(first, Message.ClickedNameDice()).model
    const name = (current: Model) => Option.getOrThrow(draftOf(current))
    expect(GOOFY_NAMES).toContain(name(first))
    expect(GOOFY_NAMES).toContain(name(second))
    expect(name(second)).not.toBe(name(first))
    expect(first.name).toBe(lobbied().name)
  })

  test('other lobby keys wait while the field is open', () => {
    expect(pressKey(opened(), 'Enter').commands).toBeUndefined()
    expect(picked(opened(), 'KeyE')).toEqual([])
  })

  test('a started run closes the field', () => {
    const started = update(
      opened(),
      lobbyUpdate({ ...lobbyAt, status: 'Playing' }),
    )
    expect(draftOf(started.model)).toEqual(Option.none())
  })
})
