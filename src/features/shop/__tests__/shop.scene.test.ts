import { Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'
import { Tabs } from '@foldkit/ui'

import {
  type Arsenal,
  type Model,
  Phase,
  Trap,
  TrapHint,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import {
  APPLICATION,
  holdingSecond,
  measureSurface,
  walkIntoStallInScene,
} from '../../../test/testing'
import { TRAPS } from '../../../world/gear/traps'
import { maxHpOf } from '../../../world/heroes/calling'
import { modifyFocus } from '../../../world/party/party'
import { ShopTabsBlock } from '../shopTabs'

const atStall = (balance: number, arsenal: Arsenal): Model =>
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
        modifyFields(player, {
          x: () => 270,
          y: () => 142,
          hp: () => 3,
          arsenal: () => arsenal,
        }),
      wallet: () => ({ balance, earned: balance, shown: balance }),
    },
  )

const holdingSmg = (tier: number, kills: number = 0): Arsenal =>
  holdingSecond({ kind: 'Smg', loaded: 30, tier, kills })

const keeper = Scene.role('img', { name: /^Rattles the skeleton/ })
const bubble = Scene.selector('.shop-greeting')
const laserSight = Scene.selector('#shop-item-LaserSight')
const heart = Scene.selector('#shop-item-Heart')

describe('the shop at a glance', () => {
  it.effect(
    'a row the player cannot afford is dimmed, greys its tag, and shows the shortfall',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall(180, holdingSmg(1))),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(
          Scene.selector('[data-stock="Short"] #shop-item-LaserSight'),
        ).toExist(),
        Scene.expect(
          Scene.within(laserSight, Scene.selector('.shop-tag')),
        ).toHaveClass('is-short'),
        Scene.expect(
          Scene.within(laserSight, Scene.selector('.shop-tag')),
        ).toHaveText('$400'),
        Scene.expect(
          Scene.within(laserSight, Scene.selector('.shop-need')),
        ).toHaveText('Need $220 more'),
        Scene.expect(
          Scene.within(laserSight, Scene.selector('.shop-need')),
        ).not.toHaveClass('sr-only'),
        Scene.expect(
          Scene.selector('[data-stock="Price"] #shop-item-Shotgun'),
        ).toExist(),
        Scene.expect(
          Scene.within(
            Scene.selector('#shop-item-Shotgun'),
            Scene.selector('.shop-need'),
          ),
        ).toBeAbsent(),
      ),
  )

  it.effect(
    'a full row says so in one word on its tag and keeps the reason for screen readers',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atStall(180, holdingSmg(1)), {
            player: player =>
              modifyFields(player, { hp: () => maxHpOf(player) }),
            shopCategory: () => 'Health',
          }),
        ),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(
          Scene.selector('[data-stock="Done"] #shop-item-Heart'),
        ).toExist(),
        Scene.expect(
          Scene.within(heart, Scene.selector('.shop-tag')),
        ).toHaveText('FULL'),
        Scene.expect(
          Scene.within(heart, Scene.selector('.shop-item-reason')),
        ).toHaveClass('sr-only'),
      ),
  )

  it.effect(
    "a gun card shows its tier, and the next tier's pip fills with its kills",
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall(180, holdingSmg(1, 80))),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(Scene.role('img', { name: 'Tier 1 of 3' })).toExist(),
        Scene.expect(
          Scene.selector('.shop-gun[data-held="true"] .shop-pip-fill'),
        ).toHaveStyle('width', '50%'),
        Scene.expect(
          Scene.selector('.shop-gun[data-held="true"] .shop-pip.is-filled'),
        ).toExist(),
      ),
  )

  it.effect(
    'Rattles greets, is sad when the player is short, and grins at a buy with a stamp',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atStall(350, holdingSmg(1))),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(keeper).toHaveAttr('data-mood', 'Grinning'),
        Scene.expect(Scene.selector('.shop-stamp')).toBeAbsent(),
        Scene.keydown(laserSight, 'Enter'),
        Scene.expect(keeper).toHaveAttr('data-mood', 'Sad'),
        Scene.expect(bubble).toHaveText('Need $50 more. No IOUs!'),
        Scene.expect(Scene.selector('.shop-stamp')).toBeAbsent(),
        Scene.expect(
          Scene.within(laserSight, Scene.selector('.shop-nope')),
        ).toExist(),
        Scene.expect(Scene.selector('.shop-balance')).toHaveText(
          'You have $350',
        ),
        Scene.click(Scene.role('tab', { name: /^Health,/ })),
        Scene.Command.resolve(
          Tabs.test.FocusTab,
          ShopTabsBlock.Message.CompletedFocusTab(),
        ),
        Scene.expect(keeper).toHaveAttr('data-mood', 'Grinning'),
        Scene.click(heart),
        Scene.expect(keeper).toHaveAttr('data-mood', 'Delighted'),
        Scene.expect(
          Scene.within(heart, Scene.selector('.shop-stamp')),
        ).toExist(),
        Scene.expect(Scene.selector('.shop-balance')).toHaveText(
          'You have $325',
        ),
      ),
  )

  it.effect('a player with nothing to buy gets a sad hello', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(atStall(5, holdingSmg(1))),
      measureSurface,
      ...walkIntoStallInScene(),
      Scene.expect(keeper).toHaveAttr('data-mood', 'Sad'),
    ),
  )
})

describe('repairing placed traps', () => {
  const withPlanks = modifyFocus(
    modifyFields(atStall(100, holdingSmg(1)), {
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
    }),
    { shopCategory: () => 'Traps' },
  )
  const westPlank = Scene.selector('#shop-item-Repair-1')
  const northPlank = Scene.selector('#shop-item-Repair-2')

  it.effect(
    'each placed plank gets its own row with a map pip, a health bar, and its own price or FULL',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(withPlanks),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(
          Scene.role('button', {
            name: 'Repair the Plank Pile at the West door, $24',
          }),
        ).toExist(),
        Scene.expect(
          Scene.within(westPlank, Scene.selector('.shop-tag')),
        ).toHaveText('$24'),
        Scene.expect(
          Scene.within(westPlank, Scene.selector('.shop-map-dot')),
        ).toExist(),
        Scene.expect(
          Scene.within(westPlank, Scene.selector('.shop-health')),
        ).toHaveStyle('width', '50%'),
        Scene.expect(
          Scene.within(northPlank, Scene.selector('.shop-tag')),
        ).toHaveText('FULL'),
        Scene.expect(
          Scene.selector('[data-stock="Done"] #shop-item-Repair-2'),
        ).toExist(),
        Scene.click(westPlank),
        Scene.expect(
          Scene.within(westPlank, Scene.selector('.shop-tag')),
        ).toHaveText('FULL'),
        Scene.expect(Scene.selector('.shop-balance')).toHaveText(
          'You have $76',
        ),
      ),
  )

  it.effect('with nothing placed, the trap tab has no repair rows', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFocus(atStall(100, holdingSmg(1)), {
          shopCategory: () => 'Traps',
        }),
      ),
      measureSurface,
      ...walkIntoStallInScene(),
      Scene.expect(Scene.role('button', { name: /^Repair the/ })).toBeAbsent(),
      Scene.expect(
        Scene.role('button', { name: 'Buy Plank Pile for $95' }),
      ).toExist(),
    ),
  )
})

// NOTE: from playtests: traps looked like something a button builds.
describe('what the shop teaches', () => {
  it.effect(
    'until the first trap is bought, TRAPS wears NEW and its traps pulse',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFocus(atStall(100, holdingSmg(0)), {
            shopCategory: () => 'Traps',
          }),
        ),
        measureSurface,
        ...walkIntoStallInScene(),
        Scene.expect(Scene.selector('.shop-tab-new')).toHaveText('NEW'),
        Scene.expect(Scene.selector('.shop-row[data-fresh="true"]')).toExist(),
      ),
  )

  it.effect('once a trap has been bought, TRAPS is plain', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFocus(
          modifyFields(atStall(100, holdingSmg(0)), {
            trapHint: () => TrapHint.Seen(),
          }),
          { shopCategory: () => 'Traps' },
        ),
      ),
      measureSurface,
      ...walkIntoStallInScene(),
      Scene.expect(Scene.selector('.shop-tab-new')).toBeAbsent(),
      Scene.expect(Scene.selector('.shop-row[data-fresh="true"]')).toBeAbsent(),
    ),
  )
})
