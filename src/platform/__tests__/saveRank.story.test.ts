import { Array, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { initialModel } from '#app/pureApp.ts'
import { WriteSave } from '#app/update/save.ts'
import { PlayerChange } from '#platform/playerSync.ts'
import {
  type PlayerSave,
  SAVE_VERSION,
  decodeSave,
  restoreSave,
  saveOf,
} from '#platform/save.ts'
import { loadingSave } from '#test/model.fixture.ts'
import {
  checkModel,
  checkPendingArgs,
  finishSplash,
  jsonOf,
  modelAfter,
  send,
  steps,
  writeSave,
} from '#test/testing.ts'
import { noRank, pointsForRank } from '#world/heroes/rank.ts'
import { focusOf } from '#world/party/party.ts'

import { learnedSave } from './save.fixture.ts'

const loaded = (maybeSave: Option.Option<PlayerSave>) =>
  steps(send(Message.CompletedLoadSave({ maybeSave })), finishSplash)

const changesWritten = (
  check: (changes: ReadonlyArray<ReadonlyArray<PlayerChange>>) => void,
) =>
  checkPendingArgs(WriteSave)(writes =>
    check(Array.map(writes, ({ changes }) => changes)),
  )

describe('the veteran grant', () => {
  const beforeRank = (killsByKind: Record<string, number>) => {
    const { rank: _rank, ...rest } = learnedSave
    const json = jsonOf({
      ...rest,
      version: 12,
      bests: { ...learnedSave.bests, killsByKind },
    })
    return decodeSave(json)
  }

  it.effect(
    'a save from before rank is granted a point per kill, and writes the grant',
    () =>
      modelAfter(
        loadingSave,
        steps(
          loaded(beforeRank({ Shambler: 200, Runner: 141 })),
          checkModel(current => {
            expect(current.rank).toEqual({
              earnedPoints: 0,
              earnedBones: 0,
              veteranPoints: 341,
              veteranBones: 34,
              isVeteranGranted: true,
              spentBones: 0,
            })
          }),
          changesWritten(writes => {
            expect(writes).toEqual([
              [PlayerChange.GrantedVeteranRank({ points: 341, bones: 34 })],
            ])
          }),
          writeSave,
        ),
      ),
  )

  it.effect('the grant stops at the points for rank 10', () =>
    modelAfter(
      loadingSave,
      steps(
        loaded(beforeRank({ Shambler: 9000 })),
        checkModel(current => {
          expect(current.rank.veteranPoints).toBe(1170)
          expect(current.rank.veteranBones).toBe(117)
        }),
        writeSave,
      ),
    ),
  )

  it.effect('a save that was granted keeps its grant and writes nothing', () =>
    modelAfter(
      loadingSave,
      steps(
        loaded(Option.some(learnedSave)),
        checkModel(current => {
          expect(current.rank).toEqual(learnedSave.rank)
        }),
        s => s.expectNone(),
      ),
    ),
  )

  it.effect(
    'a new player is granted 0 once, so later kills never become a grant',
    () =>
      modelAfter(
        loadingSave,
        steps(
          loaded(Option.none()),
          checkModel(current => {
            expect(current.rank.isVeteranGranted).toBe(true)
            expect(current.rank.veteranPoints).toBe(0)
            const later = UiStruct.evolve(current, {
              bests: bests => UiStruct.evolve(bests, { totalKills: () => 500 }),
            })
            expect(saveOf(later).rank.veteranPoints).toBe(0)
          }),
          s => s.expectNone(),
        ),
      ),
  )
})

describe('the purses on load', () => {
  const atRank24: PlayerSave = {
    ...learnedSave,
    rank: { ...learnedSave.rank, earnedPoints: pointsForRank(24) },
    bonuses: { ...learnedSave.bonuses, purses: [] },
  }

  it.effect('a save past purse ranks is paid each once, and writes them', () =>
    modelAfter(
      loadingSave,
      steps(
        loaded(Option.some(atRank24)),
        checkModel(current => {
          expect(current.bonuses.purses).toEqual([21, 23, 24])
          expect(current.rank.earnedBones).toBe(
            atRank24.rank.earnedBones + 15 + 17 + 18,
          )
        }),
        changesWritten(writes => {
          expect(writes).toEqual([
            [
              PlayerChange.PaidRankPurse({ rank: 21 }),
              PlayerChange.PaidRankPurse({ rank: 23 }),
              PlayerChange.PaidRankPurse({ rank: 24 }),
            ],
          ])
        }),
        writeSave,
      ),
    ),
  )

  it.effect('a save that was paid loads as it was and writes nothing', () =>
    modelAfter(
      loadingSave,
      steps(
        loaded(
          Option.some({
            ...atRank24,
            bonuses: { ...atRank24.bonuses, purses: [21, 23, 24] },
          }),
        ),
        checkModel(current => {
          expect(current.rank.earnedBones).toBe(atRank24.rank.earnedBones)
        }),
        s => s.expectNone(),
      ),
    ),
  )
})

describe('the calling in the save', () => {
  test('round trips through the model', () => {
    expect(saveOf(restoreSave(initialModel, learnedSave)).calling).toBe(
      'TrackStar',
    )
  })

  test('a save from before callings picks YOU', () => {
    const { calling: _calling, ...rest } = learnedSave
    const json = jsonOf({ ...rest, version: 13 })
    const migrated = Option.getOrThrow(decodeSave(json))
    expect(migrated.calling).toBe('You')
    expect(migrated.version).toBe(SAVE_VERSION)
  })

  test('a synced pick the rank has not reached still starts as YOU', () => {
    const synced = restoreSave(
      UiStruct.evolve(initialModel, {
        saving: UiStruct.evolve({ saveStatus: () => 'Read' }),
      }),
      { ...learnedSave, calling: 'LineCook', rank: noRank },
    )
    expect(synced.calling).toBe('LineCook')
    expect(focusOf(synced).player.calling).toBe('You')
  })
})
