import { Option } from 'effect'
import type { Block } from 'foldkit'

import {
  ProfileBlock,
  makeComposition,
  makeOutMessageStep,
  makeRequiredFieldBinding,
  makeStep,
} from './block'
import { CharacterBlock } from './blocks/look/block'
import { linkMounts } from './linkClipboard'
import { OutMessage } from './message'
import { ProfileTabsBlock } from './model'
import { PROFILE_TABS_ID } from './profile'
import { switchTab, withFx, withoutPreview } from './steps'

// NOTE: the Profile's children: its tab strip and the Look tab. A tab
// switch keeps the name and tells the root (SwitchedTab). The Look tab's
// picks change the root's look, so each goes up as the Profile's own
// OutMessage; a pick's outcome comes back as `InformedOfLookOutcome`. A
// flip and a dice roll always land, so the Profile plays its poof or spin
// at once. BUY goes up only while a look is being tried on.

export const TabsBinding = makeRequiredFieldBinding(ProfileTabsBlock, {
  field: 'tabs',
  init: { contextToArgs: () => [{ id: PROFILE_TABS_ID }] },
}).withOutMessagePolicy({
  fold: ProfileBlock.makeOutMessageFold(ProfileTabsBlock, {
    Selected: ({ value }) => switchTab(value),
  }),
})

export const CharacterBinding = makeRequiredFieldBinding(CharacterBlock, {
  field: 'character',
}).withOutMessagePolicy({
  fold: ProfileBlock.makeOutMessageFold(CharacterBlock, {
    ChoseLook: ({ part, value }) =>
      makeOutMessageStep(() => OutMessage.ChoseLook({ part, value })),
    FlippedLook: ({ toggle }) =>
      makeStep(model => ({
        model: withFx(withoutPreview(model), 'Poof'),
        outMessage: OutMessage.FlippedLook({ toggle }),
      })),
    RolledDice: () =>
      makeStep(model => ({
        model: withFx(withoutPreview(model), 'Spin'),
        outMessage: OutMessage.RolledLookDice(),
      })),
    ClickedBuy: () =>
      makeStep(model =>
        Option.match(model.maybePreview, {
          onNone: () => ({ model }),
          onSome: ({ part, value }) => ({
            model,
            outMessage: OutMessage.ClickedBuyLook({ part, value }),
          }),
        }),
      ),
  }),
})

export const ProfileComposition = makeComposition({
  bindings: [TabsBinding, CharacterBinding],
  mounts: linkMounts,
})
export type ProfileViewBuilder = Block.ViewBuilderFor<typeof ProfileComposition>
