import { Array, pipe } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { playerPixels, randomAppearance } from './appearance'
import { CharacterBinding } from './bindings'
import * as Character from './character'
import {
  GIFTS,
  gearTapOf,
  giftsOpenedBy,
  isOwned,
  lookInOwned,
  sourceOf,
  standingOf,
} from './closet'
import { HAT_ART, HAT_COLORS, MAX_HAT_ABOVE, hatRiseOf } from './hatArt'
import { update } from './main'
import { Reload } from './model'
import { type LookPart, type Model, defaultAppearance } from './model'
import { readyAfterRead } from './model.fixture'
import {
  type Appearance,
  COSMETIC_GIFT_RANKS,
  COSMETIC_PRICES,
  GiftHat,
  type SavedRank,
  SoldHat,
} from './playerData'
import { PlayerChange } from './playerSync'
import { reloadBarShapes } from './playerView'
import { bonesBalanceOf, noRank, pointsForRank, rankOf } from './rank'
import { restoreSave, saveOf } from './save'
import { writeSave } from './testing'
import { WriteSave } from './update/save'

// The earned looks (src/closet.ts, src/update/character.ts): hats, shirt
// colors, prints, and gun skins are worn, bought with Bones, or gifted by
// rank, picked in the Look tab's rows, and a calling's prop takes a hat's
// place.

const HATS = [...GiftHat.literals, ...SoldHat.literals]

const closetWith = (
  rank: Partial<SavedRank>,
  look: Partial<Appearance> = {},
  bought: ReadonlyArray<string> = [],
): Model =>
  modifyFields(readyAfterRead, {
    rank: () => ({ ...noRank, ...rank }),
    boughtCosmetics: () => bought,
    appearance: current => ({ ...current, ...look }),
    profile: profile => modifyFields(profile, { tab: () => 'Look' }),
    profileDialog: dialog => modifyFields(dialog, { isOpen: () => true }),
  })

const rankPoints = (rank: number): Partial<SavedRank> => ({
  earnedPoints: pointsForRank(rank),
})

const pick = (part: LookPart, value: string) =>
  message(
    toParentMessage(
      CharacterBinding,
      Character.Message.ClickedGearOption({ part, value }),
    ),
  )

const withLook = (look: Partial<Appearance>): Appearance => ({
  ...defaultAppearance,
  ...look,
})

const withHat = (hat: Appearance['hat']) => withLook({ hat })

// NOTE: one sold look of each kind: the part it sits on, its name, the
// field it wears, and its price.
const SOLD = [
  { id: 'Fez', part: 'Hat', name: 'Fez', field: 'hat', price: 50 },
  {
    id: 'shirt:Midnight',
    part: 'ShirtColor',
    name: 'Midnight',
    field: 'shirtColor',
    price: 20,
  },
  {
    id: 'print:Skull',
    part: 'Print',
    name: 'Skull',
    field: 'print',
    price: 20,
  },
  {
    id: 'skin:Candy',
    part: 'GunSkin',
    name: 'Candy',
    field: 'gunSkin',
    price: 60,
  },
] as const

describe.each(SOLD)('buying $id', ({ id, part, name, field, price }) => {
  test('spends its price, owns it for good, and puts it on', () => {
    const before = closetWith({ earnedBones: 80 })
    const after = modifyFields(before, {
      appearance: current => ({ ...current, [field]: name }),
      boughtCosmetics: () => [id],
      rank: rank => ({ ...rank, spentBones: price }),
    })
    story(
      update,
      given(before),
      pick(part, name),
      model(current => {
        expect(current.appearance[field]).toBe(name)
        expect(current.boughtCosmetics).toEqual([id])
        expect(bonesBalanceOf(current.rank)).toBe(80 - price)
        expect(current.profile.closetCue).toMatchObject({
          part,
          value: name,
          kind: 'Bought',
        })
      }),
      Command.expectExact(
        WriteSave({
          save: saveOf(after),
          changes: [
            PlayerChange.ChangedAppearance({ appearance: after.appearance }),
            PlayerChange.BoughtCosmetic({ id }),
          ],
        }),
      ),
      writeSave(),
    )
  })

  test('short of Bones changes nothing but the shake', () => {
    story(
      update,
      given(closetWith({ earnedBones: price - 1 })),
      pick(part, name),
      model(current => {
        expect(current.appearance[field]).toBe(defaultAppearance[field])
        expect(current.boughtCosmetics).toEqual([])
        expect(bonesBalanceOf(current.rank)).toBe(price - 1)
        expect(current.profile.closetCue.kind).toBe('Short')
      }),
      Command.expectNone(),
    )
  })

  test('is paid once: owned, a pick wears it and costs nothing', () => {
    story(
      update,
      given(closetWith({ earnedBones: 200 }, {}, [id])),
      pick(part, name),
      model(current => {
        expect(current.appearance[field]).toBe(name)
        expect(current.boughtCosmetics).toEqual([id])
        expect(current.rank.spentBones).toBe(0)
        expect(current.profile.closetCue.kind).not.toBe('Bought')
      }),
      writeSave(),
    )
  })
})

describe('the Bones', () => {
  test('the balance is earned plus the veteran grant minus what is spent', () => {
    story(
      update,
      given(closetWith({ earnedBones: 30, veteranBones: 20, spentBones: 0 })),
      pick('Hat', 'Fez'),
      model(current => {
        expect(current.boughtCosmetics).toEqual(['Fez'])
        expect(bonesBalanceOf(current.rank)).toBe(0)
      }),
      writeSave(),
    )
  })

  test('the same shake twice in a row still replays: the count moves', () => {
    story(
      update,
      given(closetWith({})),
      pick('Hat', 'Fez'),
      model(current => {
        expect(current.profile.closetCue.count).toBe(1)
      }),
      pick('Hat', 'Fez'),
      model(current => {
        expect(current.profile.closetCue.count).toBe(2)
      }),
    )
  })

  test('the prices are the catalog: 20 Bones a color or print, 60 a gun skin', () => {
    expect(COSMETIC_PRICES['shirt:Midnight']).toBe(20)
    expect(COSMETIC_PRICES['shirt:Coral']).toBe(20)
    expect(COSMETIC_PRICES['print:Skull']).toBe(20)
    expect(COSMETIC_PRICES['print:Flames']).toBe(20)
    expect(
      ['Candy', 'Bone', 'Neon'].map(skin => COSMETIC_PRICES[`skin:${skin}`]),
    ).toEqual([60, 60, 60])
  })
})

describe('gifts', () => {
  test.each(GIFTS)(
    '$kind $name is locked below rank $rank and shakes',
    gift => {
      const part = Character.PART_OF_KIND[gift.kind]
      story(
        update,
        given(closetWith(rankPoints(gift.rank - 1))),
        pick(part, gift.name),
        model(current => {
          expect(current.profile.closetCue.kind).toBe('Short')
          expect(current.appearance).toEqual(readyAfterRead.appearance)
          expect(current.boughtCosmetics).toEqual([])
        }),
        Command.expectNone(),
      )
    },
  )

  test.each(GIFTS)('$kind $name is free at rank $rank', gift => {
    const part = Character.PART_OF_KIND[gift.kind]
    const before = closetWith(rankPoints(gift.rank))
    expect(rankOf(before.rank.earnedPoints)).toBe(gift.rank)
    story(
      update,
      given(before),
      pick(part, gift.name),
      model(current => {
        expect(current.boughtCosmetics).toEqual([])
        expect(current.rank.spentBones).toBe(0)
        expect(current.profile.closetCue.kind).not.toBe('Short')
        expect(current.appearance).not.toEqual(readyAfterRead.appearance)
      }),
      writeSave(),
    )
  })

  test('are the ranks the decision lists', () => {
    expect(
      GIFTS.filter(({ rank }) => rank >= 16).map(
        ({ kind, name, rank }) => `${rank} ${kind} ${name}`,
      ),
    ).toEqual([
      '16 Shirt Gold',
      '17 Print Polka',
      '18 Skin Gold',
      '19 Shirt Glow',
      '20 Print Checker',
      '22 Skin Slime',
    ])
  })

  test('a rank up reaches the gifts between its ranks', () => {
    expect(giftsOpenedBy(1, 2).map(({ name }) => name)).toEqual(['PartyHat'])
    expect(giftsOpenedBy(2, 2)).toEqual([])
    expect(giftsOpenedBy(3, 6).map(({ name }) => name)).toEqual([
      'BucketHat',
      'PomBeanie',
    ])
    expect(giftsOpenedBy(15, 22).map(({ name }) => name)).toEqual([
      'Gold',
      'Polka',
      'Gold',
      'Glow',
      'Checker',
      'Slime',
    ])
    expect(giftsOpenedBy(1, 99)).toHaveLength(16)
  })

  test('no gift shares a rank with a calling or with another gift', () => {
    const ranks = Object.values(COSMETIC_GIFT_RANKS)
    ;[3, 6, 10, 15].forEach(rank => {
      expect(ranks).not.toContain(rank)
    })
    expect(new Set(ranks).size).toBe(ranks.length)
  })
})

describe('wearing', () => {
  test('a free color and print are put on with a pick', () => {
    story(
      update,
      given(closetWith({})),
      pick('ShirtColor', 'Red'),
      writeSave(),
      pick('Print', 'Stripes'),
      writeSave(),
      model(current => {
        expect(current.appearance.shirtColor).toBe('Red')
        expect(current.appearance.print).toBe('Stripes')
        expect(current.rank.spentBones).toBe(0)
      }),
    )
  })

  test('the hat and skin worn go back with the free options', () => {
    story(
      update,
      given(
        closetWith({}, { hat: 'Fez', gunSkin: 'Candy' }, ['Fez', 'skin:Candy']),
      ),
      pick('Hat', 'None'),
      writeSave(),
      pick('GunSkin', 'Stock'),
      writeSave(),
      model(current => {
        expect(current.appearance.hat).toBe('None')
        expect(current.appearance.gunSkin).toBe('Stock')
        expect(current.boughtCosmetics).toEqual(['Fez', 'skin:Candy'])
      }),
    )
  })

  test('picking the one worn writes nothing', () => {
    story(
      update,
      given(closetWith({}, { shirtColor: 'Teal' })),
      pick('ShirtColor', 'Teal'),
      model(current => {
        expect(current.appearance.shirtColor).toBe('Teal')
      }),
      Command.expectNone(),
    )
  })

  test('another owned hat replaces the worn one', () => {
    story(
      update,
      given(closetWith({}, { hat: 'Fez' }, ['Fez', 'Colander'])),
      pick('Hat', 'Colander'),
      model(current => {
        expect(current.appearance.hat).toBe('Colander')
      }),
      writeSave(),
    )
  })

  test('the look dice keeps the hat and the gun skin on', () => {
    const onLook = closetWith({}, { hat: 'Fez', gunSkin: 'Candy' }, [
      'Fez',
      'skin:Candy',
    ])
    story(
      update,
      given(onLook),
      message(
        toParentMessage(
          CharacterBinding,
          Character.Message.ClickedDiceButton(),
        ),
      ),
      model(current => {
        expect(current.appearance.hat).toBe('Fez')
        expect(current.appearance.gunSkin).toBe('Candy')
        expect(current.appearance.hairStyle).not.toBe(
          onLook.appearance.hairStyle,
        )
      }),
      writeSave(),
    )
  })
})

describe('the dice', () => {
  const rolls = (bought: ReadonlyArray<string>, rank: number) =>
    pipe(
      Array.range(0, 599),
      Array.map(
        seed =>
          randomAppearance(seed * 31 + 7, defaultAppearance, bought, rank)[1],
      ),
    )
  const colorsOf = (looks: ReadonlyArray<Appearance>) =>
    new Set(looks.map(look => look.shirtColor))
  const printsOf = (looks: ReadonlyArray<Appearance>) =>
    new Set(looks.map(look => look.print))

  test('never rolls a color or print that is not free or owned', () => {
    const none = rolls([], 1)
    expect([...colorsOf(none)].sort()).toEqual([
      'Blue',
      'Pink',
      'Purple',
      'Red',
      'Teal',
      'Yellow',
    ])
    expect([...printsOf(none)].sort()).toEqual(['Plain', 'Rainbow', 'Stripes'])
  })

  test('rolls the ones bought or gifted by rank, and only those', () => {
    const some = rolls(['shirt:Midnight', 'print:Skull'], 16)
    expect(colorsOf(some)).toContain('Midnight')
    expect(colorsOf(some)).toContain('Gold')
    expect(colorsOf(some)).not.toContain('Coral')
    expect(colorsOf(some)).not.toContain('Glow')
    expect(printsOf(some)).toContain('Skull')
    expect(printsOf(some)).not.toContain('Polka')
    expect(printsOf(some)).not.toContain('Flames')
  })
})

describe('the standing of an option', () => {
  test('is worn, owned, for sale, or locked', () => {
    const bought = ['Fez']
    expect(standingOf('Hat', 'Fez', 'Fez', bought, 1)).toBe('Worn')
    expect(standingOf('Hat', 'Fez', 'None', bought, 1)).toBe('Owned')
    expect(standingOf('Hat', 'Plunger', 'None', bought, 1)).toBe('ForSale')
    expect(standingOf('Hat', 'TopHat', 'None', bought, 1)).toBe('Locked')
    expect(standingOf('Hat', 'TopHat', 'None', bought, 11)).toBe('Owned')
    expect(standingOf('Shirt', 'Blue', 'Red', [], 1)).toBe('Owned')
    expect(standingOf('Shirt', 'Gold', 'Blue', [], 15)).toBe('Locked')
    expect(standingOf('Shirt', 'Gold', 'Gold', [], 16)).toBe('Worn')
    expect(standingOf('Skin', 'Stock', 'Candy', [], 1)).toBe('Owned')
  })

  test('a pick is read from the standing and the Bones', () => {
    const poor = { ...noRank, earnedBones: 10 }
    const rich = { ...noRank, earnedBones: 100 }
    expect(gearTapOf('Hat', 'Fez', 'Fez', ['Fez'], poor, 1)).toBe('Stay')
    expect(gearTapOf('Hat', 'Fez', 'None', ['Fez'], poor, 1)).toBe('Wear')
    expect(gearTapOf('Hat', 'Plunger', 'None', [], poor, 1)).toBe('Short')
    expect(gearTapOf('Hat', 'Plunger', 'None', [], rich, 1)).toBe('Buy')
    expect(gearTapOf('Skin', 'Candy', 'Stock', [], rich, 1)).toBe('Buy')
    expect(gearTapOf('Skin', 'Candy', 'Stock', [], poor, 1)).toBe('Short')
    expect(gearTapOf('Hat', 'TopHat', 'None', [], rich, 1)).toBe('Locked')
  })

  test('a bought look is owned at any rank, a gift only by rank', () => {
    expect(isOwned('Hat', 'None', [], 1)).toBe(true)
    expect(isOwned('Hat', 'Fez', [], 99)).toBe(false)
    expect(isOwned('Hat', 'Fez', ['Fez'], 1)).toBe(true)
    expect(isOwned('Hat', 'PartyHat', [], 2)).toBe(true)
    expect(isOwned('Hat', 'PartyHat', [], 1)).toBe(false)
    expect(isOwned('Shirt', 'Midnight', ['shirt:Midnight'], 1)).toBe(true)
    expect(isOwned('Shirt', 'Midnight', ['skin:Midnight'], 1)).toBe(false)
    expect(sourceOf('Skin', 'Stock')).toEqual({ kind: 'Free' })
    expect(sourceOf('Skin', 'Bone')).toEqual({ kind: 'Sold', price: 60 })
    expect(sourceOf('Skin', 'Slime')).toEqual({ kind: 'Gift', rank: 22 })
  })

  test('a look worn but not owned goes back to the free one', () => {
    const worn = withLook({
      hat: 'Fez',
      shirtColor: 'Midnight',
      print: 'Skull',
      gunSkin: 'Candy',
    })
    expect(lookInOwned(worn, [], 1)).toEqual(
      withLook({
        hat: 'None',
        shirtColor: 'Blue',
        print: 'Plain',
        gunSkin: 'Stock',
      }),
    )
    expect(
      lookInOwned(
        worn,
        ['Fez', 'shirt:Midnight', 'print:Skull', 'skin:Candy'],
        1,
      ),
    ).toBe(worn)
    expect(lookInOwned(withLook({ hat: 'PartyHat' }), [], 2).hat).toBe(
      'PartyHat',
    )
  })

  test('a synced save restores a look only if it is owned', () => {
    const saved = saveOf(
      closetWith({ earnedBones: 80 }, { hat: 'Fez', gunSkin: 'Neon' }, []),
    )
    const restored = restoreSave(closetWith({}), saved)
    expect(restored.appearance.hat).toBe('None')
    expect(restored.appearance.gunSkin).toBe('Stock')
    const owned = restoreSave(
      closetWith({}),
      saveOf(
        closetWith({ earnedBones: 80 }, { hat: 'Fez', gunSkin: 'Neon' }, [
          'Fez',
          'skin:Neon',
        ]),
      ),
    )
    expect(owned.appearance.hat).toBe('Fez')
    expect(owned.appearance.gunSkin).toBe('Neon')
    expect(owned.boughtCosmetics).toEqual(['Fez', 'skin:Neon'])
  })
})

describe('the hat on the sprite', () => {
  const look = withHat('TopHat')

  test('YOU shows the hat and every other calling shows its prop instead', () => {
    const bare = playerPixels(withHat('None'))
    const hatted = playerPixels(look)
    expect(hatted.idle[0].length).toBe(
      bare.idle[0].length + HAT_ART.TopHat.above,
    )
    ;(['Handyman', 'TrackStar', 'PennyPincher', 'LineCook'] as const).forEach(
      calling => {
        expect(playerPixels(look, calling)).toEqual(
          playerPixels(withHat('None'), calling),
        )
      },
    )
  })

  test('the feet stay where they were: only rows at the top are added', () => {
    HATS.forEach(hat => {
      const bare = playerPixels(withHat('None'))
      const hatted = playerPixels(withHat(hat))
      const grown = HAT_ART[hat].above
      expect(grown).toBeLessThanOrEqual(MAX_HAT_ABOVE)
      hatted.walk.forEach((frame, index) => {
        const bareFrame = bare.walk[index] ?? []
        expect(frame.slice(grown + 8)).toEqual(bareFrame.slice(8))
        expect(frame).toHaveLength(bareFrame.length + grown)
      })
    })
  })

  test('no hat reaches the eyes: their row is the same with every hat', () => {
    const EYES_ROW = 4
    HATS.forEach(hat => {
      const art = HAT_ART[hat]
      const rowsOverFace = art.rows.length - art.above
      expect(rowsOverFace).toBeLessThanOrEqual(EYES_ROW - 1)
      const bare = playerPixels(withHat('None')).idle[0]
      const hatted = playerPixels(withHat(hat)).idle[0]
      // NOTE: the idle frame has one blank row over the face.
      expect(hatted[art.above + 1 + EYES_ROW]).toEqual(bare[1 + EYES_ROW])
    })
  })

  test('a hat is eight pixels wide and every symbol has a color', () => {
    Object.values(HAT_ART).forEach(art => {
      art.rows.forEach(row => {
        expect(row).toHaveLength(8)
        row.split('').forEach(symbol => {
          expect(symbol === '.' || symbol in HAT_COLORS).toBe(true)
        })
      })
    })
  })
})

describe('the marks over a hat', () => {
  test('rise by what the sprite grew, and by nothing for a bare head or a calling', () => {
    expect(hatRiseOf(withHat('None'), 'You')).toBe(0)
    HATS.forEach(hat => {
      const grown =
        playerPixels(withHat(hat)).idle[0].length -
        playerPixels(withHat('None')).idle[0].length
      expect(hatRiseOf(withHat(hat), 'You')).toBeGreaterThan(grown)
      expect(hatRiseOf(withHat(hat), 'Handyman')).toBe(0)
    })
    expect(hatRiseOf(withHat('WitchHat'), 'You')).toBeGreaterThan(
      hatRiseOf(withHat('Fez'), 'You'),
    )
  })

  test('the reload bar stands that much higher', () => {
    const reloading = {
      ...readyAfterRead.player,
      reload: Reload.Reloading({ remainingMs: 500, durationMs: 1000 }),
    }
    const yOf = (rise: number) => {
      const [back] = reloadBarShapes(reloading, rise)
      return back?._tag === 'Rect' ? back.y : Number.NaN
    }
    expect(yOf(0) - yOf(6)).toBe(6)
  })
})
