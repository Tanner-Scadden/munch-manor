import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import {
  DialogEvent,
  RootDialog,
  rootDialogMachine,
  stepRootDialog,
} from '#app/rootDialog.ts'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(rootDialogMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

describe("the root's dialogs", () => {
  test('a dialog opens only when none is up, and closes only itself', () => {
    expect(registered()).toEqual([
      'Hand/Closed',
      'HomeScreenSteps/Closed',
      'Panel/Closed',
      'Profile/Closed',
      'Shut/Opened',
      'UpdateGreeting/Closed',
    ])
    expect(Machine.definition(rootDialogMachine).anyState).toEqual([])
  })

  test('opening one over another leaves the first up', () => {
    expect(
      stepRootDialog(
        RootDialog.Hand,
        DialogEvent.Opened({ dialog: 'Profile' }),
      ),
    ).toBe(RootDialog.Hand)
  })

  test('closing a dialog that is not up changes nothing', () => {
    expect(
      stepRootDialog(RootDialog.Panel, DialogEvent.Closed({ dialog: 'Hand' })),
    ).toBe(RootDialog.Panel)
    expect(
      stepRootDialog(RootDialog.Panel, DialogEvent.Closed({ dialog: 'Panel' })),
    ).toBe(RootDialog.Shut)
  })
})
