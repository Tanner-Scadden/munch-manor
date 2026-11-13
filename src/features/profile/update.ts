import { Effect, Option, Schema, String, pipe } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { normalizeCode } from '@munch/sync-engine'

import { cleanName, draftName, shownName } from '../../domain/playerName'
import { LinkFlow } from '../../platform/playerSync'
import { PlayerStore } from '../../platform/store'
import { ProfileBlock, makeNoopStep, makeOutMessageStep } from './block'
import { ProfileComposition } from './composition'
import { Message, OutMessage } from './message'
import type { Model } from './model'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from './profile'
import { keepName, submitName } from './steps'

// COMMANDS

export const RequestLinkCode = ProfileBlock.makeCommand('RequestLinkCode', {
  messages: [Message.SucceededRequestLinkCode, Message.FailedRequestLinkCode],
  handler: function* () {
    return () =>
      pipe(
        PlayerStore.use(store => store.requestLinkCode),
        Effect.map(code => Message.SucceededRequestLinkCode({ code })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRequestLinkCode({ problem: error.problem }),
          ),
        ),
      )
  },
})

export const RedeemLinkCode = ProfileBlock.makeCommand('RedeemLinkCode', {
  args: { code: Schema.String },
  messages: [Message.SucceededRedeemLinkCode, Message.FailedRedeemLinkCode],
  handler: function* () {
    return ({ code }) =>
      pipe(
        PlayerStore.use(store => store.redeemLinkCode(code)),
        Effect.as(Message.SucceededRedeemLinkCode()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRedeemLinkCode({ problem: error.problem }),
          ),
        ),
      )
  },
})

export const FocusTutorialReset = ProfileBlock.makeCommand(
  'FocusTutorialReset',
  {
    args: { id: Schema.String },
    messages: [Message.CompletedFocusTutorialReset],
    handler: function* () {
      return ({ id }) =>
        Dom.focus(`#${id}`).pipe(
          Effect.ignore,
          Effect.as(Message.CompletedFocusTutorialReset()),
        )
    },
  },
)

// LINKING

const requestLinkCode = (model: Model) => ({
  model: modifyFields(model, { linkFlow: () => LinkFlow.Requesting() }),
  commands: [RequestLinkCode()],
})

const startLinking = (model: Model) =>
  LinkFlow.match(model.linkFlow, {
    Requesting: () => ({ model }),
    Redeeming: () => ({ model }),
    Idle: () => requestLinkCode(model),
    Showing: () => requestLinkCode(model),
    Entering: () => requestLinkCode(model),
    Linked: () => requestLinkCode(model),
    Failed: () => requestLinkCode(model),
  })

const typeLinkCode = (model: Model, value: string) => ({
  model: LinkFlow.isAnyOf(['Entering', 'Failed'])(model.linkFlow)
    ? modifyFields(model, {
        linkFlow: () =>
          LinkFlow.Entering({
            code: String.slice(0, 7)(String.toUpperCase(value)),
          }),
      })
    : model,
})

// NOTE: a tap on the code field read the clipboard. Its text fills the
// field only when it cleans to a link code (any case, a space or a dash
// between the halves) and nothing was typed since the tap, so a paste
// never lands over typing. Anything else leaves the field to the keyboard.
const pasteLinkCode = (model: Model, text: string, typed: string) =>
  LinkFlow.matchOrElse(
    model.linkFlow,
    {
      Entering: ({ code }) => ({
        model: Option.match(
          Option.filter(normalizeCode(text), () => code === typed),
          {
            onNone: () => model,
            onSome: pasted =>
              modifyFields(model, {
                linkFlow: () => LinkFlow.Entering({ code: pasted }),
              }),
          },
        ),
      }),
    },
    () => ({ model }),
  )

const submitLinkCode = (model: Model) =>
  LinkFlow.match(model.linkFlow, {
    Entering: ({ code }) => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Redeeming({ code }),
      }),
      commands: [RedeemLinkCode({ code })],
    }),
    Idle: () => ({ model }),
    Requesting: () => ({ model }),
    Showing: () => ({ model }),
    Redeeming: () => ({ model }),
    Linked: () => ({ model }),
    Failed: () => ({ model }),
  })

// TUTORIAL RESET

// NOTE: the reset asks first, on the Settings tab only. Its answer moves
// focus to the button left standing; RESET also tells the root, which
// forgets the lessons.
const askToResetTutorial = (model: Model) =>
  model.tab === 'Settings'
    ? {
        model: modifyFields(model, { tutorialReset: () => 'Asking' }),
        commands: [FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID })],
      }
    : { model }

const confirmTutorialReset = (model: Model) =>
  model.tutorialReset === 'Asking'
    ? {
        model: modifyFields(model, { tutorialReset: () => 'Done' }),
        commands: [FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID })],
        outMessage: OutMessage.ConfirmedTutorialReset(),
      }
    : { model }

const cancelTutorialReset = (model: Model) =>
  model.tutorialReset === 'Asking'
    ? {
        model: modifyFields(model, { tutorialReset: () => 'Idle' }),
        commands: [FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID })],
      }
    : { model }

// UPDATE

export const update = ProfileComposition.makeUpdate({
  UpdatedNameDraft: (model, { value }) => ({
    model: modifyFields(model, {
      nameDraft: () => draftName(value),
      fx: () => 'Still',
    }),
  }),

  SubmittedName: submitName,

  BlurredNameInput: keepName,

  // NOTE: the dice draw from the root's seeded generator: the root rolls
  // and answers with InformedOfRolledName. The roll never lands on the name
  // showing.
  ClickedNameDiceButton: makeOutMessageStep(model =>
    OutMessage.RolledNameDice({
      current: shownName(cleanName(model.nameDraft)),
    }),
  ),

  ClickedLinkDeviceButton: startLinking,

  SucceededRequestLinkCode: (model, { code }) => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Showing({ code }),
      linkCodeCopies: () => 0,
    }),
    outMessage: OutMessage.ShowedLinkCode(),
  }),

  FailedRequestLinkCode: (model, { problem }) => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Failed({ problem }),
    }),
  }),

  ClickedUseCodeButton: model => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Entering({ code: '' }),
    }),
  }),

  UpdatedLinkCode: (model, { value }) => typeLinkCode(model, value),

  SubmittedLinkCode: submitLinkCode,

  SucceededRedeemLinkCode: model => ({
    model: modifyFields(model, { linkFlow: () => LinkFlow.Linked() }),
    outMessage: OutMessage.LinkedDevice(),
  }),

  FailedRedeemLinkCode: (model, { problem }) => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Failed({ problem }),
    }),
  }),

  ClickedCancelLinkButton: model => ({
    model: modifyFields(model, { linkFlow: () => LinkFlow.Idle() }),
  }),

  SucceededCopyLinkCode: model => ({
    model: modifyFields(model, { linkCodeCopies: count => count + 1 }),
  }),

  SucceededReadClipboard: (model, { text, typed }) =>
    pasteLinkCode(model, text, typed),

  ClickedSettingTile: makeOutMessageStep.fromMessage(({ setting }) =>
    OutMessage.ClickedSetting({ setting }),
  ),

  ClickedResetTutorialButton: askToResetTutorial,

  ClickedConfirmResetTutorialButton: confirmTutorialReset,

  ClickedCancelResetTutorialButton: cancelTutorialReset,

  CompletedFocusTutorialReset: makeNoopStep(),

  CompletedFocusLookOption: makeNoopStep(),

  ClickedPropStyle: makeOutMessageStep.fromMessage(({ style }) =>
    OutMessage.ChosePropStyle({ style }),
  ),
})
