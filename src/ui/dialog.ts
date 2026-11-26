import { Record, Schema } from 'effect'

import type { Component, View } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import type { Html } from '@effect/ui/html'

// NOTE: whether a menu dialog is open, on its owner's Model (Effect UI,
// "Who owns the state"). ui-kit's Dialog draws it: the top layer, focus
// kept inside and handed back, Escape, a press outside, and the ARIA. The
// dialog asks to close and stays as it is until its owner's Model says so.
export const DialogState = Schema.Struct({ isOpen: Schema.Boolean })
export type DialogState = typeof DialogState.Type

export const closedDialog: DialogState = { isOpen: false }
export const openDialog: DialogState = { isOpen: true }

// NOTE: the parts a dialog's insides wear: `title`, `description`, `close`,
// and `initialFocus`, each taking a builder and returning it.
export type DialogParts = Component.Headless.Parts<typeof Dialog>

export type DialogShell<M> = Readonly<{
  h: Html.H<M>
  id: string
  isOpen: boolean
  dialogClass: string
  backdropClass: string
  panelClass: string
  // NOTE: a panel held in the middle of the screen sits in the viewport
  // (`dialog-viewport` in src/app/styles.css); the hand places its own.
  isCentered: boolean
  // NOTE: `data-*` attributes the open dialog wears, for its styles.
  data?: Readonly<Record<string, string>>
  onClose: M
  insides: (parts: DialogParts) => View.Children<M, never>
}>

const popupOf = <M>(shell: DialogShell<M>, dialog: DialogParts) =>
  dialog
    .popup(shell.h.div.class(shell.panelClass))
    .children(shell.insides(dialog))

// NOTE: the dialog, its backdrop, and its panel. A shut dialog draws no
// insides, so a closed menu costs a frame almost nothing.
export const dialogShellView = <M>(shell: DialogShell<M>): View.Content<M> =>
  Dialog(shell.h, {
    key: shell.id,
    props: { open: shell.isOpen, id: shell.id },
    onEmit: {
      RequestedOpen: () => undefined,
      RequestedClose: () => shell.onClose,
      Settled: () => undefined,
    },
    // NOTE: the portal is `undefined` while the dialog is shut, so it sits
    // in a slot that adds no box of its own.
    view: dialog =>
      shell.h.div.class('dialog-slot').children(
        dialog
          .portal(shell.h.dialog.class(shell.dialogClass))
          ?.attrs(Record.mapKeys(shell.data ?? {}, name => `data-${name}`))
          .children(
            dialog.backdrop(shell.h.div.class(shell.backdropClass)),
            shell.isCentered
              ? dialog
                  .viewport(shell.h.div.class('dialog-viewport'))
                  .children(popupOf(shell, dialog))
              : popupOf(shell, dialog),
          ),
      ),
  })
