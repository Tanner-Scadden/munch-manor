import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { LobbyBinding, ProfileBinding } from '../../app/bindings'
import { Message } from '../../app/message'
import { chooseCalling } from '../../features/heroes/callingPick'
import { Message as LobbyMessage } from '../../features/lobby/message'
import * as Character from '../../features/profile/blocks/look/block'
import { CharacterBinding } from '../../features/profile/composition'
import { homeAfterRead } from '../../test/model.fixture'
import {
  APPLICATION,
  resolveFocusLobby,
  showDialog,
  writeSave,
} from '../../test/testing'
import { noRank, pointsForRank } from '../../world/heroes/rank'
import { callingUnlocksAt, hasUnseenLook, lookUnlocksAt } from '../unlocks'

// NEW badges (src/domain/unlocks.ts): what a rank reached and the player has not
// seen wears a badge while the Look tab or the picker is open, and is marked
// seen on opening, with no click on the item.

const reached = modifyFields(homeAfterRead, {
  rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
  seenUnlocks: () => ['hat:PartyHat'],
  boughtCosmetics: () => ['hero:Handyman'],
})

describe('the unlocks reached', () => {
  test('are the gifts and callings at or under the rank, never YOU', () => {
    expect(lookUnlocksAt(1)).toEqual([])
    expect(lookUnlocksAt(2)).toEqual(['hat:PartyHat'])
    expect(lookUnlocksAt(16)).toContain('shirt:Gold')
    expect(lookUnlocksAt(16)).not.toContain('print:Polka')
    expect(callingUnlocksAt(1)).toEqual([])
    expect(callingUnlocksAt(6)).toEqual([
      'calling:Handyman',
      'calling:TrackStar',
    ])
  })

  test('make a pip while any is unseen', () => {
    expect(hasUnseenLook(16, ['hat:PartyHat'])).toBe(true)
    expect(hasUnseenLook(2, ['hat:PartyHat'])).toBe(false)
  })
})

describe('picking an unlock', () => {
  it.effect('clears its own badge at once and leaves the other badges', () =>
    Story.story(
      APPLICATION,
      Story.given(reached),
      Story.message(Message.ClickedCharacterButton()),
      showDialog(),
      writeSave(),
      Story.messageIn(
        [ProfileBinding, CharacterBinding],
        Character.Message.ClickedGearOption({
          part: 'ShirtColor',
          value: 'Gold',
        }),
      ),
      Story.model(current => {
        expect(current.appearance.shirtColor).toBe('Gold')
        expect(current.freshUnlocks).not.toContain('shirt:Gold')
        expect(current.freshUnlocks).toContain('hat:TrafficCone')
        expect(current.seenUnlocks).toContain('shirt:Gold')
      }),
      writeSave(),
    ),
  )

  test('a hero picked clears its badge', () => {
    const fresh = modifyFields(reached, {
      freshUnlocks: () => ['calling:Handyman', 'calling:TrackStar'],
    })
    const after = chooseCalling(fresh, 'Handyman')
    expect(after.calling).toBe('Handyman')
    expect(after.freshUnlocks).toEqual(['calling:TrackStar'])
  })
})

describe('opening the Look tab', () => {
  it.effect(
    'marks what is unseen as seen, keeps the badges for this viewing, and writes it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(reached),
        Story.message(Message.ClickedCharacterButton()),
        showDialog(),
        Story.model(current => {
          expect(current.freshUnlocks).toContain('shirt:Gold')
          expect(current.freshUnlocks).toContain('hat:TrafficCone')
          expect(current.freshUnlocks).not.toContain('hat:PartyHat')
          expect(current.freshUnlocks).not.toContain('calling:Handyman')
          expect(current.seenUnlocks).toContain('shirt:Gold')
          expect(hasUnseenLook(16, current.seenUnlocks)).toBe(false)
        }),
        writeSave(),
      ),
  )

  it.effect('shows nothing the next time', () => {
    const seen = modifyFields(reached, {
      seenUnlocks: () => [...lookUnlocksAt(16)],
    })
    return Story.story(
      APPLICATION,
      Story.given(seen),
      Story.message(Message.ClickedCharacterButton()),
      showDialog(),
      Story.model(current => {
        expect(current.freshUnlocks).toEqual([])
      }),
    )
  })
})

describe('opening the picker', () => {
  it.effect('marks the callings reached as seen and badges them', () =>
    Story.story(
      APPLICATION,
      Story.given(reached),
      Story.message(Message.ClickedPlayButton()),
      resolveFocusLobby(),
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedHeroButton()),
      showDialog(),
      Story.model(current => {
        expect(current.freshUnlocks).toContain('calling:LineCook')
        expect(current.freshUnlocks).not.toContain('shirt:Gold')
        expect(current.seenUnlocks).toContain('calling:LineCook')
        expect(current.seenUnlocks).not.toContain('shirt:Gold')
      }),
      writeSave(),
    ),
  )
})
