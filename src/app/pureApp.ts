// The game's init, update, and view as plain synchronous functions, for the
// tests' named Models and Steps and for the tools that replay the game (the
// balance bot, the determinism tools, the audit harness, the sprite atlas).
// The app itself never imports this module: the Program takes the Block and
// its Layer (src/app/entry.ts).

import { Effect, Function } from 'effect'
import { Story } from 'foldkit'
import type { BlockOfBinding } from 'foldkit/block'
import { toParentMessageFor } from 'foldkit/test'

import type { DialogBlock } from '@foldkit/ui'

import { HeroPickerBinding as CoopHeroPickerBinding } from '../features/coop/bindings'
import type { GuideBlock } from '../features/guide/block'
import type { HeroPickerBlock } from '../features/heroes/block'
import { HeroPickerBinding } from '../features/lobby/bindings'
import { GuideBinding as MunchopediaGuideBinding } from '../features/munchopedia/bindings'
import type { CharacterBlock } from '../features/profile/blocks/look/block'
import { CharacterBinding } from '../features/profile/composition'
import {
  GuideBinding as ShopGuideBinding,
  DialogBinding as ShopInnerDialogBinding,
  TabsBinding as ShopTabsBinding,
} from '../features/shop/bindings'
import type { ShopTabsBlock } from '../features/shop/shopTabs'
import {
  CoopBinding,
  LobbyBinding,
  MunchopediaBinding,
  ProfileBinding,
  ShopDialogBinding,
} from './bindings'
import { layer } from './block'
import { ApplicationBlock } from './definition'
import type { Model } from './model'

// NOTE: acquiring the root's graph builds no handler Layer and starts no
// Command, Subscription, or Mount, so it needs no service and runs
// synchronously. Its init, update, and view are pure, and stay usable after
// the acquisition's scope closes.
const application = Effect.runSync(
  Story.withBlock({ block: ApplicationBlock, layer }, Function.identity),
)

export const { init, update, view, subscriptions } = application

// NOTE: the whole Model a fresh game starts with, every child's field
// included. src/app/model.ts's `initialModel` holds only the root's own fields.
export const initialModel: Model = init().model

const message = toParentMessageFor(application)
const inProfile = toParentMessageFor(application, ProfileBinding)
const inLobby = toParentMessageFor(application, LobbyBinding)
const inCoop = toParentMessageFor(application, CoopBinding)
const inMunchopedia = toParentMessageFor(application, MunchopediaBinding)
const inShop = toParentMessageFor(application, ShopDialogBinding)

type ProfileMessage = BlockOfBinding<typeof ProfileBinding>['Message']['Type']
type CharacterMessage = typeof CharacterBlock.Message.Type
type LobbyMessage = BlockOfBinding<typeof LobbyBinding>['Message']['Type']
type HeroPickerMessage = typeof HeroPickerBlock.Message.Type
type MunchopediaMessage = BlockOfBinding<
  typeof MunchopediaBinding
>['Message']['Type']
type GuideMessage = typeof GuideBlock.Message.Type
type ShopMessage = BlockOfBinding<typeof ShopDialogBinding>['Message']['Type']
type DialogMessage = typeof DialogBlock.Message.Type
type ShopTabsMessage = typeof ShopTabsBlock.Message.Type

const shop = (shopMessage: ShopMessage) =>
  message(ShopDialogBinding, shopMessage)

const profile = (profileMessage: ProfileMessage) =>
  message(ProfileBinding, profileMessage)

const lobby = (lobbyMessage: LobbyMessage) =>
  message(LobbyBinding, lobbyMessage)

// NOTE: a child's Message as the root's generated envelope
// (`GotCoopMessage`, `GotShopDialogMessage`, ...), for `Story.message`,
// `update`, and the tools:
// `Child.message(CoopBinding, CoopMessage.ClickedReady())`. A record, since
// the mapper is generic and cannot be made dual. `profile` delivers a
// Profile Message, `inProfile` maps one of its children's (the tabs, the
// Look tab) to the Profile's, and `character` delivers a Look tab Message.
// `lobby` delivers a single player lobby Message, `lobbyHero` one of its
// hero picker's, and `coopHero` one of co-op's hero picker's. `shop`
// delivers a Message of Rattles' shop dialog, `shopDialog` one of the
// Dialog it stands in, `shopTabs` one of its tabs', and `shopGuide` one of
// its guide's; `munchopedia` a Munchopedia
// Message, and `munchopediaGuide` one of the guide on its Shop page. A Look tab radio group's Message is a grandchild's grandchild: a
// Block-aware Story delivers it with `Story.messageIn([ProfileBinding,
// CharacterBinding, BodyBinding], ...)`.
export const Child = {
  message,
  profile,
  inProfile,
  character: (characterMessage: CharacterMessage) =>
    profile(inProfile(CharacterBinding, characterMessage)),
  lobby,
  lobbyHero: (pickerMessage: HeroPickerMessage) =>
    lobby(inLobby(HeroPickerBinding, pickerMessage)),
  coopHero: (pickerMessage: HeroPickerMessage) =>
    message(CoopBinding, inCoop(CoopHeroPickerBinding, pickerMessage)),
  shop,
  shopDialog: (dialogMessage: DialogMessage) =>
    shop(inShop(ShopInnerDialogBinding, dialogMessage)),
  shopTabs: (tabsMessage: ShopTabsMessage) =>
    shop(inShop(ShopTabsBinding, tabsMessage)),
  shopGuide: (guideMessage: GuideMessage) =>
    shop(inShop(ShopGuideBinding, guideMessage)),
  munchopedia: (munchopediaMessage: MunchopediaMessage) =>
    message(MunchopediaBinding, munchopediaMessage),
  munchopediaGuide: (guideMessage: GuideMessage) =>
    message(
      MunchopediaBinding,
      inMunchopedia(MunchopediaGuideBinding, guideMessage),
    ),
}
