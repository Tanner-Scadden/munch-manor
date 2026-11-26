import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { LobbyChange } from '../../../domain/coopRoom'
import { GOOFY_NAMES } from '../../../domain/playerName'
import type { Calling } from '../../../shared/playerData'
import { pointsForRank } from '../../../shared/rankCurve'
import {
  type StoryStep,
  checkModel,
  press,
  resolveFocusCoop,
  send,
  steps,
  storyOf,
} from '../../../test/testing'
import { bonesBalanceOf } from '../../../world/heroes/rank'
import { roomSettingsOf } from '../../../world/net/roomWorld'
import { CoopMessage } from '../message'
import { lobbyOf, memberOf } from '../testing'
import { updateCoop } from '../update'
import {
  inRoom,
  inRoomCoop,
  lobbyChanged,
  lobbyUpdate,
  onHub,
  roomOf,
} from './story.fixture'

const tapCard = (calling: Calling): StoryStep =>
  send(Message.PickedCoopHero({ calling }))

const tapBuy: StoryStep = send(
  Message.RequestedBuyCoopHero({ calling: 'TrackStar' }),
)

const closePicker: StoryStep = send(Message.RequestedCloseCoopHeroPicker())

const isUp = (current: Model): boolean => current.coop.heroPick.isOpen

const tellsNothing =
  (message: CoopMessage): StoryStep =>
  s => {
    expect(updateCoop(message)(s.model.coop).notice).toBeUndefined()
    return s
  }

describe('picking a hero in the lobby', () => {
  const ANA_RANK_4 = memberOf(0, 'Ana', true, '', false, 4)
  const BO = memberOf(1, 'Bo')
  const lobbyAt4 = lobbyOf([ANA_RANK_4, BO])
  const lobbied = send(lobbyUpdate(lobbyAt4))

  it.effect('the pill and Y open the picker, and its close keys shut it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        lobbied,
        checkModel(current => {
          expect(isUp(current)).toBe(false)
        }),
        press('KeyY'),
        checkModel(current => {
          expect(isUp(current)).toBe(true)
        }),
        press('KeyY'),
        checkModel(current => {
          expect(isUp(current)).toBe(true)
        }),
        closePicker,
        checkModel(current => {
          expect(isUp(current)).toBe(false)
        }),
        send(Message.ClickedCoopCallingPill()),
        checkModel(current => {
          expect(isUp(current)).toBe(true)
        }),
        press('Escape'),
        checkModel(current => {
          expect(isUp(current)).toBe(true)
        }),
        closePicker,
        checkModel(current => {
          expect(isUp(current)).toBe(false)
        }),
      )
    }),
  )

  it.effect('Enter and the picks wait while it is open', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        lobbied,
        send(Message.ClickedCoopCallingPill()),
        press('Enter'),
        press('KeyE'),
      ).expectNone()
      expect(isUp(s.model)).toBe(true)
    }),
  )

  it.effect(
    'a hero the rank reached goes to the lobby and the root, and READY stays',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inRoom(0))
        s.pipe(
          lobbied,
          send(Message.ClickedCoopCallingPill()),
          tapCard('Handyman'),
          lobbyChanged(
            LobbyChange.ChangedMemberCalling({ calling: 'Handyman' }),
          ),
          resolveFocusCoop,
          checkModel(current => {
            expect(isUp(current)).toBe(false)
            expect(current.coop.calling).toBe('Handyman')
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
        )
      }),
  )

  it.effect(
    'a hero the rank has not reached, or the one already worn, sends nothing',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inRoom(0))
        s.pipe(
          lobbied,
          send(Message.ClickedCoopCallingPill()),
          tellsNothing(CoopMessage.PickedCoopHero({ calling: 'LineCook' })),
          tapCard('LineCook'),
        ).expectNone()
        expect(isUp(s.model)).toBe(true)
        expect(s.model.calling).toBe(onHub.calling)
        s.pipe(
          tellsNothing(CoopMessage.PickedCoopHero({ calling: 'You' })),
          tapCard('You'),
          resolveFocusCoop,
          checkModel(current => {
            expect(isUp(current)).toBe(false)
            expect(current.calling).toBe(onHub.calling)
          }),
        )
      }),
  )

  it.effect('a hero changed in the lobby is the one the start seats', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        lobbied,
        send(
          lobbyUpdate({
            ...lobbyAt4,
            members: [{ ...ANA_RANK_4, calling: 'Handyman' }, BO],
          }),
        ),
        checkModel(changed => {
          const lobby = Option.getOrThrow(roomOf(changed).maybeLobby)
          expect(
            roomSettingsOf('Campaign', 'Normal', lobby.members).callings,
          ).toEqual([
            { slot: 0, calling: 'Handyman' },
            { slot: 1, calling: 'You' },
          ])
        }),
      )
    }),
  )

  it.effect('a started run closes the picker', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        lobbied,
        send(Message.ClickedCoopCallingPill()),
        send(lobbyUpdate({ ...lobbyAt4, status: 'Playing' })),
        checkModel(current => {
          expect(isUp(current)).toBe(false)
        }),
      )
    }),
  )
})

describe('buying a hero in the lobby', () => {
  const ANA = memberOf(0, 'Ana', false, '', false, 7)
  const lobbyAt = lobbyOf([ANA, memberOf(1, 'Bo')])
  const withBones = (bones: number): Model =>
    UiStruct.evolve(inRoom(0), {
      coop: () => UiStruct.evolve(inRoomCoop(0), { bones: () => bones }),
      rank: rank =>
        UiStruct.evolve(rank, {
          earnedPoints: () => pointsForRank(7),
          earnedBones: () => bones,
        }),
    })
  const pickerUp: StoryStep = steps(
    send(lobbyUpdate(lobbyAt)),
    send(Message.ClickedCoopCallingPill()),
  )
  const tryingOf = (current: Model) => current.coop.heroPick.maybeTrying

  it.effect(
    'a hero for sale is tried on, not picked, and nothing is sent',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(withBones(150))
        s.pipe(
          pickerUp,
          tellsNothing(CoopMessage.PickedCoopHero({ calling: 'TrackStar' })),
          tapCard('TrackStar'),
        ).expectNone()
        expect(tryingOf(s.model)).toEqual(Option.some('TrackStar'))
        expect(isUp(s.model)).toBe(true)
        expect(s.model.coop.calling).toBe('You')
        expect(s.model.calling).toBe(onHub.calling)
      }),
  )

  it.effect(
    'BUY has the root spend the Bones, once, and the hero is picked',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(withBones(150))
        s.pipe(
          pickerUp,
          tapCard('TrackStar'),
          tapBuy,
          lobbyChanged(
            LobbyChange.ChangedMemberCalling({ calling: 'TrackStar' }),
          ),
          resolveFocusCoop,
        )
        expect(bonesBalanceOf(s.model.rank)).toBe(50)
        expect(s.model.boughtCosmetics).toContain('hero:TrackStar')
        expect(s.model.calling).toBe('TrackStar')
        s.pipe(
          checkModel(current => {
            expect(current.coop.calling).toBe('TrackStar')
            expect(current.coop.bones).toBe(50)
            expect(isUp(current)).toBe(false)
            expect(tryingOf(current)).toEqual(Option.none())
          }),
          tellsNothing(
            CoopMessage.RequestedBuyCoopHero({ calling: 'TrackStar' }),
          ),
          tapBuy,
        ).expectNone()
        expect(bonesBalanceOf(s.model.rank)).toBe(50)
      }),
  )

  it.effect('too few Bones, and BUY sends nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withBones(99))
      s.pipe(
        pickerUp,
        tapCard('TrackStar'),
        tellsNothing(
          CoopMessage.RequestedBuyCoopHero({ calling: 'TrackStar' }),
        ),
        tapBuy,
      ).expectNone()
      expect(tryingOf(s.model)).toEqual(Option.some('TrackStar'))
      expect(bonesBalanceOf(s.model.rank)).toBe(99)
    }),
  )

  it.effect('a hero below your rank stays shut', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withBones(1000))
      s.pipe(
        pickerUp,
        tellsNothing(CoopMessage.PickedCoopHero({ calling: 'PennyPincher' })),
        tapCard('PennyPincher'),
      ).expectNone()
      expect(tryingOf(s.model)).toEqual(Option.none())
      s.pipe(
        tellsNothing(
          CoopMessage.RequestedBuyCoopHero({ calling: 'PennyPincher' }),
        ),
        send(Message.RequestedBuyCoopHero({ calling: 'PennyPincher' })),
      ).expectNone()
      expect(bonesBalanceOf(s.model.rank)).toBe(1000)
    }),
  )

  it.effect('closing the picker, or the room starting, ends the try-on', () =>
    Effect.gen(function* () {
      const closed = yield* storyOf(withBones(150))
      closed.pipe(
        pickerUp,
        tapCard('TrackStar'),
        closePicker,
        checkModel(current => {
          expect(tryingOf(current)).toEqual(Option.none())
          expect(isUp(current)).toBe(false)
        }),
      )
      const started = yield* storyOf(withBones(150))
      started.pipe(
        pickerUp,
        tapCard('TrackStar'),
        send(lobbyUpdate({ ...lobbyAt, status: 'Playing' })),
        checkModel(current => {
          expect(tryingOf(current)).toEqual(Option.none())
        }),
      )
    }),
  )
})

describe('tapping a difficulty in the lobby', () => {
  const lobbyAt = lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')])
  const lobbied = send(lobbyUpdate(lobbyAt))

  it.effect('the host changes it, and the room is told', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        lobbied,
        send(Message.ClickedCoopDifficultyPick({ difficulty: 'Hard' })),
        lobbyChanged(
          LobbyChange.ChangedPicks({ mode: 'Campaign', difficulty: 'Hard' }),
        ),
      )
    }),
  )

  it.effect('a guest tap changes nothing but tells them the host picks', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(1))
      s.pipe(
        lobbied,
        send(Message.ClickedCoopPickNudge({ reason: 'HostPicks' })),
      ).expectNone()
      s.pipe(
        checkModel(current => {
          expect(roomOf(current).maybeNudge).toEqual(
            Option.some({ reason: 'HostPicks', count: 1 }),
          )
        }),
        send(Message.ClickedCoopPickNudge({ reason: 'HostPicks' })),
        checkModel(current => {
          expect(roomOf(current).maybeNudge).toEqual(
            Option.some({ reason: 'HostPicks', count: 2 }),
          )
        }),
      )
    }),
  )

  it.effect(
    'the host on a locked Nightmare is told why, and nothing is sent',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inRoom(0))
        s.pipe(
          lobbied,
          send(Message.ClickedCoopDifficultyPick({ difficulty: 'Nightmare' })),
          send(Message.ClickedCoopPickNudge({ reason: 'Locked' })),
        ).expectNone()
        expect(roomOf(s.model).maybeNudge).toEqual(
          Option.some({ reason: 'Locked', count: 1 }),
        )
        expect(
          Option.map(roomOf(s.model).maybeLobby, lobby => lobby.difficulty),
        ).toEqual(Option.some('Normal'))
      }),
  )
})

describe('renaming yourself in the lobby', () => {
  const lobbyAt = lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')])
  const lobbied = send(lobbyUpdate(lobbyAt))
  const opened: StoryStep = steps(
    lobbied,
    send(Message.ClickedCoopNameButton()),
    resolveFocusCoop,
  )
  const draftOf = (current: Model) => roomOf(current).maybeNameDraft
  const nameOf = (current: Model) => Option.getOrThrow(draftOf(current))

  it.effect('the name button opens the field, prefilled with your name', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        opened,
        checkModel(current => {
          expect(draftOf(current)).toEqual(Option.some('Ana'))
        }),
      )
    }),
  )

  it.effect('typing cleans the draft as the Profile does', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        opened,
        send(
          Message.UpdatedCoopNameDraft({ value: '  Gravy   Dave and more' }),
        ),
        checkModel(current => {
          expect(draftOf(current)).toEqual(Option.some('Gravy Dave a'))
        }),
      )
    }),
  )

  it.effect(
    'saving sends the room and the root the cleaned name, READY stays',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(inRoom(0))
        s.pipe(
          opened,
          send(Message.UpdatedCoopNameDraft({ value: 'Gravy Dave ' })),
          send(Message.SubmittedCoopName()),
          lobbyChanged(LobbyChange.ChangedMemberName({ name: 'Gravy Dave' })),
          resolveFocusCoop,
          checkModel(current => {
            expect(draftOf(current)).toEqual(Option.none())
            expect(current.coop.name).toBe('Gravy Dave')
            expect(current.playerName).toBe('Gravy Dave')
          }),
        )
      }),
  )

  it.effect(
    'an empty name, or the one already worn, only closes the field',
    () =>
      Effect.forEach(['   ', 'Ana'], value =>
        Effect.gen(function* () {
          const s = yield* storyOf(inRoom(0))
          s.pipe(
            opened,
            send(Message.UpdatedCoopNameDraft({ value })),
            tellsNothing(CoopMessage.SubmittedCoopName()),
            send(Message.SubmittedCoopName()),
            resolveFocusCoop,
          ).expectNone()
          expect(draftOf(s.model)).toEqual(Option.none())
          expect(s.model.playerName).toBe(onHub.playerName)
        }),
      ),
  )

  it.effect('Escape and the X cancel, and send nothing', () =>
    Effect.forEach(
      [press('Escape'), send(Message.ClickedCoopNameCancel())],
      cancel =>
        Effect.gen(function* () {
          const s = yield* storyOf(inRoom(0))
          s.pipe(
            opened,
            send(Message.UpdatedCoopNameDraft({ value: 'Nope' })),
            tellsNothing(CoopMessage.ClickedCoopNameCancel()),
            cancel,
            resolveFocusCoop,
            checkModel(current => {
              expect(draftOf(current)).toEqual(Option.none())
              expect(current.coop.name).toBe(onHub.coop.name)
              expect(current.playerName).toBe(onHub.playerName)
            }),
          ).expectNone()
        }),
    ),
  )

  it.effect('the dice put a goofy name in the field, a new one each roll', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        opened,
        send(Message.ClickedCoopNameDice()),
        resolveFocusCoop,
        checkModel(current => {
          expect(GOOFY_NAMES).toContain(nameOf(current))
          expect(current.coop.name).toBe(onHub.coop.name)
        }),
      )
      const first = s.model
      s.pipe(send(Message.ClickedCoopNameDice()), resolveFocusCoop)
      expect(GOOFY_NAMES).toContain(nameOf(s.model))
      expect(nameOf(s.model)).not.toBe(nameOf(first))
    }),
  )

  it.effect('other lobby keys wait while the field is open', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(opened, press('Enter')).expectNone()
      s.pipe(press('KeyE')).expectNone()
    }),
  )

  it.effect('a started run closes the field', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(inRoom(0))
      s.pipe(
        opened,
        send(lobbyUpdate({ ...lobbyAt, status: 'Playing' })),
        checkModel(current => {
          expect(draftOf(current)).toEqual(Option.none())
        }),
      )
    }),
  )
})
