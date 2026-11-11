import { Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  SHOTGUN,
  holdingFirst,
  holdingSecond,
  pistolOnly,
} from '../../../test/arsenals'
import {
  quietWave,
  withArsenal,
  withKnifeOut,
} from '../../../test/model.fixture'
import { APPLICATION, tap } from '../../../test/testing'
import {
  STARTING_PISTOL,
  freshGun,
  inHandOf,
} from '../../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../../world/party/party'
import { Arsenal, Melee, Reload } from '../../../world/schema/worldSchema'
import type { Model } from '../../model'

// The number keys (GAME_DESIGN.md, "One key per action"): 1 and 2 draw
// that gun slot, 3 the melee slot, through the same seat actions as a tap
// on a HUD slot (src/input/keyActions.ts).

const bothGuns = withArsenal(quietWave(3), holdingFirst(SHOTGUN))

const withPan = (base: Model): Model =>
  modifyFocus(base, {
    player: player =>
      modifyFields(player, {
        melee: () => Melee.Pan({ pan: freshGun('Pan') }),
      }),
  })

// NOTE: the pistol in hand halfway through a reload, with two rounds in.
const reloadingPistol = modifyFocus(bothGuns, {
  player: player =>
    modifyFields(player, {
      arsenal: () =>
        Arsenal.HoldingFirst({
          first: { ...STARTING_PISTOL, loaded: 2 },
          second: SHOTGUN,
        }),
      reload: () => Reload.Reloading({ remainingMs: 400, durationMs: 800 }),
    }),
})

describe('the number keys', () => {
  it.effect('2 draws the second gun and 1 the first', () =>
    Story.story(
      APPLICATION,
      Story.given(bothGuns),
      tap('Digit2'),
      Story.model(current => {
        expect(focusOf(current).player.arsenal).toEqual(holdingSecond(SHOTGUN))
      }),
      tap('Digit1'),
      Story.model(current => {
        expect(focusOf(current).player.arsenal).toEqual(holdingFirst(SHOTGUN))
      }),
      tap('Numpad2'),
      Story.model(current => {
        expect(inHandOf(focusOf(current).player)).toBe('Shotgun')
      }),
    ),
  )

  it.effect('the gun already in hand stays as it is', () =>
    Story.story(
      APPLICATION,
      Story.given(bothGuns),
      tap('Digit1'),
      Story.model(current => {
        expect(focusOf(current).player).toEqual(focusOf(bothGuns).player)
      }),
    ),
  )

  it.effect('an empty second slot draws nothing, even from the knife', () =>
    Effect.forEach(
      [
        withArsenal(quietWave(3), pistolOnly()),
        withKnifeOut(withArsenal(quietWave(3), pistolOnly())),
      ],
      start =>
        Story.story(
          APPLICATION,
          Story.given(start),
          tap('Digit2'),
          Story.model(current => {
            expect(focusOf(current).player).toEqual(focusOf(start).player)
          }),
        ),
    ),
  )

  it.effect('1 draws the first gun from the knife', () =>
    Story.story(
      APPLICATION,
      Story.given(withKnifeOut(withArsenal(bothGuns, holdingSecond(SHOTGUN)))),
      tap('Digit1'),
      Story.model(current => {
        expect(focusOf(current).player.wield).toBe('Gun')
        expect(focusOf(current).player.arsenal).toEqual(holdingFirst(SHOTGUN))
      }),
    ),
  )

  it.effect('3 draws the knife, or the Pan when it is held', () =>
    Effect.forEach(
      [
        [bothGuns, 'Knife'],
        [withPan(bothGuns), 'Pan'],
      ] as const,
      ([start, melee]) =>
        Story.story(
          APPLICATION,
          Story.given(start),
          tap('Digit3'),
          Story.model(current => {
            expect(inHandOf(focusOf(current).player)).toBe(melee)
          }),
        ),
    ),
  )

  it.effect('drawing the other gun stops a reload and keeps the magazine', () =>
    Story.story(
      APPLICATION,
      Story.given(reloadingPistol),
      tap('Digit2'),
      tap('Digit1'),
      Story.model(current => {
        const { player } = focusOf(current)
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        expect(focusOf(current).player.arsenal).toEqual(
          focusOf(reloadingPistol).player.arsenal,
        )
      }),
    ),
  )

  it.effect('a reload carries on while 3 has the knife out', () =>
    Story.story(
      APPLICATION,
      Story.given(reloadingPistol),
      tap('Digit3'),
      Story.model(current => {
        const { player } = focusOf(current)
        expect(inHandOf(player)).toBe('Knife')
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
    ),
  )
})
