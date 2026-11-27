import { Function } from 'effect'

import type { ApplicationHtml, ApplicationViewBuilder } from '#app/component.ts'
import { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import {
  HAND_DIALOG_ID,
  HOME_SCREEN_STEPS_ID,
  PANEL_DIALOG_ID,
  UPDATE_GREETING_ID,
} from '#domain/clientSchema.ts'
import { openedThingsOf } from '#domain/journal.ts'
import { Munchopedia } from '#features/munchopedia/block.ts'
import { ProofShelf } from '#features/proof/block.ts'
import { shelfThingsFor } from '#features/proof/proof.ts'
import {
  type PanelChildViews,
  manorHandInsidesView,
  menuPanelInsidesView,
} from '#screens/home/homeView.ts'
import { homeScreenGuideInsidesView } from '#screens/home/installView.ts'
import { updateGreetingInsidesView } from '#screens/home/updateGift.ts'
import { dialogShellView } from '#ui/dialog.ts'

import { isRootDialogOpen } from './rootDialog.ts'

const munchopediaView: PanelChildViews['munchopedia'] = (model, done, h) =>
  Munchopedia(h, {
    key: 'munchopedia',
    props: {
      page: model.munchopediaPage,
      journal: model.journal,
      mastery: model.mastery,
      proof: model.proof,
      fresh: model.freshUnlocks,
      killsByKind: model.bests.killsByKind,
      openedEntries: model.home.openedEntries,
      seenUnlocks: model.seenUnlocks,
      screenMs: model.screenMs,
    },
    onEmit: {
      ChangedPage: ({ page }) => Message.ChangedMunchopediaPage({ page }),
      OpenedEntry: ({ kind }) => Message.OpenedMunchopediaEntry({ kind }),
    },
    slots: { done },
  })

const proofShelfView: PanelChildViews['proof'] = (model, done, h) =>
  ProofShelf(h, {
    key: 'proof-shelf',
    props: {
      proof: model.proof,
      things: shelfThingsFor(openedThingsOf(model)),
      stampedDays: model.missions.stampedDays,
      maybeToday: model.maybeToday,
      fresh: model.freshUnlocks,
      dareMarks: model.dareMarks,
    },
    slots: { done },
  })

const PANEL_CHILD_VIEWS: PanelChildViews = {
  munchopedia: munchopediaView,
  proof: proofShelfView,
}

export const manorHandView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    dialogShellView({
      h,
      id: HAND_DIALOG_ID,
      isOpen: isRootDialogOpen(model, 'Hand'),
      dialogClass: 'hand-dialog',
      backdropClass: 'hand-backdrop',
      panelClass: 'hand',
      isCentered: false,
      data: { device: model.lastDevice },
      onClose: Message.ClosedDialog({ dialog: 'Hand' }),
      insides: parts => manorHandInsidesView(model, parts, h),
    }),
)

export const menuPanelView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    dialogShellView({
      h,
      id: PANEL_DIALOG_ID,
      isOpen: isRootDialogOpen(model, 'Panel'),
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel',
      isCentered: true,
      data: { panel: model.panel },
      onClose: Message.ClosedDialog({ dialog: 'Panel' }),
      insides: parts =>
        menuPanelInsidesView(model, parts, PANEL_CHILD_VIEWS, h),
    }),
)

export const homeScreenGuideView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    dialogShellView({
      h,
      id: HOME_SCREEN_STEPS_ID,
      isOpen: isRootDialogOpen(model, 'HomeScreenSteps'),
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel install-guide',
      isCentered: true,
      data: { panel: 'HomeScreen' },
      onClose: Message.ClosedDialog({ dialog: 'HomeScreenSteps' }),
      insides: parts => homeScreenGuideInsidesView(parts, h),
    }),
)

export const updateGreetingView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    dialogShellView({
      h,
      id: UPDATE_GREETING_ID,
      isOpen: isRootDialogOpen(model, 'UpdateGreeting'),
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel greeting-panel',
      isCentered: true,
      data: { panel: 'Updated' },
      onClose: Message.ClosedDialog({ dialog: 'UpdateGreeting' }),
      insides: parts => updateGreetingInsidesView(parts, h),
    }),
)
