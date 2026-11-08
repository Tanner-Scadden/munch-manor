import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../app/message'
import { initialModel } from '../../app/pureApp'
import { WriteSave } from '../../app/update/save'
import { loadingSave } from '../../test/model.fixture'
import {
  APPLICATION,
  checkPendingArgs,
  finishSplash,
  jsonOf,
  writeSave,
} from '../../test/testing'
import { noRank } from '../../world/heroes/rank'
import { focusOf } from '../../world/party/party'
import { PlayerChange } from '../playerSync'
import {
  type PlayerSave,
  SAVE_VERSION,
  decodeSave,
  restoreSave,
  saveOf,
} from '../save'
import { learnedSave } from './save.fixture'

// The rank and the calling a save carries: the veteran grant a save from
// before rank is given once it loads, and the calling's round trip.

describe('the veteran grant', () => {
  // NOTE: the save read at boot, then the splash's last Commands.
  const loaded = (maybeSave: Option.Option<PlayerSave>) =>
    Story.steps(
      Story.message(Message.CompletedLoadSave({ maybeSave })),
      finishSplash,
    )

  // NOTE: the changes each pending save write carries, checked before it
  // is written.
  const changesWritten = (
    check: (changes: ReadonlyArray<ReadonlyArray<PlayerChange>>) => void,
  ) =>
    checkPendingArgs(Story.Command.argsOf(WriteSave))(writes =>
      check(Array.map(writes, ({ changes }) => changes)),
    )

  // NOTE: a save from before rank, as the previous build wrote it.
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
      Story.story(
        APPLICATION,
        Story.given(loadingSave),
        loaded(beforeRank({ Shambler: 200, Runner: 141 })),
        Story.model(current => {
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
        writeSave(),
      ),
  )

  it.effect('the grant stops at the points for rank 10', () =>
    Story.story(
      APPLICATION,
      Story.given(loadingSave),
      loaded(beforeRank({ Shambler: 9000 })),
      Story.model(current => {
        expect(current.rank.veteranPoints).toBe(1800)
        expect(current.rank.veteranBones).toBe(180)
      }),
      writeSave(),
    ),
  )

  it.effect('a save that was granted keeps its grant and writes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(loadingSave),
      loaded(Option.some(learnedSave)),
      Story.model(current => {
        expect(current.rank).toEqual(learnedSave.rank)
      }),
      Story.Command.expectNone(),
    ),
  )

  it.effect(
    'a new player is granted 0 once, so later kills never become a grant',
    () =>
      Story.story(
        APPLICATION,
        Story.given(loadingSave),
        loaded(Option.none()),
        Story.model(current => {
          expect(current.rank.isVeteranGranted).toBe(true)
          expect(current.rank.veteranPoints).toBe(0)
          const later = modifyFields(current, {
            bests: bests => modifyFields(bests, { totalKills: () => 500 }),
          })
          expect(saveOf(later).rank.veteranPoints).toBe(0)
        }),
        Story.Command.expectNone(),
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
      modifyFields(initialModel, { saveStatus: () => 'Read' }),
      { ...learnedSave, calling: 'LineCook', rank: noRank },
    )
    expect(synced.calling).toBe('LineCook')
    expect(focusOf(synced).player.calling).toBe('You')
  })
})
