import { Array, Option, Order } from 'effect'
import {
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  scene,
  selector,
  tap,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect as expectValue, test } from 'vitest'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { PREPARATION_MS } from './constants'
import * as Coop from './coop/model'
import type { Message } from './message'
import { type Model, Phase, ShopState, initialModel } from './model'
import { homeAfterRead } from './model.fixture'
import {
  ROOT,
  holdingSecond,
  measureSurface,
  nodesOf,
  walkIntoStallInScene,
} from './testing'

// NOTE: every menu dialog is in the page on every frame, and a shut one is
// handed back from a cache (see `dialogShell`). Snabbdom pairs unkeyed
// siblings by position, so when co-op opened (the home menu left the front
// of the page's list and the co-op screen joined its end) it paired each
// cached dialog with a new element, left the old one in the page, and the
// shop then opened as a second `<dialog id="shop">` under an empty one that
// took every click. These tests hold the two things that keep it from
// coming back: every dialog is keyed on its id, and no id is used twice.

type DialogModel = typeof DialogBlock.Model.Type

type VNodeLike = Readonly<{
  sel?: string | undefined
  key?: PropertyKey | undefined
  data?:
    | Readonly<{
        attrs?: Readonly<Record<string, unknown>> | undefined
        props?: Readonly<Record<string, unknown>> | undefined
      }>
    | undefined
  children?: ReadonlyArray<VNodeLike | string> | undefined
}>

const idOf = (node: VNodeLike): string | undefined => {
  const id = node.data?.props?.['id'] ?? node.data?.attrs?.['id']
  return typeof id === 'string' ? id : undefined
}

const isDialog = (node: VNodeLike): boolean =>
  node.sel?.split(/[#.]/)[0] === 'dialog'

const idsOf = (nodes: ReadonlyArray<VNodeLike>): ReadonlyArray<string> =>
  nodes.flatMap(node => {
    const id = idOf(node)
    return id === undefined ? [] : [id]
  })

const duplicateIds = (root: VNodeLike): ReadonlyArray<string> => {
  const ids = idsOf(nodesOf(root))
  return ids.filter((id, index) => ids.indexOf(id) !== index)
}

const unkeyedDialogs = (root: VNodeLike): ReadonlyArray<string> =>
  nodesOf(root)
    .filter(isDialog)
    .filter(node => node.key !== idOf(node))
    .map(node => idOf(node) ?? '(no id)')

const DIALOG_IDS = [
  'home-screen-steps',
  'update-greeting',
  'shop',
  'manor-hand',
  'menu-panel',
  'profile',
]

const holdsDialogsApart = tap<Model, Message>(({ html }) => {
  const root: VNodeLike = html
  expectValue(duplicateIds(root)).toEqual([])
  expectValue(unkeyedDialogs(root)).toEqual([])
  expectValue(
    Array.sort(idsOf(nodesOf(root).filter(isDialog)), Order.String),
  ).toEqual(Array.sort(DIALOG_IDS, Order.String))
})

const atStall: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
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
      arsenal: () =>
        holdingSecond({ kind: 'Smg', rounds: 200, loaded: 30, tier: 1 }),
    }),
  wallet: () => ({ balance: 180, earned: 180, shown: 180 }),
})

describe('the shop dialog', () => {
  test('walking into the stall opens one shop, keyed on its id, and its buy buttons buy', () => {
    scene(
      ROOT,
      given(atStall),
      measureSurface,
      ...walkIntoStallInScene(),
      expectAll(all.selector('dialog#shop')).toHaveCount(1),
      expectAll(all.selector('dialog[open]')).toHaveCount(1),
      holdsDialogsApart,
      inside(
        selector('dialog#shop'),
        expect(selector('.shop-balance')).toHaveText('You have $180'),
        click(selector('#shop-item-SmgRounds')),
        expect(selector('.shop-balance')).toHaveText('You have $160'),
      ),
    )
  })
})

const opened = (dialog: DialogModel): DialogModel => ({
  ...dialog,
  isOpen: true,
})

type OpenCase = Readonly<{ name: string; model: Model; opensDialog: boolean }>

const OPEN_CASES: ReadonlyArray<OpenCase> = [
  { name: 'nothing open', model: homeAfterRead, opensDialog: false },
  {
    name: 'the shop',
    model: modifyFields(atStall, {
      shop: () => ShopState.Browsing({ focusedItem: 'SmgRounds' }),
      shopDialog: opened,
    }),
    opensDialog: true,
  },
  {
    name: 'the MORE hand',
    model: modifyFields(homeAfterRead, { handDialog: opened }),
    opensDialog: true,
  },
  {
    name: 'a menu panel',
    model: modifyFields(homeAfterRead, {
      panel: () => 'HowToPlay',
      panelDialog: opened,
    }),
    opensDialog: true,
  },
  {
    name: 'the Profile',
    model: modifyFields(homeAfterRead, {
      profileDialog: opened,
    }),
    opensDialog: true,
  },
  {
    name: 'the Home Screen steps',
    model: modifyFields(homeAfterRead, { homeScreenSteps: opened }),
    opensDialog: true,
  },
  {
    name: 'the update greeting',
    model: modifyFields(homeAfterRead, { updateGreeting: opened }),
    opensDialog: true,
  },
  {
    name: 'co-op',
    model: modifyFields(homeAfterRead, {
      coop: coop =>
        modifyFields(coop, {
          screen: () => Coop.Screen.Hub({ maybeProblem: Option.none() }),
        }),
    }),
    opensDialog: false,
  },
]

describe('every menu dialog', () => {
  test.each(OPEN_CASES)(
    'with $name, each dialog is in the page once, keyed on its id, and no id repeats',
    ({ model, opensDialog }) => {
      scene(
        ROOT,
        given(model),
        measureSurface,
        ...(opensDialog
          ? [
              Mount.resolve(
                Dialog.test.AcquireResources,
                DialogBlock.Message.SucceededAcquireResources(),
              ),
            ]
          : []),
        holdsDialogsApart,
      )
    },
  )
})
