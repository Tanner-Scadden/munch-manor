import { Array, Effect, Option, Order } from 'effect'

import { UiStruct } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { describe, expect, it } from '@effect/vitest'

import { BreakClock, type Model, Phase } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { RootDialog } from '#app/rootDialog.ts'
import {
  HAND_DIALOG_ID,
  HOME_SCREEN_STEPS_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
  UPDATE_GREETING_ID,
} from '#domain/clientSchema.ts'
import * as Coop from '#domain/coopRoom.ts'
import { PREPARATION_MS } from '#shared/constants.ts'
import { holdingSecond } from '#test/arsenals.ts'
import { homeAfterRead } from '#test/model.fixture.ts'
import { ackHudSlots, dialogModel, measureSurface } from '#test/sceneTesting.ts'
import { type SceneStep, sceneOf } from '#test/testing.ts'
import { type ViewNode, nodesOf } from '#test/viewReading.ts'
import { modifyFocus } from '#world/party/party.ts'

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

const findsEachDialog =
  (openId: Option.Option<string>): SceneStep =>
  s =>
    Array.reduce(DIALOG_IDS, s, (current, id) =>
      current.givenChild(Dialog, id, dialogModel(Option.contains(openId, id))),
    )

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
    model: UiStruct.evolve(homeAfterRead, {
      rootDialog: () => RootDialog.Hand,
    }),
    openId: Option.some(HAND_DIALOG_ID),
  },
  {
    name: 'a menu panel',
    model: UiStruct.evolve(homeAfterRead, {
      panel: () => 'HowToPlay',
      rootDialog: () => RootDialog.Panel,
    }),
    openId: Option.some(PANEL_DIALOG_ID),
  },
  {
    name: 'the Profile',
    model: UiStruct.evolve(homeAfterRead, {
      rootDialog: () => RootDialog.Profile,
    }),
    openId: Option.some(PROFILE_DIALOG_ID),
  },
  {
    name: 'the Home Screen steps',
    model: UiStruct.evolve(homeAfterRead, {
      rootDialog: () => RootDialog.HomeScreenSteps,
    }),
    openId: Option.some(HOME_SCREEN_STEPS_ID),
  },
  {
    name: 'the update greeting',
    model: UiStruct.evolve(homeAfterRead, {
      rootDialog: () => RootDialog.UpdateGreeting,
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
