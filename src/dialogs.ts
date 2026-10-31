import {
  type Attribute,
  type ChildAttribute,
  type Html,
  type HtmlBuilder,
  createKeyedLazy,
} from 'foldkit/html'

import type { Dialog, DialogBlock } from '@foldkit/ui'

import type {
  HandDialogBinding,
  HomeScreenStepsBinding,
  PanelDialogBinding,
  ProfileDialogBinding,
  ShopDialogBinding,
  UpdateGreetingBinding,
} from './bindings'
import type {
  ApplicationAttribute,
  ApplicationViewBuilder,
} from './composition'
import { CLOSE_ICON } from './icons'

// NOTE: the root's dialogs, each a Dialog Binding in src/composition.ts.
// Opening and closing one is its Binding's `requestOpen` and
// `requestClose`; what the root does when one closes is its OutMessage fold.
// VIEW

type DialogModel = typeof DialogBlock.Model.Type

export type DialogBinding =
  | typeof ShopDialogBinding
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
// whole page, from src/composition.ts, so the slot hits.
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
export const dialogShell = (
  shell: DialogShell,
  h: ApplicationViewBuilder,
): Html =>
  isShut(shell.dialog)
    ? lazyClosedShells(shell.dialog.id, closedShellView, [
        shell.binding,
        shell.dialog,
        shell.dialogClass,
        shell.backdropClass,
        shell.panelClass,
        h,
      ])
    : shellView(shell, h)

// CLOSE

type CloseButton<Message> = Readonly<{
  attributes: ReadonlyArray<Attribute<Message> | ChildAttribute>
  className: string
  label: string
}>

// NOTE: the one close button every menu dialog shares: the shop's red pixel
// X on a small face, centered in a bigger see-through button, so it looks
// small but a thumb still has a 48 px target. `className` only places it.
// `attributes` carry what it does: a Dialog's `closeButton`, or an OnClick
// for a screen that is not a Dialog, such as co-op's.
export const closeButtonView = <Message>(
  { attributes, className, label }: CloseButton<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      ...attributes,
      h.Class(`menu-close ${className}`),
      h.AriaLabel(label),
      h.AriaKeyshortcuts('Escape'),
    ],
    [
      h.span(
        [h.Class('menu-close-face'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('menu-close-icon'),
            h.Style({ backgroundImage: CLOSE_ICON }),
          ]),
        ],
      ),
    ],
  )
