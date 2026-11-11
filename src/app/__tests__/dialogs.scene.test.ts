import { Array, Option, Order, String } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect as expectValue, it } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import * as Coop from '../../domain/coopRoom'
import { PREPARATION_MS } from '../../shared/constants'
import { holdingSecond } from '../../test/arsenals'
import { homeAfterRead } from '../../test/model.fixture'
import { APPLICATION, measureSurface } from '../../test/testing'
import { nodesOf } from '../../test/viewReading'
import { modifyFocus } from '../../world/party/party'
import type { Message } from '../message'
import { type Model, Phase } from '../model'
import { initialModel } from '../pureApp'

// NOTE: every menu dialog is in the page on every frame, and a shut one is
// handed back from a cache (see `dialogShell`). Snabbdom pairs unkeyed
// siblings by position, so when co-op opened (the home menu left the front
// of the page's list and the co-op screen joined its end) it paired each
// cached dialog with a new element, left the old one in the page, and the
// shop (since gone) then opened as a second `<dialog id="shop">` under an empty one that
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
  node.sel !== undefined && String.split(node.sel, /[#.]/)[0] === 'dialog'

const idsOf = (nodes: ReadonlyArray<VNodeLike>): ReadonlyArray<string> =>
  Array.flatMap(nodes, node => {
    const id = idOf(node)
    return id === undefined ? [] : [id]
  })

const duplicateIds = (root: VNodeLike): ReadonlyArray<string> => {
  const ids = idsOf(nodesOf(root))
  return Array.filter(ids, (id, index) => ids.indexOf(id) !== index)
}

const unkeyedDialogs = (root: VNodeLike): ReadonlyArray<string> =>
  Array.map(
    Array.filter(
      Array.filter(nodesOf(root), isDialog),
      node => node.key !== idOf(node),
    ),
    node => idOf(node) ?? '(no id)',
  )

const DIALOG_IDS = [
  'home-screen-steps',
  'update-greeting',
  'manor-hand',
  'menu-panel',
  'profile',
]

const holdsDialogsApart = Scene.tap<Model, Message>(({ html }) => {
  const root: VNodeLike = html
  expectValue(duplicateIds(root)).toEqual([])
  expectValue(unkeyedDialogs(root)).toEqual([])
  expectValue(
    Array.sort(idsOf(Array.filter(nodesOf(root), isDialog)), Order.String),
  ).toEqual(Array.sort(DIALOG_IDS, Order.String))
})

// NOTE: a break in a run, the player in the parlour.
const inBreak: Model = modifyFocus(
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
        arsenal: () =>
          holdingSecond({ kind: 'Smg', loaded: 30, tier: 1, kills: 0 }),
      }),
  },
)

const opened = (dialog: DialogModel): DialogModel => ({
  ...dialog,
  isOpen: true,
})

type OpenCase = Readonly<{ name: string; model: Model; opensDialog: boolean }>

const OPEN_CASES: ReadonlyArray<OpenCase> = [
  { name: 'nothing open', model: homeAfterRead, opensDialog: false },
  { name: 'a break in a run', model: inBreak, opensDialog: false },
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
  it.effect.each(OPEN_CASES)(
    'with $name, each dialog is in the page once, keyed on its id, and no id repeats',
    ({ model, opensDialog }) =>
      Scene.scene(
        APPLICATION,
        Scene.given(model),
        measureSurface,
        ...(opensDialog
          ? [
              Scene.Mount.resolve(
                Dialog.test.AcquireResources,
                DialogBlock.Message.SucceededAcquireResources(),
              ),
            ]
          : []),
        holdsDialogsApart,
      ),
  )
})
