import { Option } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Message } from '../../../app/message'
import { FridgeDoor, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import { home } from '../../../test/model.fixture'
import {
  ROOT,
  emitPressedKey,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  walkIntoStallInScene,
} from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { FocusShopGuide } from '../guideUpdate'
import { prizeUnlockId } from '../shopGuide'

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

const help = role('button', { name: 'Shop guide' })
const back = role('button', { name: 'Back to the shop' })
const guide = selector('.sg')
const resolveFocusGuide = Command.resolve(
  FocusShopGuide,
  Message.CompletedFocusShopGuide(),
)

describe('the ? in the shop', () => {
  test('opens the guide on the tab being looked at, with bars and an upgrade ladder, and Back returns to the shelves', () => {
    scene(
      ROOT,
      given(atStall()),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(role('tab', { name: /^Guns,/ })).toExist(),
      expect(guide).toBeAbsent(),
      click(help),
      resolveFocusGuide,
      expect(guide).toExist(),
      expect(help).toBeAbsent(),
      expect(role('tab', { name: /^Guns,/ })).toBeAbsent(),
      expect(role('button', { name: 'Guns', pressed: true })).toExist(),
      inside(
        selector("[data-entry='Shotgun']"),
        expect(selector('.sg-name')).toExist(),
        expect(role('img', { name: /^Power \d of 5/ })).toExist(),
        expectAll(all.selector('.sg-step')).toHaveCount(3),
      ),
      click(role('button', { name: 'Traps' })),
      expect(selector("[data-entry='Turret']")).toExist(),
      click(back),
      resolveFocusGuide,
      expect(guide).toBeAbsent(),
      expect(help).toExist(),
      expect(role('tab', { name: /^Guns,/ })).toExist(),
    )
  })

  test('the ? key opens the guide with no pointer, and again puts it away', () => {
    scene(
      ROOT,
      given(atStall()),
      measureSurface,
      ...walkIntoStallInScene(),
      emitPressedKey('Slash'),
      resolveFocusGuide,
      expect(guide).toExist(),
      emitPressedKey('Slash'),
      resolveFocusGuide,
      expect(guide).toBeAbsent(),
    )
  })

  test('the fridge shows ??? until a prize is pulled, then its card fills in', () => {
    const pulled = modifyFields(atStall(), {
      seenUnlocks: () => [prizeUnlockId('Freeze')],
      fridge: fridge => modifyFields(fridge, { door: () => FridgeDoor.Shut() }),
    })
    scene(
      ROOT,
      given(pulled),
      measureSurface,
      ...walkIntoStallInScene(),
      click(help),
      resolveFocusGuide,
      click(role('button', { name: 'Fridge' })),
      expectAll(all.selector("[data-known='Unknown']")).toHaveCount(4),
      expectAll(all.selector("[data-known='Known']")).toHaveCount(1),
      inside(
        selector("[data-entry='Freeze']"),
        expect(selector('.sg-bars')).toExist(),
      ),
      inside(
        selector("[data-entry='Cooker']"),
        expect(selector('.sg-bars')).toBeAbsent(),
        expect(text('???')).toExist(),
      ),
    )
  })
})

describe('the Munchopedia Shop page', () => {
  test('the Shop tile opens the guide, sections switch, and Back returns to the zombies', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(/^Munchopedia:/),
      inside(
        role('dialog', { name: 'Munchopedia' }),
        click(role('button', { name: /^Shop,/ })),
        expect(guide).toExist(),
        expect(selector("[data-entry='Pistol']")).toExist(),
        click(role('button', { name: 'House' })),
        expect(selector("[data-entry='Boards']")).toExist(),
        expect(selector("[data-entry='Pistol']")).toBeAbsent(),
        click(role('button', { name: 'Back to the Munchopedia' })),
        expect(guide).toBeAbsent(),
        expect(role('button', { name: /^Shop,/ })).toExist(),
      ),
    )
  })
})
