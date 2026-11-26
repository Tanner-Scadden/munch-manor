import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import {
  callingUnlocksAt,
  hasUnseenLook,
  lookUnlocksAt,
} from '#domain/unlocks.ts'
import { chooseCalling } from '#features/heroes/callingPick.ts'
import { LobbyMessage } from '#features/lobby/message.ts'
import { homeAfterRead } from '#test/model.fixture.ts'
import {
  checkModel,
  resolveFocusLobby,
  send,
  storyOf,
  writeSave,
} from '#test/testing.ts'
import { noRank, pointsForRank } from '#world/heroes/rank.ts'

const reached = UiStruct.evolve(homeAfterRead, {
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
    Effect.gen(function* () {
      const s = yield* storyOf(reached)
      s.pipe(
        send(Message.ClickedCharacterButton()),
        writeSave,
        send(Message.ChoseProfileLook({ part: 'ShirtColor', value: 'Gold' })),
        checkModel(current => {
          expect(current.appearance.shirtColor).toBe('Gold')
          expect(current.freshUnlocks).not.toContain('shirt:Gold')
          expect(current.freshUnlocks).toContain('hat:TrafficCone')
          expect(current.seenUnlocks).toContain('shirt:Gold')
        }),
        writeSave,
      )
    }),
  )

  test('a hero picked clears its badge', () => {
    const fresh = UiStruct.evolve(reached, {
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
      Effect.gen(function* () {
        const s = yield* storyOf(reached)
        s.pipe(
          send(Message.ClickedCharacterButton()),
          checkModel(current => {
            expect(current.freshUnlocks).toContain('shirt:Gold')
            expect(current.freshUnlocks).toContain('hat:TrafficCone')
            expect(current.freshUnlocks).not.toContain('hat:PartyHat')
            expect(current.freshUnlocks).not.toContain('calling:Handyman')
            expect(current.seenUnlocks).toContain('shirt:Gold')
            expect(hasUnseenLook(16, current.seenUnlocks)).toBe(false)
          }),
          writeSave,
        )
      }),
  )

  it.effect('shows nothing the next time', () => {
    const seen = UiStruct.evolve(reached, {
      seenUnlocks: () => [...lookUnlocksAt(16)],
    })
    return Effect.gen(function* () {
      const s = yield* storyOf(seen)
      s.pipe(
        send(Message.ClickedCharacterButton()),
        checkModel(current => {
          expect(current.freshUnlocks).toEqual([])
        }),
      )
    })
  })
})

describe('opening the picker', () => {
  it.effect('marks the callings reached as seen and badges them', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(reached)
      s.pipe(
        send(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        send(LobbyMessage.RequestedLobbyHeroPicker()),
        checkModel(current => {
          expect(current.freshUnlocks).toContain('calling:LineCook')
          expect(current.freshUnlocks).not.toContain('shirt:Gold')
          expect(current.seenUnlocks).toContain('calling:LineCook')
          expect(current.seenUnlocks).not.toContain('shirt:Gold')
        }),
        writeSave,
      )
    }),
  )
})
