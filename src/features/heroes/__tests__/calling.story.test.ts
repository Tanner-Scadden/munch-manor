import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { Child, update } from '../../../app/pureApp'
import { Message as HeroPickerMessage } from '../../../features/heroes/message'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { advanceJuice } from '../../../render/juice'
import { PLAYER_MAX_HP, PLAYER_SPEED } from '../../../shared/constants'
import type { Calling } from '../../../shared/playerData'
import { heroesBoughtBy, readyAfterRead } from '../../../test/model.fixture'
import { modelAfter } from '../../../test/testing'
import { playerSpeed } from '../../../world/gear/powerups'
import {
  freshGun,
  heldGun,
  looseRounds,
  maybeCarried,
} from '../../../world/gear/weapons'
import { playerOfCalling } from '../../../world/heroes/callingPlayer'
import { pointsForRank } from '../../../world/heroes/rank'
import {
  earnKill,
  focusOf,
  focusSlotOf,
  modifyFocus,
} from '../../../world/party/party'
import {
  type CarriedGun,
  GameEvent,
  Invulnerability,
  idleBoosts,
} from '../../../world/schema/worldSchema'
import { priceFor, tryPurchase, verdictFor } from '../../../world/shop/shop'
import { woundPlayer } from '../../../world/step/combat'
import { ammoLevelOf } from '../../hud/ammoWarning'
import { isHeroPickerUp } from '../../lobby/model'
import {
  besideStall,
  preparing,
  shopReady,
  withMoney,
} from '../../shop/__tests__/shop.fixture'

// Callings (src/world/heroes/calling.ts): the pick on the home menu, a run starting with
// it, and each quirk playing out in the World.

const ranked = (rank: number, calling: Calling): Model =>
  modifyFields(readyAfterRead, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

const inLobby = (model: Model): Model =>
  modelAfter(model, Message.ClickedPlayButton())

const started = (model: Model): Model =>
  modelAfter(inLobby(model), Child.lobby(LobbyMessage.ClickedStartButton()))

const pickInPicker = (model: Model, calling: Calling): Model =>
  modelAfter(
    modelAfter(inLobby(model), Child.lobby(LobbyMessage.ClickedHeroButton())),
    Child.lobbyHero(HeroPickerMessage.ClickedCard({ calling })),
  )

describe('a run starts with the calling picked', () => {
  test('YOU holds the pistol and every heart', () => {
    const run = started(ranked(1, 'You'))
    expect(focusOf(run).player.calling).toBe('You')
    expect(focusOf(run).player.hp).toBe(PLAYER_MAX_HP)
    expect(heldGun(focusOf(run).player.arsenal).kind).toBe('Pistol')
  })

  test('the Handyman starts with 4 hearts', () => {
    const run = started(ranked(3, 'Handyman'))
    expect(focusOf(run).player.calling).toBe('Handyman')
    expect(focusOf(run).player.hp).toBe(PLAYER_MAX_HP - 1)
  })

  test('a calling its rank has not reached starts as YOU', () => {
    const run = started(ranked(2, 'LineCook'))
    expect(run.calling).toBe('LineCook')
    expect(focusOf(run).player.calling).toBe('You')
    expect(heldGun(focusOf(run).player.arsenal).kind).toBe('Pistol')
  })

  test('the Line Cook starts with the Pressure Cooker, not the pistol', () => {
    const run = started(ranked(15, 'LineCook'))
    expect(heldGun(focusOf(run).player.arsenal).kind).toBe('Cooker')
    expect(maybeCarried(focusOf(run).player, 'Pistol')).toEqual(Option.none())
    expect(looseRounds(heldGun(focusOf(run).player.arsenal))).toBeGreaterThan(0)
    expect(heldGun(focusOf(run).player.arsenal).rounds).toBe(14)
  })

  test('the Track Star starts with a 13 round pistol magazine', () => {
    const run = started(ranked(6, 'TrackStar'))
    expect(heldGun(focusOf(run).player.arsenal).loaded).toBe(13)
  })
})

describe('the picker', () => {
  test('the key opens it', () => {
    const opened = update(
      inLobby(ranked(3, 'You')),
      Message.PressedKey({ code: 'KeyY' }),
    )
    expect(isHeroPickerUp(opened.model.lobby)).toBe(true)
  })

  test('picks an unlocked calling, which closes it, and dresses the player', () => {
    const picked = pickInPicker(ranked(3, 'You'), 'Handyman')
    expect(picked.calling).toBe('Handyman')
    expect(focusOf(picked).player.calling).toBe('Handyman')
    expect(isHeroPickerUp(picked.lobby)).toBe(false)
  })

  test('refuses a locked calling', () => {
    const refused = pickInPicker(ranked(5, 'You'), 'PennyPincher')
    expect(refused.calling).toBe('You')
  })

  test('is never picked during a run', () => {
    const run = started(ranked(6, 'You'))
    const tried = update(
      run,
      Child.lobbyHero(HeroPickerMessage.ClickedCard({ calling: 'TrackStar' })),
    ).model
    expect(tried.calling).toBe('You')
  })
})

describe('the quirks in play', () => {
  const asCalling = (model: Model, calling: Calling): Model =>
    modifyFocus(model, {
      player: player => modifyFields(player, { calling: () => calling }),
    })
  const shopping = (calling: Calling): Model =>
    asCalling(withMoney(besideStall(preparing(3)), 500), calling)

  test('the Handyman pays half for a Plank Pile', () => {
    expect(
      priceFor(shopping('You'), focusSlotOf(shopping('You')), 'Barricade'),
    ).toBe(95)
    expect(
      priceFor(
        shopping('Handyman'),
        focusSlotOf(shopping('Handyman')),
        'Barricade',
      ),
    ).toBe(48)
  })

  test('the Handyman cannot heal past 4 hearts', () => {
    const full = modifyFocus(shopping('Handyman'), {
      player: player => modifyFields(player, { hp: () => 4 }),
    })
    expect(verdictFor(full, focusSlotOf(full), 'Heart')._tag).toBe('Refused')
    const you = modifyFocus(shopping('You'), {
      player: player => modifyFields(player, { hp: () => 4 }),
    })
    expect(verdictFor(you, focusSlotOf(you), 'Heart')._tag).toBe('Available')
  })

  test('the Track Star runs faster and fills a smaller magazine', () => {
    const star = focusOf(shopping('TrackStar')).player
    expect(playerSpeed(idleBoosts, star)).toBeCloseTo(PLAYER_SPEED * 1.2)
    const bought = tryPurchase(
      shopping('TrackStar'),
      focusSlotOf(shopping('TrackStar')),
      'Smg',
    )
    expect(bought._tag).toBe('Success')
    const gun = Option.getOrThrow(
      Option.flatMap(
        Option.fromNullishOr(bought._tag === 'Success' ? bought.success : null),
        world => maybeCarried(focusOf(world).player, 'Smg'),
      ),
    )
    expect(gun.loaded).toBe(29)
  })

  test('Rattles charges the Penny Pincher 15 percent less', () => {
    expect(
      priceFor(shopping('You'), focusSlotOf(shopping('You')), 'Shotgun'),
    ).toBe(35)
    expect(
      priceFor(
        shopping('PennyPincher'),
        focusSlotOf(shopping('PennyPincher')),
        'Shotgun',
      ),
    ).toBe(30)
    expect(
      priceFor(
        shopping('PennyPincher'),
        focusSlotOf(shopping('PennyPincher')),
        'Barricade',
      ),
    ).toBe(81)
  })

  test('a kill pays the Penny Pincher less', () => {
    const paid = (calling: Calling) => {
      const model = asCalling(shopReady, calling)
      return focusOf(earnKill(model, focusSlotOf(model), 20)).wallet.balance
    }
    expect(paid('You')).toBe(20)
    expect(paid('PennyPincher')).toBe(16)
  })

  test('Rattles never sells the Line Cook the pistol', () => {
    const cook = shopping('LineCook')
    expect(verdictFor(cook, focusSlotOf(cook), 'Pistol')._tag).toBe('Refused')
    expect(
      verdictFor(shopping('You'), focusSlotOf(shopping('You')), 'Pistol')._tag,
    ).toBe('Refused')
    const withoutPistol = modifyFocus(shopping('You'), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            focusOf(started(ranked(15, 'LineCook'))).player.arsenal,
        }),
    })
    expect(
      verdictFor(withoutPistol, focusSlotOf(withoutPistol), 'Pistol')._tag,
    ).toBe('Available')
  })
})

describe('what the player sees of a calling', () => {
  const killed = (calling: Calling): Model =>
    advanceJuice(
      modifyFocus(
        modifyFields(readyAfterRead, {
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
        { player: player => modifyFields(player, { calling: () => calling }) },
      ),
      16,
      16,
    )

  test('a kill popup shows what the kill paid', () => {
    expect(Array.map(killed('You').popups, ({ value }) => value)).toEqual([20])
    expect(
      Array.map(killed('PennyPincher').popups, ({ value }) => value),
    ).toEqual([16])
  })

  test('the low ammo warning reads the Track Star smaller magazine', () => {
    const smg: CarriedGun = { ...freshGun('Smg'), rounds: 59, loaded: 20 }
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
