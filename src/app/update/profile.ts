import { Effect, Function, Option, Schema, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { MenuState, menuState } from '#app/menus/menuState.ts'
import type { Model } from '#app/model.ts'
import { randomAppearance } from '#art/appearance.ts'
import { type GearTap, canAfford, gearTapOf, priceOf } from '#domain/closet.ts'
import { type LookPart, chooseLook as lookWith } from '#domain/looks.ts'
import { isStyleOpen } from '#domain/mastery.ts'
import {
  cleanName,
  draftName,
  rollName,
  shownName,
} from '#domain/playerName.ts'
import { lookUnlockId, markLooksSeen, withoutFresh } from '#domain/unlocks.ts'
import type { LookToggle } from '#features/profile/blocks/look/lookSchema.ts'
import {
  type Gear,
  flipLook as flipped,
  gearOf,
} from '#features/profile/blocks/look/model.ts'
import { ResetEvent, stepReset } from '#features/profile/machines/resetFlow.ts'
import { ProfileMessage, type SettingTile } from '#features/profile/message.ts'
import type {
  LookOutcome,
  Model as ProfileModel,
  ProfileTab,
} from '#features/profile/model.ts'
import {
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
} from '#features/profile/profile.ts'
import {
  opened,
  showTab,
  withFx,
  withOutcome,
  withSyncedName,
  withoutPreview,
} from '#features/profile/steps.ts'
import { isCharacterKey } from '#input/input.ts'
import { LinkEvent, LinkFlow, stepLink } from '#platform/save/linkFlow.ts'
import { forgetTutorial } from '#platform/save/save.ts'
import { PlayerStore } from '#platform/save/store.ts'
import {
  type CosmeticKind,
  type PropStyle,
  cosmeticIdOf,
} from '#shared/records/playerData.ts'
import { stepWhen } from '#shared/stepWhen.ts'
import { rankOf, totalPointsOf } from '#world/heroes/rank.ts'

import { keepName, openRootDialog } from './dialog.ts'
import { toggleFullscreen } from './fullscreen.ts'
import { toggleRotation } from './rotation.ts'
import {
  playSounds,
  toggleMusic,
  toggleSound,
  uiCue,
  unlockAudio,
} from './sound.ts'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  releaseInput,
  unchanged,
} from './step.ts'

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

const resetLinkCodeCopies = inProfile(profile =>
  UiStruct.evolve(profile, { linkCodeCopies: () => 0 }),
)

const enterLinkState = (entered: LinkFlow): UpdateStep =>
  LinkFlow.$match(entered, {
    Idle: () => unchanged,
    Requesting: () => $ => $.run(RequestLinkCode.make({})),
    Showing: () =>
      combine([resetLinkCodeCopies, playSounds([uiCue('Whoosh')])]),
    Entering: () => unchanged,
    Redeeming:
      ({ code }) =>
      $ =>
        $.run(RedeemLinkCode.make({ code })),
    Linked: () => playSounds([uiCue('PowerUp')]),
    Failed: () => unchanged,
  })

const sendLink =
  (event: LinkEvent): UpdateStep =>
  $ => {
    const before = $.model.profile.linkFlow
    const after = stepLink(before, event)
    if (after === before) {
      return $.model
    } else if (after._tag === before._tag) {
      return withLinkFlow(after)($)
    } else {
      return $.combine(withLinkFlow(after), enterLinkState(after))
    }
  }

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

const moveReset =
  (event: ResetEvent, onMoved: UpdateStep): UpdateStep =>
  $ => {
    const after = stepReset($.model.profile.tutorialReset, event)
    const moved = combine([
      inProfile(profile =>
        UiStruct.evolve(profile, { tutorialReset: () => after }),
      ),
      onMoved,
    ])
    return (after === $.model.profile.tutorialReset ? unchanged : moved)($)
  }

const askToResetTutorial: UpdateStep = stepWhen(
  (model: Model) => model.profile.tab === 'Settings',
  moveReset(ResetEvent.Asked, focusProfile(`#${KEEP_TUTORIAL_BUTTON_ID}`)),
)

const confirmTutorialReset: UpdateStep = moveReset(
  ResetEvent.Confirmed,
  combine([
    focusProfile(`#${RESET_TUTORIAL_BUTTON_ID}`),
    modelStep(forgetTutorial),
  ]),
)

const cancelTutorialReset: UpdateStep = moveReset(
  ResetEvent.Cancelled,
  focusProfile(`#${RESET_TUTORIAL_BUTTON_ID}`),
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
  ClickedLinkDevice: sendLink(LinkEvent.AskedForCode),
  ClickedUseLinkCode: sendLink(LinkEvent.ChoseToEnterCode),
  UpdatedLinkCode: ($, { value }) =>
    sendLink(LinkEvent.TypedCode({ value }))($),
  SubmittedLinkCode: sendLink(LinkEvent.SubmittedCode),
  ClickedCancelLink: sendLink(LinkEvent.Cancelled),
  CopiedLinkCode: $ =>
    inProfile(profile =>
      UiStruct.evolve(profile, { linkCodeCopies: count => count + 1 }),
    )($),
  ReadLinkClipboard: ($, { text, typed }) =>
    sendLink(LinkEvent.PastedCode({ text, typed }))($),
  SucceededRequestLinkCode: ($, { code }) =>
    sendLink(LinkEvent.GotCode({ code }))($),
  FailedRequestLinkCode: ($, { problem }) =>
    sendLink(LinkEvent.FailedToGetCode({ problem }))($),
  SucceededRedeemLinkCode: sendLink(LinkEvent.Redeemed),
  FailedRedeemLinkCode: ($, { problem }) =>
    sendLink(LinkEvent.FailedToRedeem({ problem }))($),
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
