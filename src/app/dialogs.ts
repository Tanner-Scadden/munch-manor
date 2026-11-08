import { Function } from 'effect'
import { type Html, createKeyedLazy } from 'foldkit/html'

import type { Dialog, DialogBlock } from '@foldkit/ui'

import {
  type MunchopediaView,
  manorHandInsidesView,
  menuPanelInsidesView,
} from '../screens/home/homeView'
import { homeScreenGuideInsidesView } from '../screens/home/installView'
import { updateGreetingInsidesView } from '../screens/home/updateGift'
import {
  HandDialogBinding,
  HomeScreenStepsBinding,
  MunchopediaBinding,
  PanelDialogBinding,
  type ProfileDialogBinding,
  UpdateGreetingBinding,
} from './bindings'
import type {
  ApplicationAttribute,
  ApplicationViewBuilder,
} from './composition'
import type { Model } from './model'

// NOTE: the root's dialogs, each a Dialog Binding in src/app/composition.ts.
// Opening and closing one is its Binding's `requestOpen` and
// `requestClose`; what the root does when one closes is its OutMessage fold.
// VIEW

type DialogModel = typeof DialogBlock.Model.Type

type DialogBinding =
  | typeof ProfileDialogBinding
  | typeof PanelDialogBinding
  | typeof HandDialogBinding
  | typeof HomeScreenStepsBinding
  | typeof UpdateGreetingBinding

type DialogShell = Readonly<{
  binding: DialogBinding
  dialog: DialogModel
  dialogClass: string
  backdropClass: string
  panelClass: string
  dialogAttributes?: ReadonlyArray<ApplicationAttribute>
  panelView: (renderInfo: Dialog.RenderInfo) => ReadonlyArray<Html>
}>

const shellView = (
  {
    binding,
    dialog,
    dialogClass,
    backdropClass,
    panelClass,
    dialogAttributes = [],
    panelView,
  }: DialogShell,
  h: ApplicationViewBuilder,
): Html =>
  h.block(
    binding.embedView({
      slotId: dialog.id,
      model: dialog,
      viewInputs: {
        hasDescription: true,
        toView: renderInfo =>
          h.dialog(
            [
              h.Key(dialog.id),
              ...renderInfo.dialog,
              h.Class(dialogClass),
              ...dialogAttributes,
            ],
            renderInfo.isVisible
              ? [
                  h.div([...renderInfo.backdrop, h.Class(backdropClass)]),
                  h.div(
                    [...renderInfo.panel, h.Class(panelClass)],
                    panelView(renderInfo),
                  ),
                ]
              : [],
          ),
      },
    }),
  )

const NO_PANEL = (): ReadonlyArray<Html> => []

const closedShellView = (
  binding: DialogBinding,
  dialog: DialogModel,
  dialogClass: string,
  backdropClass: string,
  panelClass: string,
  h: ApplicationViewBuilder,
): Html =>
  shellView(
    {
      binding,
      dialog,
      dialogClass,
      backdropClass,
      panelClass,
      panelView: NO_PANEL,
    },
    h,
  )

const lazyClosedShells = createKeyedLazy()

const isShut = (dialog: DialogModel): boolean =>
  !dialog.isOpen && dialog.animation.transitionState === 'Idle'

// NOTE: every menu dialog is in the view on every frame, and building even a
// closed one (its submodel boundary and Dialog's attributes) cost a run about
// a fifth of its view time. A dialog that is shut, neither open nor playing
// its leave animation, shows nothing, so it comes from a lazy slot keyed on
// its id and redraws only when its Dialog model changes, as opening does. Its
// `dialogAttributes` are left off while it is shut: they style the open
// panel, and the open view puts them back. Its Binding is one value for the
// whole page, from src/app/composition.ts, so the slot hits.
//
// The `<dialog>` is keyed on its id, open or shut, and that is what makes
// the cache safe. A cache hit hands snabbdom the very VNode it patched last
// frame. Unkeyed, snabbdom pairs siblings by position, so when the page's
// list changed at both ends (opening co-op drops the home menu from the
// front and adds the co-op screen at the end) it built a new element for
// each cached dialog, wrote it into that shared VNode, and then removed the
// new element instead of the old one. The page kept the old dialogs while
// the cache pointed at detached copies, and the shop opened as a second
// `<dialog id="shop">` under an empty one that took every click. Keyed, a
// cached dialog is found by its id wherever it moves. `dialogs.scene.test.ts`
// holds every dialog to a key and every id to one element.
export const dialogShell: {
  (h: ApplicationViewBuilder): (shell: DialogShell) => Html
  (shell: DialogShell, h: ApplicationViewBuilder): Html
} = Function.dual(2, (shell: DialogShell, h: ApplicationViewBuilder): Html =>
  isShut(shell.dialog)
    ? lazyClosedShells(shell.dialog.id, closedShellView, [
        shell.binding,
        shell.dialog,
        shell.dialogClass,
        shell.backdropClass,
        shell.panelClass,
        h,
      ])
    : shellView(shell, h),
)

// THE ROOT'S DIALOGS

// NOTE: each root Dialog Binding in its shell, around the insides its screen
// draws.

// NOTE: the Munchopedia in the menu panel, through its Binding, built at
// module scope so a frame makes no closure for it.
const munchopediaView: MunchopediaView = (model, doneButton, h) =>
  h.block(
    MunchopediaBinding.embedView({
      slotId: 'munchopedia',
      model: model.munchopedia,
      viewInputs: {
        killsByKind: model.bests.killsByKind,
        openedEntries: model.home.openedEntries,
        seenUnlocks: model.seenUnlocks,
        screenMs: model.screenMs,
        doneButton,
      },
    }),
  )

export const manorHandView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.handDialog,
      dialogClass: 'hand-dialog',
      backdropClass: 'hand-backdrop',
      panelClass: 'hand',
      dialogAttributes: [h.DataAttribute('device', model.lastDevice)],
      panelView: renderInfo => manorHandInsidesView(model, renderInfo, h),
      binding: HandDialogBinding,
    },
    h,
  ),
)

export const menuPanelView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.panelDialog,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel',
      dialogAttributes: [h.DataAttribute('panel', model.panel)],
      panelView: renderInfo =>
        menuPanelInsidesView(model, renderInfo, munchopediaView, h),
      binding: PanelDialogBinding,
    },
    h,
  ),
)

export const homeScreenGuideView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.homeScreenSteps,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel install-guide',
      dialogAttributes: [h.DataAttribute('panel', 'HomeScreen')],
      panelView: renderInfo => homeScreenGuideInsidesView(renderInfo, h),
      binding: HomeScreenStepsBinding,
    },
    h,
  ),
)

export const updateGreetingView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.updateGreeting,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel greeting-panel',
      dialogAttributes: [h.DataAttribute('panel', 'Updated')],
      panelView: renderInfo => updateGreetingInsidesView(renderInfo, h),
      binding: UpdateGreetingBinding,
    },
    h,
  ),
)
