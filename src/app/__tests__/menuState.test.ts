import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import { Screen } from '../../domain/coopRoom'
import { RESTART_GRACE_MS } from '../../shared/constants'
import { home, openedDialog, veteranFighting } from '../../test/model.fixture'
import { pause } from '../../world/waves/waves'
import {
  MenuState,
  isOnHomeMenu,
  isPanelOpen,
  isProfileOpenOn,
  menuState,
} from '../menuState'
import { type Model, Phase } from '../model'

const inCoop: Model = UiStruct.evolve(home, {
  coop: coop =>
    UiStruct.evolve(coop, {
      screen: () => Screen.Hub({ maybeProblem: Option.none() }),
    }),
})

const tagOf = (model: Model): MenuState['_tag'] => menuState(model)._tag

describe('menuState', () => {
  test('follows the phase when nothing is open', () => {
    expect(tagOf(home)).toBe('Home')
    expect(tagOf(veteranFighting)).toBe('Playing')
    expect(tagOf(pause(veteranFighting))).toBe('Paused')
    expect(
      menuState(
        UiStruct.evolve(home, { phase: () => Phase.GameOver({ wave: 3 }) }),
      ),
    ).toEqual(MenuState.EndScreen({ isPastGrace: false }))
    expect(
      menuState(
        UiStruct.evolve(home, {
          phase: () => Phase.Escaped({ wave: 10 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
    ).toEqual(MenuState.EndScreen({ isPastGrace: true }))
  })

  test('co-op covers the home menu', () => {
    expect(tagOf(inCoop)).toBe('Coop')
    expect(isOnHomeMenu(inCoop)).toBe(false)
  })

  test('every dialog covers the home menu, co-op, and the phase', () => {
    expect(tagOf(UiStruct.evolve(home, { handDialog: openedDialog }))).toBe(
      'Hand',
    )
    expect(
      tagOf(UiStruct.evolve(home, { homeScreenSteps: openedDialog })),
    ).toBe('InstallSteps')
    expect(
      tagOf(UiStruct.evolve(inCoop, { updateGreeting: openedDialog })),
    ).toBe('UpdateGreeting')
    expect(
      tagOf(UiStruct.evolve(veteranFighting, { handDialog: openedDialog })),
    ).toBe('Hand')
    expect(
      isOnHomeMenu(UiStruct.evolve(home, { updateGreeting: openedDialog })),
    ).toBe(false)
  })

  test('names the open panel and Profile tab', () => {
    const asking = UiStruct.evolve(pause(veteranFighting), {
      panel: () => 'LeaveRun',
      panelDialog: openedDialog,
    })
    expect(isPanelOpen(asking, 'LeaveRun')).toBe(true)
    expect(isPanelOpen(asking, 'HowToPlay')).toBe(false)
    expect(
      isPanelOpen(
        UiStruct.evolve(pause(veteranFighting), { panel: () => 'LeaveRun' }),
        'LeaveRun',
      ),
    ).toBe(false)

    const settings = UiStruct.evolve(home, {
      profile: profile => UiStruct.evolve(profile, { tab: () => 'Settings' }),
      profileDialog: openedDialog,
    })
    expect(isProfileOpenOn(settings, 'Settings')).toBe(true)
    expect(isProfileOpenOn(settings, 'Look')).toBe(false)
  })
})
