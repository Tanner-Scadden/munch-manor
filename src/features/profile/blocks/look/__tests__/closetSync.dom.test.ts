import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { PlayerChange } from '#platform/save/playerSync.ts'
import type { PlayerSave } from '#platform/save/save.ts'
import type { PlayerDatabase } from '#platform/save/storeSqlite.ts'
import {
  type Appearance,
  COSMETIC_PRICES,
  type SoldHat,
} from '#shared/records/playerData.ts'
import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '#test/store.fixture.ts'
import { bonesBalanceOf, noRank } from '#world/heroes/rank.ts'

const withBones = (bones: number): PlayerSave => ({
  ...legacySave,
  rank: { ...noRank, earnedPoints: bones * 10, earnedBones: bones },
})

const afterBuyingId = (
  before: PlayerSave,
  id: string,
  wearing: Partial<Appearance>,
): PlayerSave => ({
  ...before,
  appearance: { ...before.appearance, ...wearing },
  boughtCosmetics: [...before.boughtCosmetics, id],
  rank: {
    ...before.rank,
    spentBones: before.rank.spentBones + (COSMETIC_PRICES[id] ?? 0),
  },
})

const afterBuying = (before: PlayerSave, hat: SoldHat): PlayerSave =>
  afterBuyingId(before, hat, { hat })

const sees =
  (
    predicate: (save: PlayerSave) => boolean,
  ): ((maybeSave: Option.Option<PlayerSave>) => boolean) =>
  maybeSave =>
    Option.exists(maybeSave, predicate)

const settledView = (database: PlayerDatabase) =>
  Effect.map(database.load, maybeSave => Option.getOrThrow(maybeSave))

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

describe('a gun skin bought with Bones', () => {
  it.effect('reaches the other linked device, with what it cost', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        yield* write(
          phone,
          funded,
          afterBuyingId(funded, 'skin:Candy', { gunSkin: 'Candy' }),
        )
        const isBought = sees(
          save =>
            save.boughtCosmetics.length === 1 &&
            save.boughtCosmetics[0] === 'skin:Candy' &&
            save.rank.spentBones === 60 &&
            save.appearance.gunSkin === 'Candy',
        )
        const value = yield* until(laptop.load, isBought)
        expect(isBought(value)).toBe(true)
        const value_1 = yield* until(phone.load, isBought)
        expect(isBought(value_1)).toBe(true)
      }),
    ),
  )

  it.effect('bought on both devices at once, is paid for once', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        const bought = afterBuyingId(funded, 'skin:Neon', { gunSkin: 'Neon' })
        yield* Effect.all(
          [write(phone, funded, bought), write(laptop, funded, bought)],
          { concurrency: 'unbounded' },
        )
        const isPaidOnce = sees(
          save =>
            save.boughtCosmetics.length === 1 && save.rank.spentBones === 60,
        )
        const value_2 = yield* until(phone.load, isPaidOnce)
        expect(isPaidOnce(value_2)).toBe(true)
        const value_3 = yield* until(laptop.load, isPaidOnce)
        expect(isPaidOnce(value_3)).toBe(true)
      }),
    ),
  )

  it.effect('a shirt color and a print are paid for the same way', () =>
    synced(
      Effect.gen(function* () {
        const { phone, funded } = yield* pairWith(30)
        yield* phone.write(funded, [
          PlayerChange.BoughtCosmetic({ id: 'shirt:Midnight' }),
          PlayerChange.BoughtCosmetic({ id: 'print:Skull' }),
        ])
        const view = yield* settledView(phone)
        expect([...view.boughtCosmetics].sort()).toEqual([
          'print:Skull',
          'shirt:Midnight',
        ])
        expect(view.rank.spentBones).toBe(
          (COSMETIC_PRICES['shirt:Midnight'] ?? 0) +
            (COSMETIC_PRICES['print:Skull'] ?? 0),
        )
      }),
    ),
  )
})

describe('a hero bought with Bones', () => {
  it.effect('reaches the other linked device, paid once even if both buy', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        const bought = {
          ...funded,
          calling: 'Handyman' as const,
          boughtCosmetics: ['hero:Handyman'],
          rank: { ...funded.rank, spentBones: 60 },
        }
        yield* Effect.all(
          [write(phone, funded, bought), write(laptop, funded, bought)],
          { concurrency: 'unbounded' },
        )
        const isPaidOnce = sees(
          save =>
            save.boughtCosmetics.length === 1 &&
            save.boughtCosmetics[0] === 'hero:Handyman' &&
            save.rank.spentBones === 60,
        )
        const value_4 = yield* until(phone.load, isPaidOnce)
        expect(isPaidOnce(value_4)).toBe(true)
        const value_5 = yield* until(laptop.load, isPaidOnce)
        expect(isPaidOnce(value_5)).toBe(true)
      }),
    ),
  )
})

describe('the unlocks seen', () => {
  it.effect('add up across linked devices, whatever the order', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(0)
        yield* Effect.all(
          [
            write(phone, funded, { ...funded, seenUnlocks: ['hat:PartyHat'] }),
            write(laptop, funded, {
              ...funded,
              seenUnlocks: ['calling:Handyman', 'hat:PartyHat'],
            }),
          ],
          { concurrency: 'unbounded' },
        )
        const hasBoth = sees(
          save =>
            save.seenUnlocks.length === 2 &&
            save.seenUnlocks.includes('hat:PartyHat') &&
            save.seenUnlocks.includes('calling:Handyman'),
        )
        const value_6 = yield* until(phone.load, hasBoth)
        expect(hasBoth(value_6)).toBe(true)
        const value_7 = yield* until(laptop.load, hasBoth)
        expect(hasBoth(value_7)).toBe(true)
      }),
    ),
  )

  it.effect(
    'never keep the baseline mark of a row from before NEW badges',
    () =>
      synced(
        Effect.gen(function* () {
          const { phone, funded } = yield* pairWith(0)
          yield* phone.write(funded, [
            PlayerChange.SawUnlocks({ ids: ['*', 'hat:PartyHat'] }),
          ])
          const view = yield* settledView(phone)
          expect(view.seenUnlocks).toEqual(['hat:PartyHat'])
        }),
      ),
  )
})

describe('a hat bought with Bones', () => {
  it.effect('reaches the other linked device, with what it cost', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop, funded } = yield* pairWith(100)
        yield* write(phone, funded, afterBuying(funded, 'Fez'))
        const isBought = sees(
          save =>
            save.boughtCosmetics.length === 1 &&
            save.boughtCosmetics[0] === 'Fez' &&
            save.rank.spentBones === 50 &&
            save.appearance.hat === 'Fez',
        )
        const value_8 = yield* until(laptop.load, isBought)
        expect(isBought(value_8)).toBe(true)
        const value_9 = yield* until(phone.load, isBought)
        expect(isBought(value_9)).toBe(true)
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
            save.boughtCosmetics.length === 1 &&
            save.boughtCosmetics[0] === 'Fez' &&
            save.rank.spentBones === 50,
        )
        const value_10 = yield* until(phone.load, isPaidOnce)
        expect(isPaidOnce(value_10)).toBe(true)
        const value_11 = yield* until(laptop.load, isPaidOnce)
        expect(isPaidOnce(value_11)).toBe(true)
        const onPhone = yield* settledView(phone)
        expect(bonesBalanceOf(onPhone.rank)).toBe(50)
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
            save.boughtCosmetics.length === 2 &&
            save.boughtCosmetics.includes('Fez') &&
            save.boughtCosmetics.includes('Colander') &&
            save.rank.spentBones === 90,
        )
        const value_12 = yield* until(phone.load, isBoth)
        expect(isBoth(value_12)).toBe(true)
        const value_13 = yield* until(laptop.load, isBoth)
        expect(isBoth(value_13)).toBe(true)
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
        expect(view.boughtCosmetics).toEqual([])
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
        expect(view.boughtCosmetics).toEqual(['Fez'])
        expect(view.rank.spentBones).toBe(50)
      }),
    ),
  )
})
