import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { playerPixels } from './appearance'
import { CharacterBinding } from './bindings'
import * as Character from './character'
import {
  CLOSET_HATS,
  closetTapOf,
  hatStandingOf,
  hatsGiftedBy,
  isHatOwned,
  lookInOwnedHat,
} from './closet'
import { HAT_ART, HAT_COLORS, MAX_HAT_ABOVE, hatRiseOf } from './hatArt'
import { update } from './main'
import { Message } from './message'
import { Reload } from './model'
import { type Model, defaultAppearance } from './model'
import { readyAfterRead } from './model.fixture'
import {
  HAT_GIFT_RANKS,
  HAT_PRICES,
  type Hat,
  type SavedRank,
} from './playerData'
import { PlayerChange } from './playerSync'
import { reloadBarShapes } from './playerView'
import { bonesBalanceOf, noRank, pointsForRank, rankOf } from './rank'
import { restoreSave, saveOf } from './save'
import { writeSave } from './testing'
import { WriteSave } from './update/save'

// The closet (src/closet.ts, src/update/closet.ts): hats are worn, bought
// with Bones, or gifted by rank, and a calling's prop takes a hat's place.

const closetWith = (
  rank: Partial<SavedRank>,
  worn: Hat = 'None',
  bought: ReadonlyArray<Hat> = [],
): Model =>
  modifyFields(readyAfterRead, {
    rank: () => ({ ...noRank, ...rank }),
    boughtHats: () => bought,
    appearance: look => ({ ...look, hat: worn }),
    profile: profile => modifyFields(profile, { tab: () => 'Closet' }),
    profileDialog: dialog => modifyFields(dialog, { isOpen: () => true }),
  })

const rankPoints = (rank: number): Partial<SavedRank> => ({
  earnedPoints: pointsForRank(rank),
})

const tap = (hat: Hat) => message(Message.ClickedClosetCard({ hat }))

const withHat = (hat: Hat) => ({ ...defaultAppearance, hat })

describe('buying a hat', () => {
  test('spends its price, owns it for good, and puts it on', () => {
    const before = closetWith({ earnedBones: 80 })
    const after = modifyFields(before, {
      appearance: () => withHat('Fez'),
      boughtHats: () => ['Fez'],
      rank: rank => ({ ...rank, spentBones: HAT_PRICES.Fez }),
    })
    story(
      update,
      given(before),
      tap('Fez'),
      model(current => {
        expect(current.appearance.hat).toBe('Fez')
        expect(current.boughtHats).toEqual(['Fez'])
        expect(bonesBalanceOf(current.rank)).toBe(30)
        expect(current.profile.closetCue.kind).toBe('Bought')
        expect(current.profile.closetCue.hat).toBe('Fez')
      }),
      Command.expectExact(
        WriteSave({
          save: saveOf(after),
          changes: [
            PlayerChange.ChangedAppearance({ appearance: withHat('Fez') }),
            PlayerChange.BoughtCosmetic({ id: 'Fez' }),
          ],
        }),
      ),
      writeSave(),
    )
  })

  test('is paid once: wearing it again, off and on, costs nothing', () => {
    story(
      update,
      given(closetWith({ earnedBones: 80 })),
      tap('Fez'),
      writeSave(),
      tap('Fez'),
      model(current => {
        expect(current.appearance.hat).toBe('None')
        expect(bonesBalanceOf(current.rank)).toBe(30)
      }),
      writeSave(),
      tap('Fez'),
      model(current => {
        expect(current.appearance.hat).toBe('Fez')
        expect(current.boughtHats).toEqual(['Fez'])
        expect(bonesBalanceOf(current.rank)).toBe(30)
      }),
      writeSave(),
    )
  })

  test('short of Bones changes nothing but the shake', () => {
    const before = closetWith({ earnedBones: 49 })
    story(
      update,
      given(before),
      tap('Fez'),
      model(current => {
        expect(current.appearance.hat).toBe('None')
        expect(current.boughtHats).toEqual([])
        expect(bonesBalanceOf(current.rank)).toBe(49)
        expect(current.profile.closetCue.kind).toBe('Short')
        expect(current.profile.closetCue.hat).toBe('Fez')
      }),
      Command.expectNone(),
    )
  })

  test('the same shake twice in a row still replays: the count moves', () => {
    story(
      update,
      given(closetWith({})),
      tap('Fez'),
      model(current => {
        expect(current.profile.closetCue.count).toBe(1)
      }),
      tap('Fez'),
      model(current => {
        expect(current.profile.closetCue.count).toBe(2)
      }),
    )
  })

  test('the balance is earned plus the veteran grant minus what is spent', () => {
    story(
      update,
      given(
        closetWith({
          earnedBones: 30,
          veteranBones: 20,
          spentBones: 0,
        }),
      ),
      tap('Fez'),
      model(current => {
        expect(current.boughtHats).toEqual(['Fez'])
        expect(bonesBalanceOf(current.rank)).toBe(0)
      }),
      writeSave(),
    )
  })
})

describe('gift hats', () => {
  test('are locked below their rank and shake when tapped', () => {
    story(
      update,
      given(closetWith(rankPoints(1))),
      tap('PartyHat'),
      model(current => {
        expect(current.appearance.hat).toBe('None')
        expect(current.profile.closetCue.kind).toBe('Short')
      }),
      Command.expectNone(),
    )
  })

  test('are owned at their rank, free, and worn on a tap', () => {
    const before = closetWith(rankPoints(HAT_GIFT_RANKS.PartyHat))
    expect(rankOf(before.rank.earnedPoints)).toBe(HAT_GIFT_RANKS.PartyHat)
    story(
      update,
      given(before),
      tap('PartyHat'),
      model(current => {
        expect(current.appearance.hat).toBe('PartyHat')
        expect(current.boughtHats).toEqual([])
        expect(current.rank.spentBones).toBe(0)
        expect(current.profile.closetCue.kind).toBe('Worn')
      }),
      Command.expectExact(
        WriteSave({
          save: saveOf(
            modifyFields(before, { appearance: () => withHat('PartyHat') }),
          ),
          changes: [
            PlayerChange.ChangedAppearance({ appearance: withHat('PartyHat') }),
          ],
        }),
      ),
      writeSave(),
    )
  })

  test('a rank up reaches the gifts between its ranks', () => {
    expect(hatsGiftedBy(1, 2)).toEqual(['PartyHat'])
    expect(hatsGiftedBy(2, 2)).toEqual([])
    expect(hatsGiftedBy(3, 6)).toEqual(['BucketHat', 'PomBeanie'])
    expect(hatsGiftedBy(1, 14)).toHaveLength(10)
  })

  test('no gift shares a rank with a calling', () => {
    const callingRanks = [3, 6, 10, 15]
    Object.values(HAT_GIFT_RANKS).forEach(rank => {
      expect(callingRanks).not.toContain(rank)
    })
  })
})

describe('wearing and taking off', () => {
  test('a worn hat comes off on a tap', () => {
    const before = closetWith({ earnedBones: 80 }, 'Fez', ['Fez'])
    story(
      update,
      given(before),
      tap('Fez'),
      model(current => {
        expect(current.appearance.hat).toBe('None')
        expect(current.boughtHats).toEqual(['Fez'])
      }),
      Command.expectExact(
        WriteSave({
          save: saveOf(
            modifyFields(before, { appearance: () => withHat('None') }),
          ),
          changes: [
            PlayerChange.ChangedAppearance({ appearance: withHat('None') }),
          ],
        }),
      ),
      writeSave(),
    )
  })

  test('another owned hat replaces the worn one', () => {
    story(
      update,
      given(closetWith({}, 'Fez', ['Fez', 'Colander'])),
      tap('Colander'),
      model(current => {
        expect(current.appearance.hat).toBe('Colander')
      }),
      writeSave(),
    )
  })

  test('a tap does nothing when the closet is not open', () => {
    const shut = modifyFields(closetWith({ earnedBones: 80 }), {
      profileDialog: dialog => modifyFields(dialog, { isOpen: () => false }),
    })
    story(
      update,
      given(shut),
      tap('Fez'),
      model(current => {
        expect(current.appearance.hat).toBe('None')
        expect(current.boughtHats).toEqual([])
      }),
      Command.expectNone(),
    )
  })

  test('the look dice keeps the hat on', () => {
    const onLook = modifyFields(closetWith({}, 'Fez', ['Fez']), {
      profile: profile => modifyFields(profile, { tab: () => 'Look' }),
    })
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
        expect(current.appearance.hairStyle).not.toBe(
          onLook.appearance.hairStyle,
        )
      }),
      writeSave(),
    )
  })
})

describe('the standing of a card', () => {
  const rank = (points: number) => rankOf(points)

  test('is worn, owned, for sale, or locked', () => {
    const bought: ReadonlyArray<Hat> = ['Fez']
    expect(hatStandingOf('Fez', 'Fez', bought, 1)).toBe('Worn')
    expect(hatStandingOf('Fez', 'None', bought, 1)).toBe('Owned')
    expect(hatStandingOf('Plunger', 'None', bought, 1)).toBe('ForSale')
    expect(hatStandingOf('TopHat', 'None', bought, rank(0))).toBe('Locked')
    expect(hatStandingOf('TopHat', 'None', bought, 11)).toBe('Owned')
    expect(hatStandingOf('TopHat', 'TopHat', bought, 11)).toBe('Worn')
  })

  test('a tap is read from the standing and the Bones', () => {
    const poor = { ...noRank, earnedBones: 10 }
    const rich = { ...noRank, earnedBones: 100 }
    expect(closetTapOf('Fez', 'Fez', ['Fez'], poor, 1)).toBe('TakeOff')
    expect(closetTapOf('Fez', 'None', ['Fez'], poor, 1)).toBe('Wear')
    expect(closetTapOf('Plunger', 'None', [], poor, 1)).toBe('Short')
    expect(closetTapOf('Plunger', 'None', [], rich, 1)).toBe('Buy')
    expect(closetTapOf('TopHat', 'None', [], rich, 1)).toBe('Nothing')
  })

  test('a bought hat is owned at any rank, a gift only by rank', () => {
    expect(isHatOwned('None', [], 1)).toBe(true)
    expect(isHatOwned('Fez', [], 99)).toBe(false)
    expect(isHatOwned('Fez', ['Fez'], 1)).toBe(true)
    expect(isHatOwned('PartyHat', [], 2)).toBe(true)
    expect(isHatOwned('PartyHat', [], 1)).toBe(false)
  })

  test('a worn hat that is not owned comes off, an owned one stays', () => {
    expect(lookInOwnedHat(withHat('Fez'), [], 1).hat).toBe('None')
    expect(lookInOwnedHat(withHat('Fez'), ['Fez'], 1).hat).toBe('Fez')
    expect(lookInOwnedHat(withHat('PartyHat'), [], 2).hat).toBe('PartyHat')
  })

  test('a synced save restores the hat only if it is owned', () => {
    const saved = saveOf(closetWith({ earnedBones: 80 }, 'Fez', []))
    const restored = restoreSave(closetWith({}), saved)
    expect(restored.appearance.hat).toBe('None')
    const owned = restoreSave(
      closetWith({}),
      saveOf(closetWith({ earnedBones: 80 }, 'Fez', ['Fez'])),
    )
    expect(owned.appearance.hat).toBe('Fez')
    expect(owned.boughtHats).toEqual(['Fez'])
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
    CLOSET_HATS.forEach(hat => {
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
    CLOSET_HATS.forEach(hat => {
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
    CLOSET_HATS.forEach(hat => {
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
