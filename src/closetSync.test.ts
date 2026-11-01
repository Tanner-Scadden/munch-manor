// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { HAT_PRICES, type SoldHat } from './playerData'
import { PlayerChange } from './playerSync'
import { bonesBalanceOf, noRank } from './rank'
import type { PlayerSave } from './save'
import { legacySave, linkedPair, synced, until, write } from './store.fixture'
import type { PlayerDatabase } from './storeSqlite'

// The closet's Bones in the player scope (BoughtCosmetic in
// src/playerScope.ts): a hat is paid for once, only while the balance
// covers it, whatever order two linked devices' purchases arrive in.

const withBones = (bones: number): PlayerSave => ({
  ...legacySave,
  rank: { ...noRank, earnedPoints: bones * 10, earnedBones: bones },
})

const afterBuying = (before: PlayerSave, hat: SoldHat): PlayerSave => ({
  ...before,
  appearance: { ...before.appearance, hat },
  boughtHats: [...before.boughtHats, hat],
  rank: {
    ...before.rank,
    spentBones: before.rank.spentBones + HAT_PRICES[hat],
  },
})

const sees =
  (
    predicate: (save: PlayerSave) => boolean,
  ): ((maybeSave: Option.Option<PlayerSave>) => boolean) =>
  maybeSave =>
    Option.exists(maybeSave, predicate)

const settledView = (database: PlayerDatabase) =>
  Effect.map(database.load, maybeSave => Option.getOrThrow(maybeSave))

// NOTE: both devices hold the same Bones before they buy.
const pairWith = (bones: number) =>
  Effect.gen(function* () {
    const { phone, laptop } = yield* linkedPair
    const funded = withBones(bones)
    yield* write(phone, legacySave, funded)
    yield* until(
      laptop.load,
      sees(save => save.rank.earnedBones === bones),
    )
    return { phone, laptop, funded }
  })

describe('a hat bought with Bones', () => {
  it.effect('reaches the other linked device, with what it cost', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        yield* write(phone, funded, afterBuying(funded, 'Fez'))
        const isBought = sees(
          save =>
            save.boughtHats.length === 1 &&
            save.boughtHats[0] === 'Fez' &&
            save.rank.spentBones === 50 &&
            save.appearance.hat === 'Fez',
        )
        expect(isBought(yield* until(laptop.load, isBought))).toBe(true)
        expect(isBought(yield* until(phone.load, isBought))).toBe(true)
      }),
    ),
  )

  it.effect('bought on both devices at once, is paid for once', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        const bought = afterBuying(funded, 'Fez')
        yield* Effect.all(
          [write(phone, funded, bought), write(laptop, funded, bought)],
          { concurrency: 'unbounded' },
        )
        const isPaidOnce = sees(
          save =>
            save.boughtHats.length === 1 &&
            save.boughtHats[0] === 'Fez' &&
            save.rank.spentBones === 50,
        )
        expect(isPaidOnce(yield* until(phone.load, isPaidOnce))).toBe(true)
        expect(isPaidOnce(yield* until(laptop.load, isPaidOnce))).toBe(true)
        const onPhone = yield* settledView(phone)
        expect(bonesBalanceOf(onPhone.rank)).toBe(50)
      }),
    ),
  )

  it.effect(
    'two different hats with Bones for only one: the first to apply is kept, the second does nothing',
    () =>
      synced(
        Effect.gen(function* () {
          const { phone, laptop, funded } = yield* pairWith(60)
          yield* Effect.all(
            [
              write(phone, funded, afterBuying(funded, 'Fez')),
              write(laptop, funded, afterBuying(funded, 'Colander')),
            ],
            { concurrency: 'unbounded' },
          )
          // NOTE: each device shows its own purchase until the server has
          // put the two in order, so wait for both to agree on one hat.
          const bothViews = Effect.all([
            settledView(phone),
            settledView(laptop),
          ])
          const [onPhone, onLaptop] = yield* until(
            bothViews,
            ([a, b]) =>
              a.boughtHats.length === 1 &&
              b.boughtHats.length === 1 &&
              a.boughtHats[0] === b.boughtHats[0],
          )
          expect(onPhone.boughtHats).toEqual(onLaptop.boughtHats)
          expect(onPhone.rank.spentBones).toBe(onLaptop.rank.spentBones)
          const [hat] = onPhone.boughtHats
          expect(onPhone.rank.spentBones).toBe(hat === 'Fez' ? 50 : 40)
          expect(bonesBalanceOf(onPhone.rank)).toBeGreaterThanOrEqual(0)
          expect(onPhone.boughtHats).toHaveLength(1)
        }),
      ),
  )

  it.effect('two different hats with Bones for both: both are kept', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        yield* Effect.all(
          [
            write(phone, funded, afterBuying(funded, 'Fez')),
            write(laptop, funded, afterBuying(funded, 'Colander')),
          ],
          { concurrency: 'unbounded' },
        )
        const isBoth = sees(
          save =>
            save.boughtHats.length === 2 &&
            save.boughtHats.includes('Fez') &&
            save.boughtHats.includes('Colander') &&
            save.rank.spentBones === 90,
        )
        expect(isBoth(yield* until(phone.load, isBoth))).toBe(true)
        expect(isBoth(yield* until(laptop.load, isBoth))).toBe(true)
      }),
    ),
  )

  it.effect('does nothing for a hat the Bones do not cover', () =>
    synced(
      Effect.gen(function* () {
        const { phone, funded } = yield* pairWith(50)
        yield* phone.write(funded, [
          PlayerChange.BoughtCosmetic({ id: 'Plunger' }),
        ])
        const view = yield* settledView(phone)
        expect(view.boughtHats).toEqual([])
        expect(view.rank.spentBones).toBe(0)
      }),
    ),
  )

  it.effect('does nothing for a gift hat, or an id that is no hat', () =>
    synced(
      Effect.gen(function* () {
        const { phone, funded } = yield* pairWith(500)
        yield* phone.write(funded, [
          PlayerChange.BoughtCosmetic({ id: 'PartyHat' }),
          PlayerChange.BoughtCosmetic({ id: 'Beanie' }),
          PlayerChange.BoughtCosmetic({ id: '' }),
        ])
        const view = yield* settledView(phone)
        expect(view.boughtHats).toEqual([])
        expect(view.rank.spentBones).toBe(0)
      }),
    ),
  )

  it.effect('is not charged again when bought twice on one device', () =>
    synced(
      Effect.gen(function* () {
        const { phone, funded } = yield* pairWith(200)
        yield* phone.write(funded, [
          PlayerChange.BoughtCosmetic({ id: 'Fez' }),
          PlayerChange.BoughtCosmetic({ id: 'Fez' }),
        ])
        const view = yield* settledView(phone)
        expect(view.boughtHats).toEqual(['Fez'])
        expect(view.rank.spentBones).toBe(50)
      }),
    ),
  )
})
