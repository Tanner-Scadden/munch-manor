import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { PANEL_DIALOG_ID } from '#domain/clientSchema.ts'
import { missionsOn } from '#features/missions/missions.ts'
import {
  MISSION_RULES,
  type MissionId,
  noMissions,
} from '#shared/records/missionData.ts'
import { home, knowingDay } from '#test/model.fixture.ts'
import {
  byClass,
  expectAttr,
  measureSurface,
  showDialog,
  withAttrs,
} from '#test/sceneTesting.ts'
import { sceneOf } from '#test/testing.ts'
import { MISSIONS_TITLE, MISSION_NAMES } from '#world/names.ts'

const TODAY = '2026-11-12'

const rolled = missionsOn(knowingDay(home, TODAY), TODAY)
const idAt = (slot: number): MissionId =>
  Option.getOrThrow(Array.get(rolled, slot))
const small = idAt(0)
const medium = idAt(1)
const large = idAt(2)

const untouched = (id: MissionId): string =>
  `${MISSION_NAMES[id]}: 0 of ${MISSION_RULES[id].goal}`

const started = UiStruct.evolve(knowingDay(home, TODAY), {
  missions: () => ({
    ...noMissions,
    day: TODAY,
    progress: { [medium]: MISSION_RULES[medium].goal },
    claimed: [medium],
  }),
})

const card = byClass('mission-card')
const panel = HtmlLocator.role('dialog', { name: MISSIONS_TITLE })
const inPanel = (locator: Locator.Locator) => Locator.inside(panel, locator)
const reroll = (id: MissionId) =>
  inPanel(HtmlLocator.role('button', { name: `Reroll ${MISSION_NAMES[id]}` }))

describe('the mission card', () => {
  it.effect('is not on the menu before the day is known', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(measureSurface).expect(card).toBeAbsent()
    }),
  )

  it.effect(
    'shows the three, the done one checked, and opens their panel',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(started)
        s.pipe(measureSurface)
          .expect(byClass('mission-pip'))
          .toHaveCount(3)
          .expect(withAttrs({ 'data-done': 'true' })(byClass('mission-pip')))
          .toHaveCount(1)
          .pipe(
            expectAttr(
              card,
              'aria-label',
              `${MISSIONS_TITLE}: ${untouched(small)}, ${MISSION_NAMES[medium]}: done, ${untouched(large)}`,
            ),
          )
          .click(card)
          .pipe(showDialog(PANEL_DIALOG_ID))
          .expect(inPanel(byClass('mission-row')))
          .toHaveCount(3)
          .expect(inPanel(byClass('mission-reroll')))
          .toHaveCount(2)
          .pipe(expectAttr(reroll(large), 'aria-disabled', undefined))
          .click(reroll(small))
          .pipe(expectAttr(reroll(large), 'aria-disabled', 'true'))
      }),
  )
})
