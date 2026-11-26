import { Effect, Function, Option, Schema, String, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'
import { normalizeCode } from '@munch/sync-engine'

import { randomAppearance } from '../../art/appearance'
import {
  type GearTap,
  canAfford,
  gearTapOf,
  priceOf,
} from '../../domain/closet'
import { type LookPart, chooseLook as lookWith } from '../../domain/looks'
import { isStyleOpen } from '../../domain/mastery'
import {
  cleanName,
  draftName,
  rollName,
  shownName,
} from '../../domain/playerName'
import { lookUnlockId, markLooksSeen, withoutFresh } from '../../domain/unlocks'
import type { LookToggle } from '../../features/profile/blocks/look/lookSchema'
import {
  type Gear,
  flipLook as flipped,
  gearOf,
} from '../../features/profile/blocks/look/model'
import {
  ProfileMessage,
  type SettingTile,
} from '../../features/profile/message'
import type {
  LookOutcome,
  Model as ProfileModel,
  ProfileTab,
} from '../../features/profile/model'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from '../../features/profile/profile'
import {
  opened,
  showTab,
  withFx,
  withOutcome,
  withSyncedName,
  withoutPreview,
} from '../../features/profile/steps'
import { isCharacterKey } from '../../input/input'
import { LinkFlow } from '../../platform/playerSync'
import { forgetTutorial } from '../../platform/save'
import { PlayerStore } from '../../platform/store'
import {
  type CosmeticKind,
  type PropStyle,
  cosmeticIdOf,
} from '../../shared/playerData'
import { stepWhen } from '../../shared/stepWhen'
import { rankOf, totalPointsOf } from '../../world/heroes/rank'
import { MenuState, menuState } from '../menuState'
import type { Model } from '../model'
import { keepName, openRootDialog } from './dialog'
import { toggleFullscreen } from './fullscreen'
import { toggleRotation } from './rotation'
import {
  playSounds,
  toggleMusic,
  toggleSound,
  uiCue,
  unlockAudio,
} from './sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  releaseInput,
  unchanged,
} from './step'

export class RequestLinkCode extends Command.Service<RequestLinkCode>()(
  'app/RequestLinkCode',
  { args: {}, success: ProfileMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return () =>
        pipe(
          store.requestLinkCode,
          Effect.map(code => ProfileMessage.SucceededRequestLinkCode({ code })),
          Effect.catch(error =>
            Effect.succeed(
              ProfileMessage.FailedRequestLinkCode({ problem: error.problem }),
            ),
          ),
        )
    }),
  )
}

export class RedeemLinkCode extends Command.Service<RedeemLinkCode>()(
  'app/RedeemLinkCode',
  { args: { code: Schema.String }, success: ProfileMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return ({ code }) =>
        pipe(
          store.redeemLinkCode(code),
          Effect.as(ProfileMessage.SucceededRedeemLinkCode()),
          Effect.catch(error =>
            Effect.succeed(
              ProfileMessage.FailedRedeemLinkCode({ problem: error.problem }),
            ),
          ),
        )
    }),
  )
}

export const FocusProfileElement = Command.make(
  'FocusProfileElement',
  { args: { selector: Schema.String } },
  ({ selector }) =>
    Effect.sync(() => {
      const element = document.querySelector(selector)
      if (element instanceof HTMLElement) {
        element.focus()
      }
    }).pipe(Effect.as(Component.noop)),
)

const focusProfile =
  (selector: string): UpdateStep =>
  $ =>
    $.run(FocusProfileElement.make({ selector }))

const inProfile = (change: (profile: ProfileModel) => ProfileModel) =>
  modelStep(model => UiStruct.evolve(model, { profile: change }))

const canOpenProfile = (model: Model): boolean =>
  MenuState.matchOrElse(
    menuState(model),
    {
      Home: () => true,
      EndScreen: ({ isPastGrace }) => isPastGrace,
    },
    () => false,
  )

const seenOn = (model: Model, tab: ProfileTab): Model =>
  tab === 'Look' ? markLooksSeen(model) : model

export const openProfile = (tab: ProfileTab): UpdateStep =>
  stepWhen(
    canOpenProfile,
    combine([
      releaseInput,
      modelStep(model =>
        UiStruct.evolve(seenOn(model, tab), {
          profile: profile => opened(profile, tab, model.playerName),
        }),
      ),
      openRootDialog('Profile'),
    ]),
  )

export const profileFromKey = (code: string): UpdateStep =>
  isCharacterKey(code) ? openProfile('Look') : unchanged

export const takeSyncedName: {
  (was: string): (model: Model) => Model
  (model: Model, was: string): Model
} = Function.dual(2, (model: Model, was: string): Model =>
  UiStruct.evolve(model, {
    profile: profile => withSyncedName(profile, was, model.playerName),
  }),
)

const rollNameDice: UpdateStep = $ => {
  const [rngState, name] = rollName(
    $.model.cosmetics.cosmeticRngState,
    shownName(cleanName($.model.profile.nameDraft)),
  )
  return $.combine(
    modelStep(model =>
      UiStruct.evolve(model, {
        playerName: () => name,
        cosmetics: cosmetics =>
          UiStruct.evolve(cosmetics, { cosmeticRngState: () => rngState }),
        profile: profile =>
          withFx(UiStruct.evolve(profile, { nameDraft: () => name }), 'Spin'),
      }),
    ),
    playSounds([uiCue('LootPop')]),
  )
}

const switchTab = (tab: ProfileTab): UpdateStep =>
  stepWhen(
    (model: Model) => tab !== model.profile.tab,
    combine([
      modelStep(model =>
        seenOn(
          UiStruct.evolve(keepName(model), {
            profile: profile => showTab(profile, tab),
          }),
          tab,
        ),
      ),
      playSounds([uiCue('Whoosh')]),
    ]),
  )

const withLinkFlow = (linkFlow: LinkFlow) =>
  inProfile(profile => UiStruct.evolve(profile, { linkFlow: () => linkFlow }))

const requestLinkCode: UpdateStep = $ =>
  $.combine(withLinkFlow(LinkFlow.Requesting()), next =>
    next.run(RequestLinkCode.make({})),
  )

const startLinking: UpdateStep = $ =>
  LinkFlow.match($.model.profile.linkFlow, {
    Requesting: () => $.model,
    Redeeming: () => $.model,
    Idle: () => requestLinkCode($),
    Showing: () => requestLinkCode($),
    Entering: () => requestLinkCode($),
    Linked: () => requestLinkCode($),
    Failed: () => requestLinkCode($),
  })

const typeLinkCode = (value: string): UpdateStep =>
  stepWhen(
    (model: Model) =>
      LinkFlow.isAnyOf(['Entering', 'Failed'])(model.profile.linkFlow),
    withLinkFlow(
      LinkFlow.Entering({
        code: String.slice(0, 7)(String.toUpperCase(value)),
      }),
    ),
  )

const pasteLinkCode =
  (text: string, typed: string): UpdateStep =>
  $ =>
    LinkFlow.matchOrElse(
      $.model.profile.linkFlow,
      {
        Entering: ({ code }) =>
          Option.match(
            Option.filter(normalizeCode(text), () => code === typed),
            {
              onNone: () => $.model,
              onSome: pasted =>
                withLinkFlow(LinkFlow.Entering({ code: pasted }))($),
            },
          ),
      },
      () => $.model,
    )

const submitLinkCode: UpdateStep = $ =>
  LinkFlow.matchOrElse(
    $.model.profile.linkFlow,
    {
      Entering: ({ code }) =>
        $.combine(withLinkFlow(LinkFlow.Redeeming({ code })), next =>
          next.run(RedeemLinkCode.make({ code })),
        ),
    },
    () => $.model,
  )

const toggleShake = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: settings =>
      UiStruct.evolve(settings, {
        shakeSetting: setting => (setting === 'On' ? 'Off' : 'On'),
      }),
  })

const toggleCursor = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: settings =>
      UiStruct.evolve(settings, {
        cursorSetting: setting => (setting === 'Bold' ? 'Thin' : 'Bold'),
      }),
  })

const toggleRumble = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: settings =>
      UiStruct.evolve(settings, {
        rumbleSetting: setting => (setting === 'On' ? 'Off' : 'On'),
      }),
  })

const toggleShareStats = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: settings =>
      UiStruct.evolve(settings, {
        shareStats: setting => (setting === 'On' ? 'Off' : 'On'),
      }),
  })

const toggleRecordRuns = (model: Model): Model =>
  UiStruct.evolve(model, {
    settings: settings =>
      UiStruct.evolve(settings, {
        recordRuns: setting => (setting === 'On' ? 'Off' : 'On'),
      }),
  })

const SETTING_TILES: Readonly<Record<SettingTile, UpdateStep>> = {
  Sound: combine([modelStep(toggleSound), unlockAudio]),
  Music: combine([modelStep(toggleMusic), unlockAudio]),
  Shake: modelStep(toggleShake),
  Cursor: modelStep(toggleCursor),
  Fullscreen: toggleFullscreen,
  Rotation: modelStep(toggleRotation),
  Rumble: modelStep(toggleRumble),
  ShareStats: modelStep(toggleShareStats),
  RecordRuns: modelStep(toggleRecordRuns),
}

const withTutorialReset = (reset: ProfileModel['tutorialReset']) =>
  inProfile(profile => UiStruct.evolve(profile, { tutorialReset: () => reset }))

const askToResetTutorial: UpdateStep = stepWhen(
  (model: Model) => model.profile.tab === 'Settings',
  combine([
    withTutorialReset('Asking'),
    focusProfile(`#${KEEP_TUTORIAL_BUTTON_ID}`),
  ]),
)

const confirmTutorialReset: UpdateStep = stepWhen(
  (model: Model) => model.profile.tutorialReset === 'Asking',
  combine([
    withTutorialReset('Done'),
    focusProfile(`#${RESET_TUTORIAL_BUTTON_ID}`),
    modelStep(forgetTutorial),
  ]),
)

const cancelTutorialReset: UpdateStep = stepWhen(
  (model: Model) => model.profile.tutorialReset === 'Asking',
  combine([
    withTutorialReset('Idle'),
    focusProfile(`#${RESET_TUTORIAL_BUTTON_ID}`),
  ]),
)

const wearing = (model: Model, part: LookPart, value: string): Model =>
  UiStruct.evolve(model, {
    appearance: appearance => lookWith(appearance, part, value),
  })

const spentOn = (model: Model, kind: CosmeticKind, value: string): Model =>
  UiStruct.evolve(model, {
    rank: rank =>
      UiStruct.evolve(rank, {
        spentBones: spent =>
          spent + Option.getOrElse(priceOf(kind, value), () => 0),
      }),
    boughtCosmetics: bought => [...bought, cosmeticIdOf(kind, value)],
  })

type Pick = Readonly<{ part: LookPart; value: string }>

const tapOf = (model: Model, value: string, { kind, worn }: Gear): GearTap =>
  gearTapOf(
    kind,
    value,
    worn(model.appearance),
    model.boughtCosmetics,
    rankOf(totalPointsOf(model.rank)),
  )

const lookOutcome = (
  { part, value }: Pick,
  outcome: LookOutcome,
  change: UpdateStep,
): UpdateStep =>
  combine([
    change,
    inProfile(profile => withOutcome(profile, part, value, outcome)),
    outcome === 'Bought'
      ? focusProfile(`[data-look-option="${part}.${value}"]`)
      : unchanged,
  ])

const GEAR_TAPS: Readonly<Record<GearTap, (pick: Pick) => UpdateStep>> = {
  Stay: () => unchanged,
  Wear: ({ part, value }) =>
    combine([
      modelStep(model => wearing(model, part, value)),
      playSounds([uiCue('Pop')]),
    ]),
  Preview: () => playSounds([uiCue('Pop')]),
  Locked: () => playSounds([uiCue('Denied')]),
}

const chooseLook =
  (pick: Pick): UpdateStep =>
  $ =>
    Option.match(gearOf(pick.part), {
      onNone: () => lookOutcome(pick, 'Wear', GEAR_TAPS.Wear(pick))($),
      onSome: gear => {
        const tap = tapOf($.model, pick.value, gear)
        return lookOutcome(
          pick,
          tap,
          combine([
            modelStep(model =>
              withoutFresh(model, lookUnlockId(gear.kind, pick.value)),
            ),
            GEAR_TAPS[tap](pick),
          ]),
        )($)
      },
    })

const bought = ({ part, value }: Pick, kind: CosmeticKind): UpdateStep =>
  combine([
    modelStep(model => wearing(spentOn(model, kind, value), part, value)),
    playSounds([uiCue('Purchase')]),
  ])

const buyPick =
  (pick: Pick): UpdateStep =>
  $ =>
    Option.match(gearOf(pick.part), {
      onNone: () => lookOutcome(pick, 'Stay', unchanged)($),
      onSome: gear =>
        tapOf($.model, pick.value, gear) !== 'Preview'
          ? lookOutcome(pick, 'Stay', unchanged)($)
          : canAfford($.model.rank, gear.kind, pick.value)
            ? lookOutcome(pick, 'Bought', bought(pick, gear.kind))($)
            : lookOutcome(pick, 'Short', playSounds([uiCue('Denied')]))($),
    })

const buyLook: UpdateStep = $ =>
  Option.match($.model.profile.maybePreview, {
    onNone: () => $.model,
    onSome: preview => buyPick(preview)($),
  })

const flipLook = (toggle: LookToggle): UpdateStep =>
  combine([
    inProfile(profile => withFx(withoutPreview(profile), 'Poof')),
    modelStep(model =>
      UiStruct.evolve(model, {
        appearance: appearance => flipped(appearance, toggle),
      }),
    ),
    playSounds([uiCue('Pop')]),
  ])

const rollLook: UpdateStep = combine([
  inProfile(profile => withFx(withoutPreview(profile), 'Spin')),
  modelStep(model => {
    const [rngState, appearance] = randomAppearance(
      model.cosmetics.cosmeticRngState,
      model.appearance,
      model.boughtCosmetics,
      rankOf(totalPointsOf(model.rank)),
    )
    return UiStruct.evolve(model, {
      appearance: () => appearance,
      cosmetics: cosmetics =>
        UiStruct.evolve(cosmetics, { cosmeticRngState: () => rngState }),
    })
  }),
  playSounds([uiCue('LootPop')]),
])

const choosePropStyle =
  (style: PropStyle): UpdateStep =>
  $ =>
    isStyleOpen($.model.mastery, $.model.calling, style)
      ? $.combine(
          modelStep(model =>
            UiStruct.evolve(model, {
              appearance: look =>
                UiStruct.evolve(look, { propStyle: () => style }),
            }),
          ),
          playSounds([uiCue('Pop')]),
        )
      : playSounds([uiCue('Denied')])($)

export const profileHandlers = defineHandlers({
  SwitchedProfileTab: ($, { tab }) => switchTab(tab)($),
  UpdatedProfileNameDraft: ($, { value }) =>
    inProfile(profile =>
      UiStruct.evolve(profile, {
        nameDraft: () => draftName(value),
        fx: () => 'Still',
      }),
    )($),
  SubmittedProfileName: $ =>
    $.combine(modelStep(keepName), playSounds([uiCue('Pop')])),
  BlurredProfileName: $ => keepName($.model),
  RolledProfileNameDice: $ => rollNameDice($),
  ClickedLinkDevice: $ => startLinking($),
  ClickedUseLinkCode: $ => withLinkFlow(LinkFlow.Entering({ code: '' }))($),
  UpdatedLinkCode: ($, { value }) => typeLinkCode(value)($),
  SubmittedLinkCode: $ => submitLinkCode($),
  ClickedCancelLink: $ => withLinkFlow(LinkFlow.Idle())($),
  CopiedLinkCode: $ =>
    inProfile(profile =>
      UiStruct.evolve(profile, { linkCodeCopies: count => count + 1 }),
    )($),
  ReadLinkClipboard: ($, { text, typed }) => pasteLinkCode(text, typed)($),
  SucceededRequestLinkCode: ($, { code }) =>
    $.combine(
      inProfile(profile =>
        UiStruct.evolve(profile, {
          linkFlow: () => LinkFlow.Showing({ code }),
          linkCodeCopies: () => 0,
        }),
      ),
      playSounds([uiCue('Whoosh')]),
    ),
  FailedRequestLinkCode: ($, { problem }) =>
    withLinkFlow(LinkFlow.Failed({ problem }))($),
  SucceededRedeemLinkCode: $ =>
    $.combine(withLinkFlow(LinkFlow.Linked()), playSounds([uiCue('PowerUp')])),
  FailedRedeemLinkCode: ($, { problem }) =>
    withLinkFlow(LinkFlow.Failed({ problem }))($),
  ClickedProfileSetting: ($, { setting }) => SETTING_TILES[setting]($),
  ClickedResetTutorial: $ => askToResetTutorial($),
  ConfirmedTutorialReset: $ => confirmTutorialReset($),
  CancelledTutorialReset: $ => cancelTutorialReset($),
  ChoseProfileLook: ($, { part, value }) => chooseLook({ part, value })($),
  FlippedProfileLook: ($, { toggle }) => flipLook(toggle)($),
  RolledProfileLookDice: $ => rollLook($),
  ClickedBuyProfileLook: $ => buyLook($),
  ChoseProfilePropStyle: ($, { style }) => choosePropStyle(style)($),
})
