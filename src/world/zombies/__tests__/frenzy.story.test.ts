import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  Frenzy,
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  APPLICATION,
  bulletInto,
  tick,
  ticks,
  zombieAt,
} from '../../../test/testing'
import { PARLOUR } from '../../level/arena'
import { focusOf, modifyFocus } from '../../party/party'
import { rollSpawns } from '../../waves/endlessWaves'
import { FRENZY_RULES, frenzyPace, frenzyPacksOf } from '../frenzy'

const FRAME_MS = FIXED_STEP_MS
const CENTER_X = PARLOUR.width / 2
const CENTER_Y = PARLOUR.height / 2

const spawnOf = (
  pack: number,
  atMs: number,
  kind: PlannedSpawn['kind'] = 'Shambler',
): PlannedSpawn => ({
  atMs,
  kind,
  door: 'West',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation: 'Squad',
})

const packOf = (
  pack: number,
  size: number,
  atMs = 0,
): ReadonlyArray<PlannedSpawn> =>
  Array.makeBy(size, index => spawnOf(pack, atMs + index * 180))

const DISTANT_SPAWN = spawnOf(99_999, 1e9)

const sturdyIn = (spawns: ReadonlyArray<PlannedSpawn>): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Wave({
          wave: 3,
          elapsedMs: 0,
          spawns: [...spawns, DISTANT_SPAWN],
        }),
      frenzyPacks: () => frenzyPacksOf(spawns),
    }),
    {
      player: player =>
        modifyFields(player, {
          hp: () => 1e6,
          invulnerability: () =>
            Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
        }),
    },
  )

const frenziedOf = (current: Model): ReadonlyArray<Zombie> =>
  Array.filter(current.zombies, zombie =>
    Frenzy.isAnyOf(['Frenzied'])(zombie.frenzy),
  )

describe('horde frenzy', () => {
  it.effect('a pack of four or more frenzies, a pack of three does not', () => {
    const four = packOf(1, 4)
    const three = packOf(2, 3, 2000)
    expect(frenzyPacksOf([...four, ...three])).toEqual([
      { pack: 1, left: 4, bonus: 4 * FRENZY_RULES.bonusPerZombie },
    ])

    return Story.story(
      APPLICATION,
      Story.given(sturdyIn([...four, ...three])),
      ...ticks(200, FRAME_MS),
      Story.model(current => {
        const byPack = (pack: number) =>
          Array.filter(current.zombies, zombie =>
            Frenzy.match(zombie.frenzy, {
              Calm: () => false,
              Frenzied: frenzied => frenzied.pack === pack,
              Fading: fading => fading.pack === pack,
              Spent: spent => spent.pack === pack,
            }),
          )
        expect(byPack(1)).toHaveLength(4)
        expect(byPack(2)).toHaveLength(0)
        expect(
          Array.filter(current.zombies, zombie =>
            Frenzy.isAnyOf(['Calm'])(zombie.frenzy),
          ),
        ).toHaveLength(3)
      }),
    )
  })

  it.effect(
    'the pack warning rings a HORDE! callout and a frenzied zombie is about a sixth faster',
    () => {
      const calm = zombieAt(1, 40, 40, {
        frenzy: Frenzy.Calm(),
        hp: 1,
        maxHp: 3,
      })
      const frenzied = zombieAt(2, 40, 50, {
        frenzy: Frenzy.Frenzied({ pack: 1, apartMs: 0 }),
        hp: 1,
        maxHp: 3,
      })
      expect(frenzyPace(calm)).toBe(1)
      expect(frenzyPace(frenzied)).toBeGreaterThanOrEqual(1.15)
      expect(frenzyPace(frenzied)).toBeLessThanOrEqual(1.2)

      return Story.story(
        APPLICATION,
        Story.given(sturdyIn(packOf(1, 5, 1500))),
        ...ticks(40, FRAME_MS),
        Story.model(current => {
          expect(
            Array.some(current.popups, ({ kind }) => kind === 'Horde'),
          ).toBe(true)
        }),
      )
    },
  )

  it.effect(
    'the frenzy fades from a straggler that drifts away from its pack',
    () => {
      const pack = Frenzy.Frenzied({ pack: 7, apartMs: 0 })
      const together = [
        zombieAt(1, 40, 40, { frenzy: pack }),
        zombieAt(2, 48, 40, { frenzy: pack }),
        zombieAt(3, 40, 48, { frenzy: pack }),
      ]
      const straggler = zombieAt(4, 280, 160, { frenzy: pack })
      const start = modifyFocus(
        modifyFields(sturdyIn([]), {
          zombies: () => [...together, straggler],
          frenzyPacks: () => [{ pack: 7, left: 4, bonus: 4 }],
        }),
        {
          player: player =>
            modifyFields(player, { x: () => CENTER_X, y: () => CENTER_Y }),
        },
      )
      // NOTE: the ticks to drift apart, one that starts the fade, and one
      // into it, so the pace has begun to drop.
      const apartFrames = Math.ceil(FRENZY_RULES.apartMs / FRAME_MS) + 2
      const fadeFrames = Math.ceil(FRENZY_RULES.fadeMs / FRAME_MS) + 1

      return Story.story(
        APPLICATION,
        Story.given(start),
        ...ticks(apartFrames, FRAME_MS),
        Story.model(current => {
          const loner = Option.getOrThrow(
            Array.findFirst(current.zombies, ({ id }) => id === 4),
          )
          expect(Frenzy.isAnyOf(['Fading'])(loner.frenzy)).toBe(true)
          expect(frenzyPace(loner)).toBeLessThan(FRENZY_RULES.paceScale)
          expect(frenziedOf(current)).toHaveLength(3)
        }),
        ...ticks(fadeFrames, FRAME_MS),
        Story.model(current => {
          const loner = Option.getOrThrow(
            Array.findFirst(current.zombies, ({ id }) => id === 4),
          )
          expect(loner.frenzy).toEqual(Frenzy.Spent({ pack: 7 }))
          expect(frenzyPace(loner)).toBe(1)
        }),
      )
    },
  )

  it.effect('wiping out the whole pack pays its bonus once', () =>
    Effect.gen(function* () {
      const pack = Frenzy.Frenzied({ pack: 3, apartMs: 0 })
      const first = zombieAt(1, 60, 85, { frenzy: pack, hp: 1, maxHp: 3 })
      const second = zombieAt(2, 66, 85, {
        frenzy: Frenzy.Spent({ pack: 3 }),
        hp: 1,
        maxHp: 3,
      })
      const start = modifyFields(sturdyIn([]), {
        zombies: () => [first, second],
        frenzyPacks: () => [{ pack: 3, left: 2, bonus: 9 }],
      })

      yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFields(start, {
            bullets: () => [
              bulletInto(500, first, { damage: 5, knockback: 0 }),
            ],
          }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(current.frenzyPacks).toEqual([{ pack: 3, left: 1, bonus: 9 }])
          expect(
            Array.some(current.frameEvents, GameEvent.isAnyOf(['PackWiped'])),
          ).toBe(false)
        }),
      )

      yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFields(start, {
            bullets: () => [
              bulletInto(500, first, { damage: 5, knockback: 0 }),
              bulletInto(501, second, { damage: 5, knockback: 0 }),
            ],
          }),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          const wiped = Array.filter(
            current.frameEvents,
            GameEvent.isAnyOf(['PackWiped']),
          )
          expect(wiped).toHaveLength(1)
          expect(Array.map(wiped, ({ bonus }) => bonus)).toEqual([9])
          expect(current.frenzyPacks).toEqual([])
          expect(
            focusOf(current).wallet.earned - focusOf(start).wallet.earned,
          ).toBe(9 + 2 * 2)
        }),
        ...ticks(3, FRAME_MS),
        Story.model(current => {
          expect(
            Array.some(current.frameEvents, GameEvent.isAnyOf(['PackWiped'])),
          ).toBe(false)
        }),
      )
    }),
  )

  test('the same seed rolls the same frenzy packs', () => {
    const [, first] = rollSpawns(4242, 6)
    const [, again] = rollSpawns(4242, 6)
    expect(frenzyPacksOf(first)).toEqual(frenzyPacksOf(again))
    expect(Array.isReadonlyArrayNonEmpty(frenzyPacksOf(first))).toBe(true)
  })
})
