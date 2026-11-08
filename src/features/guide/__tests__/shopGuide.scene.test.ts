import { Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { FridgeDoor, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  emitPressedKey,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  walkIntoStallInScene,
} from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { Message as GuideMessage } from '../message'
import { prizeUnlockId } from '../shopGuide'
import { FocusGuideControl } from '../steps'

const atStall = (): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Preparation({
          wave: 4,
          remainingMs: 15_000,
          durationMs: PREPARATION_MS,
          spawns: [
            {
              atMs: 1e9,
              kind: 'Shambler',
              door: 'North',
              offset: 0,
              speedScale: 1,
              hpScale: 1,
              pack: 0,
              formation: 'Squad',
            },
          ],
        }),
    }),
    {
      player: player =>
        modifyFields(player, { x: () => 270, y: () => 142, hp: () => 3 }),
      wallet: () => ({ balance: 200, earned: 200, shown: 200 }),
    },
  )

const help = Scene.role('button', { name: 'Shop guide' })
const back = Scene.role('button', { name: 'Back to the shop' })
const guide = Scene.selector('.sg')
const resolveFocusGuide = Scene.Command.resolve(
  FocusGuideControl,
  GuideMessage.CompletedFocusControl(),
)

describe('the ? in the shop', () => {
  it.effect(
    'opens the guide on the tab being looked at, with bars and an upgrade ladder, and Back returns to the shelves',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall()),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(Scene.role('tab', { name: /^Guns,/ })).toExist(),
        Scene.expect(guide).toBeAbsent(),
        Scene.click(help),
        resolveFocusGuide,
        Scene.expect(guide).toExist(),
        Scene.expect(help).toBeAbsent(),
        Scene.expect(Scene.role('tab', { name: /^Guns,/ })).toBeAbsent(),
        Scene.expect(
          Scene.role('button', { name: 'Guns', pressed: true }),
        ).toExist(),
        Scene.inside(
          Scene.selector("[data-entry='Shotgun']"),
          Scene.expect(Scene.selector('.sg-name')).toExist(),
          Scene.expect(Scene.role('img', { name: /^Power \d of 5/ })).toExist(),
          Scene.expectAll(Scene.all.selector('.sg-step')).toHaveCount(3),
        ),
        Scene.click(Scene.role('button', { name: 'Traps' })),
        Scene.expect(Scene.selector("[data-entry='Turret']")).toExist(),
        Scene.click(back),
        resolveFocusGuide,
        Scene.expect(guide).toBeAbsent(),
        Scene.expect(help).toExist(),
        Scene.expect(Scene.role('tab', { name: /^Guns,/ })).toExist(),
      ),
  )

  it.effect(
    'the ? key opens the guide with no pointer, and again puts it away',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall()),
        measureSurface,
        ...walkIntoStallInScene(),
        emitPressedKey('Slash'),
        resolveFocusGuide,
        Scene.expect(guide).toExist(),
        emitPressedKey('Slash'),
        resolveFocusGuide,
        Scene.expect(guide).toBeAbsent(),
      ),
  )

  it.effect(
    'the fridge shows ??? until a prize is pulled, then its card fills in',
    () => {
      const pulled = modifyFields(atStall(), {
        seenUnlocks: () => [prizeUnlockId('Freeze')],
        fridge: fridge =>
          modifyFields(fridge, { door: () => FridgeDoor.Shut() }),
      })
      return Scene.scene(
        APPLICATION,
        Scene.given(pulled),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.click(help),
        resolveFocusGuide,
        Scene.click(Scene.role('button', { name: 'Fridge' })),
        Scene.expectAll(
          Scene.all.selector("[data-known='Unknown']"),
        ).toHaveCount(4),
        Scene.expectAll(Scene.all.selector("[data-known='Known']")).toHaveCount(
          1,
        ),
        Scene.inside(
          Scene.selector("[data-entry='Freeze']"),
          Scene.expect(Scene.selector('.sg-bars')).toExist(),
        ),
        Scene.inside(
          Scene.selector("[data-entry='Cooker']"),
          Scene.expect(Scene.selector('.sg-bars')).toBeAbsent(),
          Scene.expect(Scene.text('???')).toExist(),
        ),
      )
    },
  )
})

describe('the Munchopedia Shop page', () => {
  it.effect(
    'the Shop tile opens the guide, sections switch, and Back returns to the zombies',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openHandInScene(),
        ...pickCardInScene(/^Munchopedia:/),
        Scene.inside(
          Scene.role('dialog', { name: 'Munchopedia' }),
          Scene.click(Scene.role('button', { name: /^Shop,/ })),
        ),
        resolveFocusGuide,
        Scene.inside(
          Scene.role('dialog', { name: 'Munchopedia' }),
          Scene.expect(guide).toExist(),
          Scene.expect(Scene.selector("[data-entry='Pistol']")).toExist(),
          Scene.click(Scene.role('button', { name: 'House' })),
          Scene.expect(Scene.selector("[data-entry='Boards']")).toExist(),
          Scene.expect(Scene.selector("[data-entry='Pistol']")).toBeAbsent(),
          Scene.click(
            Scene.role('button', { name: 'Back to the Munchopedia' }),
          ),
        ),
        resolveFocusGuide,
        Scene.inside(
          Scene.role('dialog', { name: 'Munchopedia' }),
          Scene.expect(guide).toBeAbsent(),
          Scene.expect(Scene.role('button', { name: /^Shop,/ })).toExist(),
        ),
      ),
  )
})
