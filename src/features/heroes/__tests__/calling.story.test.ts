import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { Dialog } from '@foldkit/ui'

import { LobbyBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { PLAYER_MAX_HP, PLAYER_SPEED } from '../../../shared/constants'
import type { Calling } from '../../../shared/playerData'
import { heroesBoughtBy, readyAfterRead } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  press,
  resolveFocusLobby,
  showDialog,
  tapLobbyHero,
  writeSave,
} from '../../../test/testing'
import { giveWeapon } from '../../../world/fridge/leftovers'
import { playerSpeed } from '../../../world/gear/powerups'
import { heldGun, maybeCarried } from '../../../world/gear/weapons'
import { playerOfCalling } from '../../../world/heroes/callingPlayer'
import { pointsForRank } from '../../../world/heroes/rank'
import { dropKeys } from '../../../world/keys/keys'
import { focusOf, modifyFocus } from '../../../world/party/party'
import {
  GameEvent,
  Invulnerability,
  idleBoosts,
} from '../../../world/schema/worldSchema'
import { woundPlayer } from '../../../world/step/combat'
import { isHeroPickerUp } from '../../lobby/model'

// Callings (src/world/heroes/calling.ts): the pick on the home menu, a run starting with
// it, and each quirk playing out in the World.

const ranked = (rank: number, calling: Calling): Model =>
  modifyFields(readyAfterRead, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

// NOTE: PLAY opens the lobby with START focused.
const openLobby = Story.steps(
  Story.message(Message.ClickedPlayButton()),
  resolveFocusLobby(),
)

const clickStart = Story.messageIn(
  LobbyBinding,
  LobbyMessage.ClickedStartButton(),
)

// NOTE: the hero card opens the picker, which marks the heroes this rank
// has reached as seen, and a card is tapped in it.
const pickInPicker = (calling: Calling) =>
  Story.steps(
    Story.messageIn(LobbyBinding, LobbyMessage.ClickedHeroButton()),
    showDialog(),
    writeSave(),
    tapLobbyHero(calling),
  )

// NOTE: the run a player of this rank and calling starts from the lobby.
const startedAs = (rank: number, calling: Calling) =>
  Story.story(
    APPLICATION,
    Story.given(ranked(rank, calling)),
    openLobby,
    clickStart,
  )

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
    Story.story(
      APPLICATION,
      Story.given(ranked(3, 'You')),
      openLobby,
      press('KeyY'),
      Story.model(current => {
        expect(isHeroPickerUp(current.lobby)).toBe(true)
      }),
      showDialog(),
      writeSave(),
    ),
  )

  it.effect(
    'picks an unlocked calling, which closes it, and dresses the player',
    () =>
      Story.story(
        APPLICATION,
        Story.given(ranked(3, 'You')),
        openLobby,
        pickInPicker('Handyman'),
        Story.model(picked => {
          expect(picked.calling).toBe('Handyman')
          expect(focusOf(picked).player.calling).toBe('Handyman')
          expect(isHeroPickerUp(picked.lobby)).toBe(false)
        }),
        Story.Command.expectExact(Dialog.test.CloseDialog, WriteSave),
        closeDialog(),
        writeSave(),
      ),
  )

  it.effect('refuses a locked calling', () =>
    Story.story(
      APPLICATION,
      Story.given(ranked(5, 'You')),
      openLobby,
      pickInPicker('PennyPincher'),
      Story.model(refused => {
        expect(refused.calling).toBe('You')
      }),
    ),
  )

  it.effect('is never picked during a run', () =>
    Story.story(
      APPLICATION,
      Story.given(ranked(6, 'You')),
      openLobby,
      clickStart,
      tapLobbyHero('TrackStar'),
      Story.model(tried => {
        expect(tried.calling).toBe('You')
      }),
    ),
  )
})

describe('the quirks in play', () => {
  const asCalling = (model: Model, calling: Calling): Model =>
    modifyFocus(model, {
      player: player => modifyFields(player, { calling: () => calling }),
    })

  test('the Track Star runs faster and fills a smaller magazine', () => {
    const star = focusOf(asCalling(readyAfterRead, 'TrackStar')).player
    expect(playerSpeed(idleBoosts, star)).toBeCloseTo(PLAYER_SPEED * 1.2)
    const gun = Option.getOrThrow(maybeCarried(giveWeapon(star, 'Smg'), 'Smg'))
    expect(gun.loaded).toBe(29)
  })

  // NOTE: a Big Lug drops two keys whole, so no roll comes into it.
  test("the Penny Pincher's kills drop half again as many keys", () => {
    const keysFrom = (calling: Calling): number =>
      dropKeys(
        modifyFields(asCalling(readyAfterRead, calling), {
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
