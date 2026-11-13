import { Array, Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import {
  MISSION_RULES,
  type MissionId,
  noMissions,
} from '../../../shared/missionData'
import { home, knowingDay } from '../../../test/model.fixture'
import {
  APPLICATION,
  measureSurface,
  showDialogInScene,
} from '../../../test/testing'
import { MISSIONS_TITLE, MISSION_NAMES } from '../../../world/names'
import { missionsOn } from '../missions'

// The home menu's mission card (src/features/missions/missionCard.ts): the
// day's three as pictures with bars, which open the panel of rows with the
// day's reroll.

const TODAY = '2026-11-12'

const rolled = missionsOn(knowingDay(home, TODAY), TODAY)
const idAt = (slot: number): MissionId =>
  Option.getOrThrow(Array.get(rolled, slot))
const small = idAt(0)
const medium = idAt(1)
const large = idAt(2)

const untouched = (id: MissionId): string =>
  `${MISSION_NAMES[id]}: 0 of ${MISSION_RULES[id].goal}`

// NOTE: the day's Medium done, the other two untouched.
const started = modifyFields(knowingDay(home, TODAY), {
  missions: () => ({
    ...noMissions,
    day: TODAY,
    progress: { [medium]: MISSION_RULES[medium].goal },
    claimed: [medium],
  }),
})

const card = Scene.selector('.mission-card')
const panel = Scene.role('dialog', { name: MISSIONS_TITLE })

describe('the mission card', () => {
  it.effect('is not on the menu before the day is known', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      Scene.expect(card).toBeAbsent(),
    ),
  )

  it.effect(
    'shows the three, the done one checked, and opens their panel',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(started),
        measureSurface,
        Scene.expectAll(Scene.all.selector('.mission-pip')).toHaveCount(3),
        Scene.expectAll(
          Scene.all.selector(".mission-pip[data-done='true']"),
        ).toHaveCount(1),
        Scene.expect(card).toHaveAttr(
          'aria-label',
          `${MISSIONS_TITLE}: ${untouched(small)}, ${MISSION_NAMES[medium]}: done, ${untouched(large)}`,
        ),
        Scene.click(card),
        ...showDialogInScene(),
        Scene.inside(
          panel,
          Scene.expectAll(Scene.all.selector('.mission-row')).toHaveCount(3),
          Scene.expectAll(Scene.all.selector('.mission-reroll')).toHaveCount(2),
          Scene.expect(
            Scene.role('button', { name: `Reroll ${MISSION_NAMES[large]}` }),
          ).not.toHaveAttr('aria-disabled', 'true'),
          Scene.click(
            Scene.role('button', {
              name: `Reroll ${MISSION_NAMES[small]}`,
            }),
          ),
          Scene.expect(
            Scene.role('button', {
              name: `Reroll ${MISSION_NAMES[large]}`,
            }),
          ).toHaveAttr('aria-disabled', 'true'),
        ),
      ),
  )
})
