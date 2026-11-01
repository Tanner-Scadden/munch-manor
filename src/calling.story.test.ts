import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PLAYER_MAX_HP, PLAYER_SPEED } from './constants'
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
import { heldGun, looseRounds, maybeCarried } from './weapons'
import { idleBoosts } from './worldSchema'

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
  })

  test('the Track Star starts with an 11 round pistol magazine', () => {
    const run = started(ranked(6, 'TrackStar'))
    expect(heldGun(run.player.arsenal).loaded).toBe(11)
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
    expect(priceFor(shopping('You'), 'Barricade')).toBe(40)
    expect(priceFor(shopping('Handyman'), 'Barricade')).toBe(20)
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
    expect(playerSpeed(idleBoosts, star)).toBeCloseTo(PLAYER_SPEED * 1.1)
    const bought = tryPurchase(shopping('TrackStar'), 'Shotgun')
    expect(bought._tag).toBe('Success')
    const gun = Option.getOrThrow(
      Option.flatMap(
        Option.fromNullishOr(bought._tag === 'Success' ? bought.success : null),
        world => maybeCarried(world.player, 'Shotgun'),
      ),
    )
    expect(gun.loaded).toBe(4)
  })

  test('Rattles charges the Penny Pincher 15 percent less', () => {
    expect(priceFor(shopping('You'), 'Shotgun')).toBe(35)
    expect(priceFor(shopping('PennyPincher'), 'Shotgun')).toBe(30)
    expect(priceFor(shopping('PennyPincher'), 'Barricade')).toBe(34)
  })

  test('a kill pays the Penny Pincher 15 percent less', () => {
    const paid = (calling: Calling) =>
      earnKill(asCalling(shopReady, calling), 20).wallet.balance
    expect(paid('You')).toBe(20)
    expect(paid('PennyPincher')).toBe(17)
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
