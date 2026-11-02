// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { type Appearance, COSMETIC_PRICES, type SoldHat } from './playerData'
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
        expect(isBought(yield* until(laptop.load, isBought))).toBe(true)
        expect(isBought(yield* until(phone.load, isBought))).toBe(true)
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
        expect(isPaidOnce(yield* until(phone.load, isPaidOnce))).toBe(true)
        expect(isPaidOnce(yield* until(laptop.load, isPaidOnce))).toBe(true)
      }),
    ),
  )

  it.effect('does nothing for a skin the Bones do not cover or a gift', () =>
    synced(
      Effect.gen(function* () {
        const { phone, funded } = yield* pairWith(50)
        yield* phone.write(funded, [
          PlayerChange.BoughtCosmetic({ id: 'skin:Bone' }),
          PlayerChange.BoughtCosmetic({ id: 'skin:Gold' }),
          PlayerChange.BoughtCosmetic({ id: 'shirt:Gold' }),
        ])
        const view = yield* settledView(phone)
        expect(view.boughtCosmetics).toEqual([])
        expect(view.rank.spentBones).toBe(0)
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
        expect(view.boughtCosmetics).toEqual(['shirt:Midnight'])
        expect(view.rank.spentBones).toBe(20)
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
        expect(isPaidOnce(yield* until(phone.load, isPaidOnce))).toBe(true)
        expect(isPaidOnce(yield* until(laptop.load, isPaidOnce))).toBe(true)
      }),
    ),
  )

  it.effect('does nothing when the Bones fall short, or for YOU', () =>
    synced(
      Effect.gen(function* () {
        const { phone, funded } = yield* pairWith(99)
        yield* phone.write(funded, [
          PlayerChange.BoughtCosmetic({ id: 'hero:TrackStar' }),
          PlayerChange.BoughtCosmetic({ id: 'hero:You' }),
        ])
        const view = yield* settledView(phone)
        expect(view.boughtCosmetics).toEqual([])
        expect(view.rank.spentBones).toBe(0)
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
        expect(hasBoth(yield* until(phone.load, hasBoth))).toBe(true)
        expect(hasBoth(yield* until(laptop.load, hasBoth))).toBe(true)
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
            save.boughtCosmetics.length === 1 &&
            save.boughtCosmetics[0] === 'Fez' &&
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
              a.boughtCosmetics.length === 1 &&
              b.boughtCosmetics.length === 1 &&
              a.boughtCosmetics[0] === b.boughtCosmetics[0],
          )
          expect(onPhone.boughtCosmetics).toEqual(onLaptop.boughtCosmetics)
          expect(onPhone.rank.spentBones).toBe(onLaptop.rank.spentBones)
          const [hat] = onPhone.boughtCosmetics
          expect(onPhone.rank.spentBones).toBe(hat === 'Fez' ? 50 : 40)
          expect(bonesBalanceOf(onPhone.rank)).toBeGreaterThanOrEqual(0)
          expect(onPhone.boughtCosmetics).toHaveLength(1)
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
        expect(view.boughtCosmetics).toEqual([])
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
