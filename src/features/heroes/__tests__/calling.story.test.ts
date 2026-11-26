import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { type Model } from '#app/model.ts'
import { WriteSave } from '#app/update/save.ts'
import { LobbyMessage } from '#features/lobby/message.ts'
import { isHeroPickerUp } from '#features/lobby/model.ts'
import { PLAYER_MAX_HP, PLAYER_SPEED } from '#shared/constants.ts'
import type { Calling } from '#shared/records/playerData.ts'
import { heroesBoughtBy, readyAfterRead } from '#test/model.fixture.ts'
import {
  type StoryStep,
  modelAfter,
  openLobbyByTap,
  press,
  send,
  steps,
  storyOf,
  tapLobbyHero,
  writeSave,
} from '#test/testing.ts'
import { giveWeapon } from '#world/fridge/leftovers.ts'
import { playerSpeed } from '#world/gear/powerups.ts'
import { heldGun, maybeCarried } from '#world/gear/weapons.ts'
import { playerOfCalling } from '#world/heroes/callingPlayer.ts'
import { pointsForRank } from '#world/heroes/rank.ts'
import { dropKeys } from '#world/keys/keys.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'
import {
  GameEvent,
  Invulnerability,
  idleBoosts,
} from '#world/schema/worldSchema.ts'
import { woundPlayer } from '#world/step/combat.ts'

const ranked = (rank: number, calling: Calling): Model =>
  UiStruct.evolve(readyAfterRead, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

const clickStart: StoryStep = send(LobbyMessage.RequestedStartFromLobby())

const pickInPicker = (calling: Calling): StoryStep =>
  steps(
    send(LobbyMessage.RequestedLobbyHeroPicker()),
    writeSave,
    tapLobbyHero(calling),
  )

const startedAs = (rank: number, calling: Calling): Effect.Effect<Model> =>
  modelAfter(ranked(rank, calling), steps(openLobbyByTap, clickStart))

describe('a run starts with the calling picked', () => {
  it.effect('YOU holds the pistol and every heart', () =>
    Effect.map(startedAs(1, 'You'), run => {
      expect(focusOf(run).player.calling).toBe('You')
      expect(focusOf(run).player.hp).toBe(PLAYER_MAX_HP)
      expect(heldGun(focusOf(run).player.arsenal).kind).toBe('Pistol')
    }),
  )

  it.effect('the Handyman starts with 4 hearts', () =>
    Effect.map(startedAs(3, 'Handyman'), run => {
      expect(focusOf(run).player.calling).toBe('Handyman')
      expect(focusOf(run).player.hp).toBe(PLAYER_MAX_HP - 1)
    }),
  )

  it.effect('a calling its rank has not reached starts as YOU', () =>
    Effect.map(startedAs(2, 'LineCook'), run => {
      expect(run.calling).toBe('LineCook')
      expect(focusOf(run).player.calling).toBe('You')
      expect(heldGun(focusOf(run).player.arsenal).kind).toBe('Pistol')
    }),
  )

  it.effect(
    'the Line Cook starts with the Pressure Cooker, not the pistol',
    () =>
      Effect.map(startedAs(15, 'LineCook'), run => {
        expect(heldGun(focusOf(run).player.arsenal).kind).toBe('Cooker')
        expect(maybeCarried(focusOf(run).player, 'Pistol')).toEqual(
          Option.none(),
        )
        expect(heldGun(focusOf(run).player.arsenal).loaded).toBe(4)
      }),
  )

  it.effect('the Track Star starts with a 13 round pistol magazine', () =>
    Effect.map(startedAs(6, 'TrackStar'), run => {
      expect(heldGun(focusOf(run).player.arsenal).loaded).toBe(13)
    }),
  )
})

describe('the picker', () => {
  it.effect('the key opens it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(ranked(3, 'You'))
      s.pipe(openLobbyByTap, press('KeyY'))
      expect(isHeroPickerUp(s.model.lobby)).toBe(true)
      writeSave(s)
    }),
  )

  it.effect(
    'picks an unlocked calling, which closes it, and dresses the player',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(ranked(3, 'You'))
        s.pipe(openLobbyByTap, pickInPicker('Handyman'))
        expect(s.model.calling).toBe('Handyman')
        expect(focusOf(s.model).player.calling).toBe('Handyman')
        expect(isHeroPickerUp(s.model.lobby)).toBe(false)
        s.expectExact(WriteSave)
        writeSave(s)
      }),
  )

  it.effect('refuses a locked calling', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(ranked(5, 'You'))
      s.pipe(openLobbyByTap, pickInPicker('PennyPincher'))
      expect(s.model.calling).toBe('You')
    }),
  )

  it.effect('is never picked during a run', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(ranked(6, 'You'))
      s.pipe(openLobbyByTap, clickStart, tapLobbyHero('TrackStar'))
      expect(s.model.calling).toBe('You')
    }),
  )
})

describe('the quirks in play', () => {
  const asCalling = (model: Model, calling: Calling): Model =>
    modifyFocus(model, {
      player: player => UiStruct.evolve(player, { calling: () => calling }),
    })

  test('the Track Star runs faster and fills a smaller magazine', () => {
    const star = focusOf(asCalling(readyAfterRead, 'TrackStar')).player
    expect(playerSpeed(idleBoosts, star)).toBeCloseTo(PLAYER_SPEED * 1.2)
    const gun = Option.getOrThrow(maybeCarried(giveWeapon(star, 'Smg'), 'Smg'))
    expect(gun.loaded).toBe(29)
  })

  test("the Penny Pincher's kills drop half again as many keys", () => {
    const keysFrom = (calling: Calling): number =>
      dropKeys(
        UiStruct.evolve(asCalling(readyAfterRead, calling), {
          frameEvents: () => [
            GameEvent.ZombieKilled({
              x: 100,
              y: 100,
              direction: { x: 1, y: 0 },
              kind: 'Tank',
              maybeKiller: Option.none(),
              source: 'Other',
            }),
          ],
        }),
      ).keys.held
    expect(keysFrom('You')).toBe(2)
    expect(keysFrom('PennyPincher')).toBe(3)
  })
})

describe('what the player sees of a calling', () => {
  test('a bite leaves the Handyman 50 percent longer to get clear', () => {
    const grace = (calling: Calling): number =>
      Invulnerability.match(
        woundPlayer(playerOfCalling(calling), 1, { x: 1, y: 0 })
          .invulnerability,
        { Vulnerable: () => 0, Invulnerable: ({ durationMs }) => durationMs },
      )
    expect(grace('Handyman')).toBe(grace('You') * 2)
  })
})
