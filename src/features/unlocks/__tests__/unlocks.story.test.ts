import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { Message } from '../../../app/message'
import { Child, update } from '../../../app/pureApp'
import { WriteSave } from '../../../app/update/save'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { homeAfterRead } from '../../../test/model.fixture'
import { modelAfter, writeSave } from '../../../test/testing'
import { noRank, pointsForRank } from '../../../world/heroes/rank'
import { chooseCalling } from '../../heroes/callingPick'
import * as Character from '../../profile/blocks/look/block'
import { callingUnlocksAt, hasUnseenLook, lookUnlocksAt } from '../unlocks'

// NEW badges (src/features/unlocks/unlocks.ts): what a rank reached and the player has not
// seen wears a badge while the Look tab or the picker is open, and is marked
// seen on opening, with no click on the item.

const reached = modifyFields(homeAfterRead, {
  rank: () => ({ ...noRank, earnedPoints: pointsForRank(16) }),
  seenUnlocks: () => ['hat:PartyHat'],
  boughtCosmetics: () => ['hero:Handyman'],
})

const showDialog = () =>
  Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  )

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
  test('clears its own badge at once and leaves the other badges', () => {
    story(
      update,
      given(reached),
      message(Message.ClickedCharacterButton()),
      showDialog(),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      message(
        Child.character(
          Character.Message.ClickedGearOption({
            part: 'ShirtColor',
            value: 'Gold',
          }),
        ),
      ),
      model(current => {
        expect(current.appearance.shirtColor).toBe('Gold')
        expect(current.freshUnlocks).not.toContain('shirt:Gold')
        expect(current.freshUnlocks).toContain('hat:TrafficCone')
        expect(current.seenUnlocks).toContain('shirt:Gold')
      }),
      writeSave(),
    )
  })

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
  test('marks what is unseen as seen, keeps the badges for this viewing, and writes it', () => {
    story(
      update,
      given(reached),
      message(Message.ClickedCharacterButton()),
      showDialog(),
      model(current => {
        expect(current.freshUnlocks).toContain('shirt:Gold')
        expect(current.freshUnlocks).toContain('hat:TrafficCone')
        expect(current.freshUnlocks).not.toContain('hat:PartyHat')
        expect(current.freshUnlocks).not.toContain('calling:Handyman')
        expect(current.seenUnlocks).toContain('shirt:Gold')
        expect(hasUnseenLook(16, current.seenUnlocks)).toBe(false)
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('shows nothing the next time', () => {
    const seen = modifyFields(reached, {
      seenUnlocks: () => [...lookUnlocksAt(16)],
    })
    story(
      update,
      given(seen),
      message(Message.ClickedCharacterButton()),
      showDialog(),
      model(current => {
        expect(current.freshUnlocks).toEqual([])
      }),
    )
  })
})

describe('opening the picker', () => {
  test('marks the callings reached as seen and badges them', () => {
    const { model: current } = update(
      modelAfter(reached, Message.ClickedPlayButton()),
      Child.lobby(LobbyMessage.ClickedHeroButton()),
    )
    expect(current.freshUnlocks).toContain('calling:LineCook')
    expect(current.freshUnlocks).not.toContain('shirt:Gold')
    expect(current.seenUnlocks).toContain('calling:LineCook')
    expect(current.seenUnlocks).not.toContain('shirt:Gold')
  })
})
