import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { SHOTGUN, holdingFirst } from '../../../test/arsenals'
import { quietWave, withArsenal } from '../../../test/model.fixture'
import { APPLICATION } from '../../../test/testing'
import { inHandOf } from '../../../world/gear/weapons'
import { focusOf, seatCrew } from '../../../world/party/party'
import { withWorld } from '../../../world/schema/world'
import { Message } from '../../message'
import { DebutCard } from '../../model'

// Where single player's own copy of a player action disagreed with the
// co-op room's, before both ran the one rule in src/world/step/stepWorld.ts.

describe('the rules single player now shares with the room', () => {
  it.effect(
    'at a shared keyboard, the new zombie card holds no hand, as in a room',
    () => {
      const couch = withWorld(
        withArsenal(quietWave(3), holdingFirst(SHOTGUN)),
        world => seatCrew(world, 2),
      )
      const couchWithCard = modifyFields(couch, {
        debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
      })
      return Story.story(
        APPLICATION,
        Story.given(couchWithCard),
        Story.message(Message.ClickedSwapButton()),
        Story.model(current => {
          expect(inHandOf(focusOf(current).player)).toBe('Shotgun')
        }),
      )
    },
  )
})
