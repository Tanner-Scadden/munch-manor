import { Record } from 'effect'

import type { Component, View } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import type { Html } from '@effect/ui/html'

export type DialogParts = Component.Headless.Parts<typeof Dialog>

export type DialogShell<M> = Readonly<{
  h: Html.H<M>
  id: string
  isOpen: boolean
  dialogClass: string
  backdropClass: string
  panelClass: string
  isCentered: boolean
  data?: Readonly<Record<string, string>>
  onClose: M
  insides: (parts: DialogParts) => View.Children<M, never>
}>

const popupOf = <M>(shell: DialogShell<M>, dialog: DialogParts) =>
  dialog
    .popup(shell.h.div.class(shell.panelClass))
    .children(shell.insides(dialog))

export const dialogShellView = <M>(shell: DialogShell<M>): View.Content<M> =>
  Dialog(shell.h, {
    key: shell.id,
    props: { open: shell.isOpen, id: shell.id },
    onEmit: {
      RequestedOpen: () => undefined,
      RequestedClose: () => shell.onClose,
      Settled: () => undefined,
    },
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
