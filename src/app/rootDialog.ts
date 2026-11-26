import { Function, Schema } from 'effect'
import { Event, Machine, State } from 'effect-machine'

import { machineStepOf } from '#domain/machineStep.ts'

export const DialogName = Schema.Literals([
  'Profile',
  'Panel',
  'Hand',
  'HomeScreenSteps',
  'UpdateGreeting',
])
export type DialogName = typeof DialogName.Type

export const RootDialog = State({
  Shut: {},
  Profile: {},
  Panel: {},
  Hand: {},
  HomeScreenSteps: {},
  UpdateGreeting: {},
})
export type RootDialog = typeof RootDialog.Type

export const DialogEvent = Event({
  Opened: { dialog: DialogName },
  Closed: { dialog: DialogName },
})
export type DialogEvent = typeof DialogEvent.Type

const OPENED: { readonly [Name in DialogName]: RootDialog } = {
  Profile: RootDialog.Profile,
  Panel: RootDialog.Panel,
  Hand: RootDialog.Hand,
  HomeScreenSteps: RootDialog.HomeScreenSteps,
  UpdateGreeting: RootDialog.UpdateGreeting,
}

const OPEN_DIALOGS = [
  RootDialog.Profile,
  RootDialog.Panel,
  RootDialog.Hand,
  RootDialog.HomeScreenSteps,
  RootDialog.UpdateGreeting,
]

export const rootDialogMachine = Machine.make({
  state: RootDialog,
  event: DialogEvent,
  initial: RootDialog.Shut,
})
  .on(RootDialog.Shut, DialogEvent.Opened, ({ event }) => OPENED[event.dialog])
  .when(
    OPEN_DIALOGS,
    DialogEvent.Closed,
    function isTheOneOpen({ state, event }) {
      return state._tag === event.dialog
    },
    () => RootDialog.Shut,
  )

export const stepRootDialog = machineStepOf(rootDialogMachine)

export const isRootDialogOpen: {
  (dialog: DialogName): (owner: Readonly<{ rootDialog: RootDialog }>) => boolean
  (owner: Readonly<{ rootDialog: RootDialog }>, dialog: DialogName): boolean
} = Function.dual(
  2,
  (owner: Readonly<{ rootDialog: RootDialog }>, dialog: DialogName): boolean =>
    owner.rootDialog._tag === dialog,
)
