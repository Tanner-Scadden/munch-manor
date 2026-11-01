import { Option } from 'effect'
import {
  Command,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Tabs } from '@foldkit/ui'

import { PREPARATION_MS } from './constants'
import {
  type Arsenal,
  type Model,
  Phase,
  Trap,
  TrapHint,
  initialModel,
} from './model'
import { ShopTabsBlock } from './shopTabs'
import {
  ROOT,
  holdingSecond,
  measureSurface,
  walkIntoStallInScene,
} from './testing'
import { TRAPS } from './traps'

const atStall = (balance: number, arsenal: Arsenal): Model =>
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
    player: player =>
      modifyFields(player, {
        x: () => 270,
        y: () => 142,
        hp: () => 3,
        arsenal: () => arsenal,
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
  })

const holdingSmg = (rounds: number, tier: number): Arsenal =>
  holdingSecond({ kind: 'Smg', rounds, loaded: 30, tier })

const keeper = role('img', { name: /^Rattles the skeleton/ })
const bubble = selector('.shop-greeting')

describe('the shop at a glance', () => {
  test('a row the player cannot afford is dimmed, greys its tag, and shows the shortfall', () => {
    const pistolUpgrade = selector('#shop-item-PistolUpgrade')
    scene(
      ROOT,
      given(atStall(180, holdingSmg(200, 1))),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(
        selector('[data-stock="Short"] #shop-item-PistolUpgrade'),
      ).toExist(),
      expect(within(pistolUpgrade, selector('.shop-tag'))).toHaveClass(
        'is-short',
      ),
      expect(within(pistolUpgrade, selector('.shop-tag'))).toHaveText('$200'),
      expect(within(pistolUpgrade, selector('.shop-need'))).toHaveText(
        'Need $20 more',
      ),
      expect(within(pistolUpgrade, selector('.shop-need'))).not.toHaveClass(
        'sr-only',
      ),
      expect(selector('[data-stock="Price"] #shop-item-SmgUpgrade')).toExist(),
      expect(
        within(selector('#shop-item-SmgUpgrade'), selector('.shop-need')),
      ).toBeAbsent(),
    )
  })

  test('a full row says so in one word on its tag and keeps the reason for screen readers', () => {
    const drum = selector('#shop-item-SmgRounds')
    scene(
      ROOT,
      given(atStall(180, holdingSmg(360, 1))),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(selector('[data-stock="Done"] #shop-item-SmgRounds')).toExist(),
      expect(within(drum, selector('.shop-tag'))).toHaveText('FULL'),
      expect(within(drum, selector('.shop-item-reason'))).toHaveClass(
        'sr-only',
      ),
    )
  })

  test('an upgrade row names the next tier, and its gun card previews what it adds', () => {
    const upgrade = selector('#shop-item-SmgUpgrade')
    scene(
      ROOT,
      given(atStall(180, holdingSmg(200, 1))),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(within(upgrade, selector('.shop-card-name'))).toHaveText(
        'Chatterbox DELUXE',
      ),
      expect(within(upgrade, selector('.shop-upgrade-arrow'))).toExist(),
      expect(role('img', { name: 'Tier 1 of 3' })).toExist(),
      expect(
        selector('.shop-gun[data-held="true"] .shop-pip.is-next'),
      ).toExist(),
      expect(
        selector('.shop-gun[data-held="true"] .shop-seg.is-next'),
      ).toExist(),
      click(upgrade),
      expect(role('img', { name: 'Tier 2 of 3' })).toExist(),
      expect(within(upgrade, selector('.shop-card-name'))).toHaveText(
        'Chatterbox 3000',
      ),
    )
  })

  test('Rattles greets, grins at a buy with a stamp, and is sad when the player is short', () => {
    scene(
      ROOT,
      given(atStall(180, holdingSmg(200, 1))),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(keeper).toHaveAttr('data-mood', 'Grinning'),
      expect(selector('.shop-stamp')).toBeAbsent(),
      click(selector('#shop-item-SmgRounds')),
      expect(keeper).toHaveAttr('data-mood', 'Delighted'),
      expect(
        within(selector('#shop-item-SmgRounds'), selector('.shop-stamp')),
      ).toExist(),
      expect(selector('.shop-balance')).toHaveText('You have $160'),
      keydown(selector('#shop-item-PistolUpgrade'), 'Enter'),
      expect(keeper).toHaveAttr('data-mood', 'Sad'),
      expect(bubble).toHaveText('Need $40 more. No IOUs!'),
      expect(selector('.shop-stamp')).toBeAbsent(),
      expect(
        within(selector('#shop-item-PistolUpgrade'), selector('.shop-nope')),
      ).toExist(),
      expect(selector('.shop-balance')).toHaveText('You have $160'),
      click(role('tab', { name: /^Traps,/ })),
      Command.resolve(
        Tabs.test.FocusTab,
        ShopTabsBlock.Message.CompletedFocusTab(),
      ),
      expect(keeper).toHaveAttr('data-mood', 'Grinning'),
    )
  })

  test('a player with nothing to buy gets a sad hello', () => {
    scene(
      ROOT,
      given(atStall(5, holdingSmg(360, 1))),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(keeper).toHaveAttr('data-mood', 'Sad'),
    )
  })
})

describe('repairing placed traps', () => {
  const withPlanks = modifyFields(atStall(100, holdingSmg(200, 1)), {
    shopCategory: () => 'Traps',
    traps: () => [
      Trap.Barricade({
        id: 1,
        door: 'West',
        hp: TRAPS.Barricade.hp / 2,
        hitRemainingMs: 0,
      }),
      Trap.Barricade({
        id: 2,
        door: 'North',
        hp: TRAPS.Barricade.hp,
        hitRemainingMs: 0,
      }),
    ],
  })
  const westPlank = selector('#shop-item-Repair-1')
  const northPlank = selector('#shop-item-Repair-2')

  test('each placed plank gets its own row with a map pip, a health bar, and its own price or FULL', () => {
    scene(
      ROOT,
      given(withPlanks),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(
        role('button', { name: 'Repair the Plank Pile at the West door, $24' }),
      ).toExist(),
      expect(within(westPlank, selector('.shop-tag'))).toHaveText('$24'),
      expect(within(westPlank, selector('.shop-map-dot'))).toExist(),
      expect(within(westPlank, selector('.shop-health'))).toHaveStyle(
        'width',
        '50%',
      ),
      expect(within(northPlank, selector('.shop-tag'))).toHaveText('FULL'),
      expect(selector('[data-stock="Done"] #shop-item-Repair-2')).toExist(),
      click(westPlank),
      expect(within(westPlank, selector('.shop-tag'))).toHaveText('FULL'),
      expect(selector('.shop-balance')).toHaveText('You have $76'),
    )
  })

  test('with nothing placed, the trap tab has no repair rows', () => {
    scene(
      ROOT,
      given(
        modifyFields(atStall(100, holdingSmg(200, 1)), {
          shopCategory: () => 'Traps',
        }),
      ),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(role('button', { name: /^Repair the/ })).toBeAbsent(),
      expect(role('button', { name: 'Buy Plank Pile for $95' })).toExist(),
    )
  })
})

// NOTE: from playtests: traps looked like something a button builds, and a
// bought gun's ammo looked endless like the pistol's.
describe('what the shop teaches', () => {
  test('until the first trap is bought, TRAPS wears NEW and its traps pulse', () => {
    scene(
      ROOT,
      given(
        modifyFields(atStall(100, holdingSmg(200, 0)), {
          shopCategory: () => 'Traps',
        }),
      ),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(selector('.shop-tab-new')).toHaveText('NEW'),
      expect(selector('.shop-row[data-fresh="true"]')).toExist(),
    )
  })

  test('once a trap has been bought, TRAPS is plain', () => {
    scene(
      ROOT,
      given(
        modifyFields(atStall(100, holdingSmg(200, 0)), {
          shopCategory: () => 'Traps',
          trapHint: () => TrapHint.Seen(),
        }),
      ),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(selector('.shop-tab-new')).toBeAbsent(),
      expect(selector('.shop-row[data-fresh="true"]')).toBeAbsent(),
    )
  })

  test("each gun shows its rounds: the pistol's endless, the others a count", () => {
    scene(
      ROOT,
      given(atStall(100, holdingSmg(200, 0))),
      measureSurface,
      ...walkIntoStallInScene(),
      expect(selector('.shop-rounds.is-endless')).toHaveText('∞'),
      expect(selector('[data-held="true"] .shop-rounds')).toHaveText('200'),
    )
  })
})
