import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  Frenzy,
  Invulnerability,
  type Model,
  Phase,
  type Vector,
  type Zombie,
} from '../../../app/model'
import { initialModel, update } from '../../../app/pureApp'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import { ticks, westPlank, zombieOf } from '../../../test/testing'
import { modifyFocus } from '../../party/party'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import { TRAPS } from '../traps'

const FRAME_MS = 50
const SPEED = 20

const NEAR_WEST_PLANK: Vector = { x: 45, y: 90 }
const FAR_FROM_PLANKS: Vector = { x: 95, y: 90 }
const PLAYER_AT: Vector = { x: 250, y: 90 }

const fightingWith = (zombie: Zombie): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      traps: () => [westPlank],
      zombies: () => [zombie],
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => PLAYER_AT.x,
          y: () => PLAYER_AT.y,
          invulnerability: () =>
            Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
        }),
    },
  )

const onlyZombie = (current: Model): Zombie =>
  Option.getOrThrow(Array.head(current.zombies))

const plankHp = (current: Model): number =>
  Option.match(Array.head(current.traps), {
    onNone: () => 0,
    onSome: ({ hp }) => hp,
  })

describe('planks as bait', () => {
  test('a Groaner near a Plank Pile walks over and chews it instead of chasing the player', () => {
    story(
      update,
      given(
        fightingWith(
          zombieOf('Shambler', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      model(current => {
        expect(onlyZombie(current).x).toBeLessThan(NEAR_WEST_PLANK.x - 10)
      }),
      ...ticks(40, FRAME_MS),
      model(current => {
        expect(plankHp(current)).toBeLessThan(TRAPS.Barricade.hp - 3)
        expect(onlyZombie(current).x).toBeLessThan(NEAR_WEST_PLANK.x)
      }),
    )
  })

  test('a Big Lug is drawn too, and chews much faster', () => {
    story(
      update,
      given(
        fightingWith(
          zombieOf('Tank', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(60, FRAME_MS),
      model(current => {
        expect(plankHp(current)).toBeLessThan(TRAPS.Barricade.hp - 10)
      }),
    )
  })

  test('a Hotfoot ignores the plank and goes for the player', () => {
    story(
      update,
      given(
        fightingWith(
          zombieOf('Runner', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 10)
        expect(plankHp(current)).toBe(TRAPS.Barricade.hp)
      }),
    )
  })

  test('a Kaboomer and a Big Leaguer ignore the plank too', () => {
    expect(ZOMBIE_KINDS.Exploder.bait).toBe('Ignores')
    expect(ZOMBIE_KINDS.Thrower.bait).toBe('Ignores')
    story(
      update,
      given(
        fightingWith(
          zombieOf('Thrower', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 3)
        expect(plankHp(current)).toBe(TRAPS.Barricade.hp)
      }),
    )
  })

  test('a frenzied Groaner only has eyes for the player', () => {
    story(
      update,
      given(
        fightingWith(
          zombieOf('Shambler', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
            frenzy: Frenzy.Frenzied({ pack: 1, apartMs: 0 }),
          }),
        ),
      ),
      ...ticks(10, FRAME_MS),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 5)
      }),
    )
  })

  test('a Groaner beyond the pull radius chases the player', () => {
    story(
      update,
      given(
        fightingWith(
          zombieOf('Shambler', 50, FAR_FROM_PLANKS.x, FAR_FROM_PLANKS.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(FAR_FROM_PLANKS.x + 10)
      }),
    )
  })

  test('a Groaner nearer the player than the plank goes for the player', () => {
    story(
      update,
      given(
        modifyFocus(
          fightingWith(
            zombieOf('Shambler', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
              speed: SPEED,
            }),
          ),
          {
            player: player =>
              modifyFields(player, { x: () => 70, y: () => 90 }),
          },
        ),
      ),
      ...ticks(10, FRAME_MS),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 5)
      }),
    )
  })
})
