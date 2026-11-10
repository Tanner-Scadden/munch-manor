import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { type Model, type WeaponKind, type Zombie } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { holdingSecond, maybeSpareGun } from '../../../test/arsenals'
import {
  atOpenedCase,
  playingModel,
  quietWave,
  withArsenal,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  HOLD_TICKS,
  countdownTicks,
  holdEnter,
  holdFire,
  press,
  release,
  releaseFire,
  tagsOf,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { CASE_SPOTS } from '../../feats/caseSpots'
import { rollCases } from '../../feats/cases'
import { focusOf, modifyFocus } from '../../party/party'
import { WEAPONS, freshGun, gunPierce, isCarrying } from '../weapons'

// The display cases' two guns (src/world/gear/weapons.ts): Old Thunder, the
// hunting rifle, runs each shot through a line of zombies; the Big Blunder
// sprays a wide, short fan of pellets that shoves hard.

const FRAME_MS = FIXED_STEP_MS
const PLAYER_X = 150
// NOTE: the dining room's open floor above the table, clear wall to wall.
const PLAYER_Y = 45
const TOUGH_HP = 40

// NOTE: the player at a fixed spot facing east, holding `kind` in the
// second slot, with `zombies` about.
const holding = (
  kind: WeaponKind,
  zombies: ReadonlyArray<Zombie>,
  loaded?: number,
): Model =>
  modifyFocus(
    modifyFields(withArsenal(quietWave(2), holdingSecond(freshGun(kind))), {
      zombies: () => zombies,
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => PLAYER_X,
          y: () => PLAYER_Y,
          facing: () => ({ x: 1, y: 0 }),
          hp: hp => hp + 50,
          arsenal: arsenal =>
            loaded === undefined
              ? arsenal
              : holdingSecond({ ...freshGun(kind), loaded }),
        }),
    },
  )

const toughAt = (id: number, x: number): Zombie =>
  zombieOf('Shambler', id, x, PLAYER_Y, { hp: TOUGH_HP })

const isHurt = (current: Model, id: number): boolean =>
  Array.some(
    current.zombies,
    zombie => zombie.id === id && zombie.hp < TOUGH_HP,
  )

const xOf = (current: Model, id: number): number =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.id === id),
  ).x

const spareOf = (current: Model) =>
  Option.getOrThrow(maybeSpareGun(focusOf(current).player.arsenal))

// NOTE: one shot, then frames enough for it to fly its whole way.
const oneShot = [holdFire, tick(FRAME_MS), releaseFire, ...ticks(50, FRAME_MS)]

describe('Old Thunder', () => {
  const LINE = [901, 902, 903, 904, 905]
  const line = Array.map(LINE, (id, index) => toughAt(id, 175 + index * 16))

  it.effect(
    'one shot runs through a line of zombies and stops after four',
    () =>
      Story.story(
        APPLICATION,
        Story.given(holding('Rifle', line)),
        ...oneShot,
        Story.model(current => {
          expect(gunPierce('Rifle')).toBe(3)
          expect(Array.map(LINE, id => isHurt(current, id))).toEqual([
            true,
            true,
            true,
            true,
            false,
          ])
        }),
      ),
  )

  it.effect('the Pop Pistol in its place stops at the first', () =>
    Story.story(
      APPLICATION,
      Story.given(holding('Pistol', line)),
      ...oneShot,
      Story.model(current => {
        expect(Array.map(LINE, id => isHurt(current, id))).toEqual([
          true,
          false,
          false,
          false,
          false,
        ])
      }),
    ),
  )

  it.effect('R reloads its small magazine, slowly, and it never runs out', () =>
    Story.story(
      APPLICATION,
      Story.given(holding('Rifle', [], 0)),
      press('KeyR'),
      release('KeyR'),
      ...ticks(countdownTicks(WEAPONS.Rifle.reloadMs) - 1, FRAME_MS),
      Story.model(current => {
        expect(spareOf(current).loaded).toBe(0)
      }),
      tick(FRAME_MS),
      Story.model(current => {
        expect(tagsOf(current.frameEvents)).toContain('Reloaded')
        expect(spareOf(current).loaded).toBe(WEAPONS.Rifle.magazine)
        expect(WEAPONS.Rifle.magazine).toBeLessThan(WEAPONS.Shotgun.magazine)
      }),
    ),
  )
})

describe('the Big Blunder', () => {
  const BLUNDER_SHOT_TICKS = countdownTicks(WEAPONS.Blunderbuss.fireIntervalMs)

  it.effect('one pull sprays a wide fan of pellets', () =>
    Story.story(
      APPLICATION,
      Story.given(holding('Blunderbuss', [])),
      holdFire,
      tick(FRAME_MS),
      Story.model(({ bullets }) => {
        const pellets = Array.filter(
          bullets,
          ({ weapon }) => weapon === 'Blunderbuss',
        )
        expect(pellets).toHaveLength(WEAPONS.Blunderbuss.pellets)
        const angles = Array.map(pellets, ({ velocityX, velocityY }) =>
          Math.atan2(velocityY, velocityX),
        )
        expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.6)
      }),
      releaseFire,
    ),
  )

  it.effect('it shoves a zombie further than the Barn Buster does', () =>
    Effect.gen(function* () {
      const shovedBy = (kind: WeaponKind) =>
        Story.story(
          APPLICATION,
          Story.given(holding(kind, [toughAt(911, 175)])),
          ...oneShot,
        ).pipe(Effect.map(current => xOf(current, 911) - 175))
      const blunder = yield* shovedBy('Blunderbuss')
      const buster = yield* shovedBy('Shotgun')
      expect(buster).toBeGreaterThan(0)
      expect(blunder).toBeGreaterThan(buster)
    }),
  )

  it.effect('its spray falls short of a zombie across the room', () =>
    Story.story(
      APPLICATION,
      Story.given(holding('Blunderbuss', [toughAt(921, PLAYER_X + 110)])),
      ...oneShot,
      Story.model(current => {
        expect(isHurt(current, 921)).toBe(false)
      }),
    ),
  )

  it.effect('two shots empty it and it reloads to two', () =>
    Story.story(
      APPLICATION,
      Story.given(holding('Blunderbuss', [])),
      holdFire,
      ...ticks(BLUNDER_SHOT_TICKS + 1, FRAME_MS),
      releaseFire,
      Story.model(current => {
        expect(spareOf(current).loaded).toBe(0)
      }),
      ...ticks(
        BLUNDER_SHOT_TICKS + countdownTicks(WEAPONS.Blunderbuss.reloadMs) + 2,
        FRAME_MS,
      ),
      Story.model(current => {
        expect(spareOf(current).loaded).toBe(WEAPONS.Blunderbuss.magazine)
      }),
    ),
  )
})

describe('out of the display cases', () => {
  it.effect('Old Thunder comes out of an opened case', () =>
    Story.story(
      APPLICATION,
      Story.given(atOpenedCase(playingModel, 'Rifle')),
      ...holdEnter(HOLD_TICKS),
      Story.model(current => {
        expect(isCarrying(focusOf(current).player, 'Rifle')).toBe(true)
      }),
    ),
  )

  it.effect('the Big Blunder comes out of an opened case', () =>
    Story.story(
      APPLICATION,
      Story.given(atOpenedCase(playingModel, 'Blunderbuss')),
      ...holdEnter(HOLD_TICKS),
      Story.model(current => {
        expect(isCarrying(focusOf(current).player, 'Blunderbuss')).toBe(true)
      }),
    ),
  )

  test('every run puts both in a case, Old Thunder always further in', () => {
    Array.forEach(Array.range(1, 40), seed => {
      const cases = rollCases(seed, 'Normal')
      const prizes = Array.map(cases, ({ prize }) => prize)
      expect(prizes).toContain('Blunderbuss')
      expect(
        Array.every(
          Array.filter(cases, ({ prize }) => prize === 'Rifle'),
          ({ spot }) => CASE_SPOTS[spot]?.isNear === false,
        ),
      ).toBe(true)
      expect(prizes).toContain('Rifle')
    })
  })
})
