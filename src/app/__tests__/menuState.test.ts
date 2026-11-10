import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Screen } from '../../domain/coopRoom'
import { RESTART_GRACE_MS } from '../../shared/constants'
import { home, veteranFighting } from '../../test/model.fixture'
import { pause } from '../../world/waves/waves'
import {
  MenuState,
  isOnHomeMenu,
  isPanelOpen,
  isProfileOpenOn,
  menuState,
} from '../menuState'
import { type Model, Phase } from '../model'

type Dialog = Model['panelDialog']

const opened = (dialog: Dialog): Dialog =>
  modifyFields(dialog, { isOpen: () => true })

const inCoop: Model = modifyFields(home, {
  coop: coop =>
    modifyFields(coop, {
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
        modifyFields(home, { phase: () => Phase.GameOver({ wave: 3 }) }),
      ),
    ).toEqual(MenuState.EndScreen({ isPastGrace: false }))
    expect(
      menuState(
        modifyFields(home, {
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
    expect(tagOf(modifyFields(home, { handDialog: opened }))).toBe('Hand')
    expect(tagOf(modifyFields(home, { homeScreenSteps: opened }))).toBe(
      'InstallSteps',
    )
    expect(tagOf(modifyFields(inCoop, { updateGreeting: opened }))).toBe(
      'UpdateGreeting',
    )
    expect(tagOf(modifyFields(veteranFighting, { handDialog: opened }))).toBe(
      'Hand',
    )
    expect(isOnHomeMenu(modifyFields(home, { updateGreeting: opened }))).toBe(
      false,
    )
  })

  test('names the open panel and Profile tab', () => {
    const asking = modifyFields(pause(veteranFighting), {
      panel: () => 'LeaveRun',
      panelDialog: opened,
    })
    expect(isPanelOpen(asking, 'LeaveRun')).toBe(true)
    expect(isPanelOpen(asking, 'HowToPlay')).toBe(false)
    expect(
      isPanelOpen(
        modifyFields(pause(veteranFighting), { panel: () => 'LeaveRun' }),
        'LeaveRun',
      ),
    ).toBe(false)

    const settings = modifyFields(home, {
      profile: profile => modifyFields(profile, { tab: () => 'Settings' }),
      profileDialog: opened,
    })
    expect(isProfileOpenOn(settings, 'Settings')).toBe(true)
    expect(isProfileOpenOn(settings, 'Look')).toBe(false)
  })
})
