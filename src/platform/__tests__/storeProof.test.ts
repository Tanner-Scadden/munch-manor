// @vitest-environment happy-dom
import { Array, Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import {
  type ProofEntry,
  type ProofStamp,
  type SavedProof,
  mergeProof,
  shelve,
} from '../../shared/proofData'
import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { changesBetween } from '../playerSync'
import { type PlayerSave } from '../save'

// The Proof Shelf through sync (src/platform/proofScope.ts): each find goes
// up as its own change, and a slot two devices both fill keeps the earlier
// day's stamp on both.

const stampOn = (day: string | null, wave: number): ProofStamp => ({
  wave,
  hero: 'You',
  crew: [],
  day,
  ending: 'Munched',
})

const spoon = (day: string | null, wave: number): ProofEntry => ({
  thing: 'SilverSpoon',
  difficulty: 'Normal',
  stamp: stampOn(day, wave),
})

const box: ProofEntry = {
  thing: 'MusicBox',
  difficulty: 'Hard',
  stamp: stampOn('2026-11-13', 4),
}

const withProof = (proof: SavedProof): PlayerSave => ({ ...legacySave, proof })

describe('the first stamp', () => {
  it('a filled slot keeps its stamp unless the new one is from an earlier day', () => {
    const first = shelve([], spoon('2026-11-13', 7))
    expect(shelve(first, spoon('2026-11-14', 9))).toBe(first)
    expect(shelve(first, spoon(null, 9))).toBe(first)
    expect(shelve(first, spoon('2026-11-12', 3))).toEqual([
      spoon('2026-11-12', 3),
    ])
  })

  it('merging two shelves keeps every slot and the first stamp of each', () => {
    expect(
      mergeProof([spoon('2026-11-13', 7)], [spoon('2026-11-12', 3), box]),
    ).toEqual([spoon('2026-11-12', 3), box])
  })
})

describe('the Proof Shelf in sync', () => {
  it('each new find goes up as its own change', () => {
    expect(
      changesBetween(
        withProof([spoon('2026-11-13', 7)]),
        withProof([spoon('2026-11-13', 7), box]),
      ),
    ).toEqual([{ _tag: 'ShelvedProof', entry: box }])
  })

  it.effect('two devices filling one slot both end on the earlier stamp', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(
          phone,
          legacySave,
          withProof([spoon('2026-11-13', 7), box]),
        )
        yield* write(laptop, legacySave, withProof([spoon('2026-11-12', 3)]))
        const isSettled = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.proof.length === 2 &&
              Array.some(
                save.proof,
                entry =>
                  entry.thing === 'SilverSpoon' &&
                  entry.stamp.day === '2026-11-12',
              ),
          )
        const onPhone = yield* until(phone.load, isSettled)
        const onLaptop = yield* until(laptop.load, isSettled)
        expect(isSettled(onPhone)).toBe(true)
        expect(isSettled(onLaptop)).toBe(true)
      }),
    ),
  )
})
