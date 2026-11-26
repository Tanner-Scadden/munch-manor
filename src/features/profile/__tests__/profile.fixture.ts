import { Array, Effect, Function, type Scope } from 'effect'

import { UiStruct } from '@effect/ui'
import { RadioGroup, RadioGroupEvents } from '@effect/ui-kit'
import { HtmlScene } from '@effect/ui/html/testing'
import type { Locator } from '@effect/ui/testing'

import { Message } from '../../../app/message'
import type { Model } from '../../../app/model'
import { profilePropsOf } from '../../../app/profileView'
import type { LookPart } from '../../../domain/looks'
import { readyAfterRead } from '../../../test/model.fixture'
import { button, byClass, withAttrs } from '../../../test/sceneTesting'
import {
  type AppStory,
  type StoryStep,
  send,
  settleRunCommands,
  storyOf,
} from '../../../test/testing'
import { Profile } from '../block'
import { Character } from '../blocks/look/block'
import { Events as LookEvents } from '../blocks/look/message'
import type { CharacterProps } from '../blocks/look/model'
import { Events } from '../message'
import type { ProfileTab } from '../model'

// The Profile and its Look tab as the root draws them, for the tests in
// this folder and in blocks/look/__tests__/. Both are children, leaves in
// the root's Scene, so their insides are drawn in a Scene of their own. A
// desk pairs that Scene with a Story of the root: each event the child
// sends goes up as the root's Message (as the views' `onEmit` maps it), and
// the child is drawn again with the props the root's Model then hands it.

// NOTE: the Model with the Profile already open on `tab`.
export const profileOpenOn = (tab: ProfileTab): Model =>
  UiStruct.evolve(readyAfterRead, {
    profile: profile => UiStruct.evolve(profile, { tab: () => tab }),
    profileDialog: dialog => UiStruct.evolve(dialog, { isOpen: () => true }),
  })

// NOTE: the Profile's events as the root hears them (src/app/profileView.ts).
const rootMessageOf = (event: Events): Message =>
  Events.match(event, {
    SwitchedTab: ({ tab }) => Message.SwitchedProfileTab({ tab }),
    UpdatedNameDraft: ({ value }) => Message.UpdatedProfileNameDraft({ value }),
    SubmittedName: () => Message.SubmittedProfileName(),
    BlurredNameInput: () => Message.BlurredProfileName(),
    RolledNameDice: () => Message.RolledProfileNameDice(),
    ClickedLinkDevice: () => Message.ClickedLinkDevice(),
    ClickedUseCode: () => Message.ClickedUseLinkCode(),
    UpdatedLinkCode: ({ value }) => Message.UpdatedLinkCode({ value }),
    SubmittedLinkCode: () => Message.SubmittedLinkCode(),
    ClickedCancelLink: () => Message.ClickedCancelLink(),
    CopiedLinkCode: () => Message.CopiedLinkCode(),
    ReadClipboard: ({ text, typed }) =>
      Message.ReadLinkClipboard({ text, typed }),
    ClickedSetting: ({ setting }) => Message.ClickedProfileSetting({ setting }),
    ClickedResetTutorial: () => Message.ClickedResetTutorial(),
    ConfirmedTutorialReset: () => Message.ConfirmedTutorialReset(),
    CancelledTutorialReset: () => Message.CancelledTutorialReset(),
    ChosePropStyle: ({ style }) => Message.ChoseProfilePropStyle({ style }),
    ChoseLook: ({ part, value }) => Message.ChoseProfileLook({ part, value }),
    FlippedLook: ({ toggle }) => Message.FlippedProfileLook({ toggle }),
    RolledLookDice: () => Message.RolledProfileLookDice(),
    ClickedBuyLook: ({ part, value }) =>
      Message.ClickedBuyProfileLook({ part, value }),
  })

// NOTE: the Look tab's events as the root hears them, through the Profile
// (src/features/profile/view.ts, then src/app/profileView.ts).
const rootMessageOfLook = (event: LookEvents): Message =>
  LookEvents.match(event, {
    ChoseLook: ({ part, value }) => Message.ChoseProfileLook({ part, value }),
    FlippedLook: ({ toggle }) => Message.FlippedProfileLook({ toggle }),
    RolledDice: () => Message.RolledProfileLookDice(),
    ClickedBuy: ({ part, value }) =>
      Message.ClickedBuyProfileLook({ part, value }),
  })

// NOTE: the Look tab's props as the Profile hands them down.
export const characterPropsOf = (model: Model): CharacterProps => {
  const props = profilePropsOf(model)
  return {
    appearance: props.appearance,
    calling: props.calling,
    screenMs: props.screenMs,
    fx: props.state.fx,
    fxCount: props.state.fxCount,
    bought: props.bought,
    rank: props.rank,
    fresh: props.fresh,
    maybePreview: props.state.maybePreview,
    cue: props.state.closetCue,
  }
}

export type ProfileScene = HtmlScene.Steps<typeof Profile>

export type LookScene = HtmlScene.Steps<typeof Character>

type Desk<S> = Readonly<{ root: AppStory; scene: S }>

export type ProfileDesk = Desk<ProfileScene>

export type LookDesk = Desk<LookScene>

// NOTE: the root's Story from `model`, with the Profile drawn from it.
export const profileDeskOf = (
  model: Model,
): Effect.Effect<ProfileDesk, never, Scope.Scope> =>
  Effect.gen(function* () {
    const root = yield* storyOf(model)
    const scene = yield* HtmlScene.make(Profile, profilePropsOf(root.model))
    return { root, scene }
  })

// NOTE: the same for the Look tab.
export const lookDeskOf = (
  model: Model,
): Effect.Effect<LookDesk, never, Scope.Scope> =>
  Effect.gen(function* () {
    const root = yield* storyOf(model)
    const scene = yield* HtmlScene.make(Character, characterPropsOf(root.model))
    return { root, scene }
  })

// NOTE: what the child sent since the last relay, taken up to the root, and
// the child drawn again from the root's Model.
const relayProfile = (desk: ProfileDesk): ProfileDesk => {
  const events = desk.scene.current.emitted
  if (Array.isReadonlyArrayNonEmpty(events)) {
    desk.scene.emitted(...events)
    Array.forEach(events, event => {
      desk.root.send(rootMessageOf(event))
    })
  }
  desk.scene.props(profilePropsOf(desk.root.model))
  return desk
}

const relayLook = (desk: LookDesk): LookDesk => {
  const events = desk.scene.current.emitted
  if (Array.isReadonlyArrayNonEmpty(events)) {
    desk.scene.emitted(...events)
    Array.forEach(events, event => {
      desk.root.send(rootMessageOfLook(event))
    })
  }
  desk.scene.props(characterPropsOf(desk.root.model))
  return desk
}

// NOTE: a step on the child's Scene, then its events relayed: one thing a
// player does in the panel, as a step over the desk:
// `inPanel(s => s.click(tab('Name')))(desk)`.
export const inPanel =
  (step: (scene: ProfileScene) => ProfileScene) =>
  (desk: ProfileDesk): ProfileDesk => {
    step(desk.scene)
    return relayProfile(desk)
  }

export const inLook =
  (step: (scene: LookScene) => LookScene) =>
  (desk: LookDesk): LookDesk => {
    step(desk.scene)
    return relayLook(desk)
  }

// NOTE: a step on the root's Story, then the child drawn again.
export const atRoot =
  (step: (root: AppStory) => AppStory) =>
  (desk: ProfileDesk): ProfileDesk => {
    step(desk.root)
    desk.scene.props(profilePropsOf(desk.root.model))
    return desk
  }

export const atLookRoot =
  (step: (root: AppStory) => AppStory) =>
  (desk: LookDesk): LookDesk => {
    step(desk.root)
    desk.scene.props(characterPropsOf(desk.root.model))
    return desk
  }

export const characterButton = button('Your character: change how you look')

// NOTE: a check on the Look tab's Scene, as a step over the desk.
export const seeLook = (check: (scene: LookScene) => LookScene) => inLook(check)

// NOTE: a little tab picked, as the kit's RadioGroup says it: a Scene runs
// no child's update.
export const openLookSection = (value: string) =>
  inLook(s =>
    s.childEmit(
      RadioGroup,
      'look-sections',
      RadioGroupEvents.Picked({ value }),
    ),
  )

// NOTE: an option in a row of earned looks, by the look it picks: its name
// is read with its spoken standing ("Blue worn").
export const lookOption: {
  (value: string): (part: LookPart) => Locator.Locator
  (part: LookPart, value: string): Locator.Locator
} = Function.dual(2, (part: LookPart, value: string): Locator.Locator =>
  withAttrs({ 'data-look-option': `${part}.${value}` })(byClass('look-option')),
)

// NOTE: the Look tab's root Commands settled.
export const settleLook = atLookRoot(settleRunCommands)

// NOTE: a part picked in the Look tab's radio group, as the root hears it:
// the Look tab says ChoseLook, the Profile passes it up as ChoseProfileLook.
export const pickLook: {
  (value: string): (part: LookPart) => StoryStep
  (part: LookPart, value: string): StoryStep
} = Function.dual(2, (part: LookPart, value: string): StoryStep =>
  send(Message.ChoseProfileLook({ part, value })),
)

export const rollLookDice: StoryStep = send(Message.RolledProfileLookDice())
