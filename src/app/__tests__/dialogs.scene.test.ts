import { Array, Effect, Option, Order } from 'effect'

import { UiStruct } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { describe, expect, it } from '@effect/vitest'

import {
  HAND_DIALOG_ID,
  HOME_SCREEN_STEPS_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
  UPDATE_GREETING_ID,
} from '../../domain/clientSchema'
import * as Coop from '../../domain/coopRoom'
import { PREPARATION_MS } from '../../shared/constants'
import { holdingSecond } from '../../test/arsenals'
import { homeAfterRead } from '../../test/model.fixture'
import {
  ackHudSlots,
  dialogModel,
  measureSurface,
} from '../../test/sceneTesting'
import { type SceneStep, sceneOf } from '../../test/testing'
import { type ViewNode, nodesOf } from '../../test/viewReading'
import { openDialog } from '../../ui/dialog'
import { modifyFocus } from '../../world/party/party'
import { BreakClock, type Model, Phase } from '../model'
import { initialModel } from '../pureApp'

// NOTE: every menu dialog is drawn on every frame, as ui-kit's Dialog,
// keyed on its id. Unkeyed siblings pair by position, so when co-op opened
// (the home menu left the front of the page's list and the co-op screen
// joined its end) an unkeyed dialog could pair with a new element, leave the
// old one in the page, and the shop (since gone) then opened as a second
// `<dialog id="shop">` under an empty one that took every click. These
// tests hold the two things that keep it from coming back: every dialog is
// keyed on its id, and no id is used twice. A shut dialog draws no
// `<dialog>` element at all (src/ui/dialog.ts), so only the open one is in
// the page.

const DIALOG_IDS = [
  HOME_SCREEN_STEPS_ID,
  UPDATE_GREETING_ID,
  HAND_DIALOG_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
]

const idOf = (node: ViewNode): Option.Option<string> =>
  Option.fromUndefinedOr(node.attrs?.['id'])

const idsOf = (nodes: ReadonlyArray<ViewNode>): ReadonlyArray<string> =>
  Array.flatMap(nodes, node => Option.toArray(idOf(node)))

const duplicateIds = (root: ViewNode): ReadonlyArray<string> => {
  const ids = idsOf(nodesOf(root))
  return Array.filter(
    ids,
    (id, index) =>
      Option.getOrUndefined(Array.findFirstIndex(ids, each => each === id)) !==
      index,
  )
}

const dialogIdsOf = (root: ViewNode): ReadonlyArray<string> =>
  idsOf(Array.filter(nodesOf(root), node => node.tag === 'dialog'))

// NOTE: each Dialog child found at its id's key, once (a Scene refuses a
// key two children share), and the open one shown, as its Mount would.
const findsEachDialog =
  (openId: Option.Option<string>): SceneStep =>
  s =>
    Array.reduce(DIALOG_IDS, s, (current, id) =>
      current.givenChild(Dialog, id, dialogModel(Option.contains(openId, id))),
    )

// NOTE: a break in a run, the player in the parlour.
const inBreak: Model = modifyFocus(
  UiStruct.evolve(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
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
      UiStruct.evolve(player, {
        x: () => 270,
        y: () => 142,
        hp: () => 3,
        arsenal: () =>
          holdingSecond({ kind: 'Smg', loaded: 30, tier: 1, kills: 0 }),
      }),
  },
)

type OpenCase = Readonly<{
  name: string
  model: Model
  openId: Option.Option<string>
}>

const OPEN_CASES: ReadonlyArray<OpenCase> = [
  { name: 'nothing open', model: homeAfterRead, openId: Option.none() },
  { name: 'a break in a run', model: inBreak, openId: Option.none() },
  {
    name: 'the MORE hand',
    model: UiStruct.evolve(homeAfterRead, { handDialog: () => openDialog }),
    openId: Option.some(HAND_DIALOG_ID),
  },
  {
    name: 'a menu panel',
    model: UiStruct.evolve(homeAfterRead, {
      panel: () => 'HowToPlay',
      panelDialog: () => openDialog,
    }),
    openId: Option.some(PANEL_DIALOG_ID),
  },
  {
    name: 'the Profile',
    model: UiStruct.evolve(homeAfterRead, {
      profileDialog: () => openDialog,
    }),
    openId: Option.some(PROFILE_DIALOG_ID),
  },
  {
    name: 'the Home Screen steps',
    model: UiStruct.evolve(homeAfterRead, {
      homeScreenSteps: () => openDialog,
    }),
    openId: Option.some(HOME_SCREEN_STEPS_ID),
  },
  {
    name: 'the update greeting',
    model: UiStruct.evolve(homeAfterRead, {
      updateGreeting: () => openDialog,
    }),
    openId: Option.some(UPDATE_GREETING_ID),
  },
  {
    name: 'co-op',
    model: UiStruct.evolve(homeAfterRead, {
      coop: coop =>
        UiStruct.evolve(coop, {
          screen: () => Coop.Screen.Hub({ maybeProblem: Option.none() }),
        }),
    }),
    openId: Option.none(),
  },
]

describe('every menu dialog', () => {
  it.effect.each(OPEN_CASES)(
    'with $name, each dialog is drawn once, keyed on its id, and no id repeats',
    ({ model, openId }) =>
      Effect.gen(function* () {
        const s = yield* sceneOf(model)
        s.pipe(measureSurface, ackHudSlots, findsEachDialog(openId))
        expect(duplicateIds(s.root)).toEqual([])
        expect(Array.sort(dialogIdsOf(s.root), Order.String)).toEqual(
          Option.toArray(openId),
        )
      }),
  )
})
