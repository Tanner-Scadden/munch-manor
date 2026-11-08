import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Child } from '../../../app/pureApp'
import { Message as ShopMessage } from '../../../features/shop/message'
import {
  DISTANT_SPAWN,
  quietWave,
  readyModel,
  withArsenal,
  withSeat,
} from '../../../test/model.fixture'
import { SHOTGUN, holdingFirst } from '../../../test/testing'
import { inHandOf } from '../../../world/gear/weapons'
import {
  DEFAULT_ROOM_SETTINGS,
  startRoomWorld,
} from '../../../world/net/roomWorld'
import {
  focusOf,
  modifyFocus,
  seatCrew,
  shopOf,
  slotsOf,
} from '../../../world/party/party'
import { withWorld } from '../../../world/schema/world'
import {
  SeatAction,
  applySeatAction,
  soloInputs,
  stepWorld,
} from '../../../world/step/stepWorld'
import { Message } from '../../message'
import { BreakClock, DebutCard, Phase, ShopState } from '../../model'
import { update } from '../../pureApp'

// Where single player's own copy of a player action disagreed with the
// co-op room's, before both ran the one rule in src/world/step/stepWorld.ts.

describe('the rules single player now shares with the room', () => {
  test('a buy only rings up in a break the shop is open for', () => {
    const browsingMidWave = modifyFocus(
      modifyFields(readyModel, {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      }),
      {
        wallet: () => ({ balance: 500, earned: 500, shown: 500 }),
        shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
      },
    )
    story(
      update,
      given(browsingMidWave),
      message(Child.shop(ShopMessage.ClickedBuyButton({ item: 'Shotgun' }))),
      model(current => {
        expect(focusOf(current).wallet).toEqual(focusOf(browsingMidWave).wallet)
        expect(focusOf(current).player.arsenal).toEqual(
          focusOf(browsingMidWave).player.arsenal,
        )
      }),
    )
  })

  test('at a shared keyboard, the new zombie card holds no hand, as in a room', () => {
    const couch = withWorld(
      withArsenal(quietWave(3), holdingFirst(SHOTGUN)),
      world => seatCrew(world, 2),
    )
    const couchWithCard = modifyFields(couch, {
      debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
    })
    story(
      update,
      given(couchWithCard),
      message(Message.ClickedSwapButton()),
      model(current => {
        expect(inHandOf(focusOf(current).player)).toBe('Shotgun')
      }),
    )
  })
})

describe('the stall outside the break', () => {
  test("a room's wave starting sends a shopper off the counter", () => {
    const { world } = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    const shopping = withSeat(
      modifyFields(world, {
        phase: () =>
          Phase.Preparation({
            wave: 2,
            remainingMs: 20_000,
            durationMs: 20_000,
            clock: BreakClock.Counting(),
            spawns: [DISTANT_SPAWN],
          }),
      }),
      1,
      seatWorld =>
        modifyFocus(seatWorld, {
          shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
        }),
    )
    const readied = Array.reduce(slotsOf(shopping), shopping, (current, slot) =>
      applySeatAction(current, slot, SeatAction.Ready()),
    )
    const stepped = stepWorld(
      readied,
      soloInputs(focusOf(readied).intent),
    ).world
    expect(stepped.phase._tag).toBe('Wave')
    expect(shopOf(stepped, 1)).toEqual(Option.some(ShopState.Dismissed()))
  })
})
