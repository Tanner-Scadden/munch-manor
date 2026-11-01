import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ammoLevelOf } from './ammoWarning'
import { playerOfCalling } from './callingPlayer'
import { woundPlayer } from './combat'
import { PLAYER_MAX_HP, PLAYER_SPEED } from './constants'
import { advanceJuice } from './juice'
import { update } from './main'
import { isPanelOpen } from './menuState'
import { Message } from './message'
import { type Model } from './model'
import { readyAfterRead } from './model.fixture'
import { earnKill } from './party'
import type { Calling } from './playerData'
import { playerSpeed } from './powerups'
import { pointsForRank } from './rank'
import { priceFor, tryPurchase, verdictFor } from './shop'
import { besideStall, preparing, shopReady, withMoney } from './shop.fixture'
import { freshGun, heldGun, looseRounds, maybeCarried } from './weapons'
import {
  type CarriedGun,
  GameEvent,
  Invulnerability,
  idleBoosts,
} from './worldSchema'

// Callings (src/calling.ts): the pick on the home menu, a run starting with
// it, and each quirk playing out in the World.

const ranked = (rank: number, calling: Calling): Model =>
  modifyFields(readyAfterRead, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    calling: () => calling,
  })

const started = (model: Model): Model =>
  update(model, Message.ClickedPlayButton()).model

const pickInPicker = (model: Model, calling: Calling): Model =>
  update(
    update(model, Message.ClickedCallingBadge()).model,
    Message.ClickedCallingCardButton({ calling }),
  ).model

describe('a run starts with the calling picked', () => {
  test('YOU holds the pistol and every heart', () => {
    const run = started(ranked(1, 'You'))
    expect(run.player.calling).toBe('You')
    expect(run.player.hp).toBe(PLAYER_MAX_HP)
    expect(heldGun(run.player.arsenal).kind).toBe('Pistol')
  })

  test('the Handyman starts with 4 hearts', () => {
    const run = started(ranked(3, 'Handyman'))
    expect(run.player.calling).toBe('Handyman')
    expect(run.player.hp).toBe(PLAYER_MAX_HP - 1)
  })

  test('a calling its rank has not reached starts as YOU', () => {
    const run = started(ranked(2, 'LineCook'))
    expect(run.calling).toBe('LineCook')
    expect(run.player.calling).toBe('You')
    expect(heldGun(run.player.arsenal).kind).toBe('Pistol')
  })

  test('the Line Cook starts with the Pressure Cooker, not the pistol', () => {
    const run = started(ranked(15, 'LineCook'))
    expect(heldGun(run.player.arsenal).kind).toBe('Cooker')
    expect(maybeCarried(run.player, 'Pistol')).toEqual(Option.none())
    expect(looseRounds(heldGun(run.player.arsenal))).toBeGreaterThan(0)
    expect(heldGun(run.player.arsenal).rounds).toBe(14)
  })

  test('the Track Star starts with a 12 round pistol magazine', () => {
    const run = started(ranked(6, 'TrackStar'))
    expect(heldGun(run.player.arsenal).loaded).toBe(12)
  })
})

describe('the picker', () => {
  test('the key opens it', () => {
    const opened = update(
      ranked(3, 'You'),
      Message.PressedKey({ code: 'KeyY' }),
    )
    expect(isPanelOpen(opened.model, 'Calling')).toBe(true)
  })

  test('picks an unlocked calling, which closes it, and dresses the player', () => {
    const picked = pickInPicker(ranked(3, 'You'), 'Handyman')
    expect(picked.calling).toBe('Handyman')
    expect(picked.player.calling).toBe('Handyman')
    expect(isPanelOpen(picked, 'Calling')).toBe(false)
  })

  test('refuses a locked calling', () => {
    const refused = pickInPicker(ranked(5, 'You'), 'PennyPincher')
    expect(refused.calling).toBe('You')
  })

  test('is never picked during a run', () => {
    const run = started(ranked(6, 'You'))
    const tried = update(
      run,
      Message.ClickedCallingCardButton({ calling: 'TrackStar' }),
    ).model
    expect(tried.calling).toBe('You')
  })
})

describe('the quirks in play', () => {
  const asCalling = (model: Model, calling: Calling): Model =>
    modifyFields(model, {
      player: player => modifyFields(player, { calling: () => calling }),
    })
  const shopping = (calling: Calling): Model =>
    asCalling(withMoney(besideStall(preparing(3)), 500), calling)

  test('the Handyman pays half for a Plank Pile', () => {
    expect(priceFor(shopping('You'), 'Barricade')).toBe(95)
    expect(priceFor(shopping('Handyman'), 'Barricade')).toBe(48)
  })

  test('the Handyman cannot heal past 4 hearts', () => {
    const full = modifyFields(shopping('Handyman'), {
      player: player => modifyFields(player, { hp: () => 4 }),
    })
    expect(verdictFor(full, 'Heart')._tag).toBe('Refused')
    const you = modifyFields(shopping('You'), {
      player: player => modifyFields(player, { hp: () => 4 }),
    })
    expect(verdictFor(you, 'Heart')._tag).toBe('Available')
  })

  test('the Track Star runs faster and fills a smaller magazine', () => {
    const star = shopping('TrackStar').player
    expect(playerSpeed(idleBoosts, star)).toBeCloseTo(PLAYER_SPEED * 1.2)
    const bought = tryPurchase(shopping('TrackStar'), 'Shotgun')
    expect(bought._tag).toBe('Success')
    const gun = Option.getOrThrow(
      Option.flatMap(
        Option.fromNullishOr(bought._tag === 'Success' ? bought.success : null),
        world => maybeCarried(world.player, 'Shotgun'),
      ),
    )
    expect(gun.loaded).toBe(5)
  })

  test('Rattles charges the Penny Pincher 15 percent less', () => {
    expect(priceFor(shopping('You'), 'Shotgun')).toBe(35)
    expect(priceFor(shopping('PennyPincher'), 'Shotgun')).toBe(30)
    expect(priceFor(shopping('PennyPincher'), 'Barricade')).toBe(81)
  })

  test('a kill pays the Penny Pincher less', () => {
    const paid = (calling: Calling) =>
      earnKill(asCalling(shopReady, calling), 20).wallet.balance
    expect(paid('You')).toBe(20)
    expect(paid('PennyPincher')).toBe(16)
  })

  test('Rattles never sells the Line Cook the pistol', () => {
    const cook = shopping('LineCook')
    expect(verdictFor(cook, 'Pistol')._tag).toBe('Refused')
    expect(verdictFor(shopping('You'), 'Pistol')._tag).toBe('Refused')
    const withoutPistol = modifyFields(shopping('You'), {
      player: player =>
        modifyFields(player, {
          arsenal: () => started(ranked(15, 'LineCook')).player.arsenal,
        }),
    })
    expect(verdictFor(withoutPistol, 'Pistol')._tag).toBe('Available')
  })
})

describe('what the player sees of a calling', () => {
  const killed = (calling: Calling): Model =>
    advanceJuice(
      modifyFields(readyAfterRead, {
        player: player => modifyFields(player, { calling: () => calling }),
        frameEvents: () => [
          GameEvent.ZombieKilled({
            x: 100,
            y: 100,
            direction: { x: 1, y: 0 },
            bounty: 20,
            kind: 'Tank',
          }),
        ],
      }),
      16,
      16,
    )

  test('a kill popup shows what the kill paid', () => {
    expect(killed('You').popups.map(({ value }) => value)).toEqual([20])
    expect(killed('PennyPincher').popups.map(({ value }) => value)).toEqual([
      16,
    ])
  })

  test('the low ammo warning reads the Track Star smaller magazine', () => {
    const smg: CarriedGun = { ...freshGun('Smg'), rounds: 56, loaded: 20 }
    expect(ammoLevelOf(smg, 'You')).toBe('Low')
    expect(ammoLevelOf(smg, 'TrackStar')).toBe('Plenty')
  })

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
