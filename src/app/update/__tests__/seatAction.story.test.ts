import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { SHOTGUN, holdingFirst } from '../../../test/arsenals'
import { quietWave, withArsenal } from '../../../test/model.fixture'
import { checkModel, send, storyOf } from '../../../test/testing'
import { inHandOf } from '../../../world/gear/weapons'
import { focusOf, seatCrew } from '../../../world/party/party'
import { withWorld } from '../../../world/schema/world'
import { Message } from '../../message'
import { DebutCard } from '../../model'

describe('the rules single player now shares with the room', () => {
  it.effect(
    'at a shared keyboard, the new zombie card holds no hand, as in a room',
    () =>
      Effect.gen(function* () {
        const couch = withWorld(
          withArsenal(quietWave(3), holdingFirst(SHOTGUN)),
          world => seatCrew(world, 2),
        )
        const couchWithCard = UiStruct.evolve(couch, {
          debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
        })
        const s = yield* storyOf(couchWithCard)
        s.pipe(
          send(Message.ClickedSwapButton()),
          checkModel(current => {
            expect(inHandOf(focusOf(current).player)).toBe('Shotgun')
          }),
        )
      }),
  )
})
