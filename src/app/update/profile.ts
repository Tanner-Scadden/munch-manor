import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { randomAppearance } from '../../art/appearance'
import {
  type GearTap,
  canAfford,
  gearTapOf,
  priceOf,
} from '../../domain/closet'
import { type LookPart, chooseLook as lookWith } from '../../domain/looks'
import { rollName } from '../../domain/playerName'
import { lookUnlockId, markLooksSeen, withoutFresh } from '../../domain/unlocks'
import * as Character from '../../features/profile/blocks/look/block'
import type { LookToggle } from '../../features/profile/blocks/look/lookSchema'
import type { LookOutcome } from '../../features/profile/inMessage'
import type { SettingTile } from '../../features/profile/message'
import type { ProfileTab } from '../../features/profile/model'
import { isCharacterKey, releaseAll } from '../../input/input'
import { forgetTutorial } from '../../platform/save'
import { type CosmeticKind, cosmeticIdOf } from '../../shared/playerData'
import { rankOf, totalPointsOf } from '../../world/heroes/rank'
import { ProfileBinding, ProfileDialogBinding } from '../bindings'
import { makeStep } from '../definition'
import { MenuState, menuState } from '../menuState'
import type { Model } from '../model'
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
  modelStep,
  unchanged,
  withInput,
} from './step'

// NOTE: the root's side of the Profile (src/features/profile/): opening it,
// and its OutMessages, folded in src/app/composition.ts. The root owns what
// the game reads, the name kept, the settings, the look and the Bones, so
// each OutMessage changes them here and plays its sound.

// OPENING

// NOTE: the Profile opens from the bare home menu, and from the end screens
// once their grace is past, as the character picker always did. Never in a
// run, and never over co-op or another dialog.
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

export const openProfile = (tab: ProfileTab) =>
  makeStep(model =>
    canOpenProfile(model)
      ? Update.combineSteps([
          modelStep(stepModel => withInput(seenOn(stepModel, tab), releaseAll)),
          ProfileBinding.requestOpen({ tab, name: model.playerName }),
          ProfileDialogBinding.requestOpen(),
        ])
      : unchanged,
  )

export const profileFromKey = (code: string) =>
  makeStep(() => (isCharacterKey(code) ? openProfile('Look') : unchanged))

// NOTE: closing the Profile keeps the name being typed; the Profile answers
// with KeptName.
export const keepProfileName = makeStep(() => ProfileBinding.requestKeepName())

// THE NAME

const withName = (model: Model, name: string): Model =>
  modifyFields(model, { playerName: () => name })

export const keepName = (name: string): UpdateStep =>
  modelStep(model => withName(model, name))

export const submitName =
  (name: string): UpdateStep =>
  model =>
    playSounds([uiCue('Pop')])(withName(model, name))

export const switchedTab =
  ({ tab, name }: Readonly<{ tab: ProfileTab; name: string }>): UpdateStep =>
  model =>
    playSounds([uiCue('Whoosh')])(seenOn(withName(model, name), tab))

// NOTE: a roll draws from the root's seeded generator and never lands on the
// name already showing; the Profile shows the name it lands on.
export const rollNameDice = (current: string) =>
  makeStep(model => {
    const [rngState, name] = rollName(model.cosmeticRngState, current)
    return Update.combineSteps([
      stepModel =>
        playSounds([uiCue('LootPop')])(
          modifyFields(withName(stepModel, name), {
            cosmeticRngState: () => rngState,
          }),
        ),
      ProfileBinding.informOfRolledName({ name }),
    ])
  })

// SETTINGS

const toggleShake = (model: Model): Model =>
  modifyFields(model, {
    shakeSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

const toggleCursor = (model: Model): Model =>
  modifyFields(model, {
    cursorSetting: setting => (setting === 'Bold' ? 'Thin' : 'Bold'),
  })

const toggleRumble = (model: Model): Model =>
  modifyFields(model, {
    rumbleSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

const toggleShareStats = (model: Model): Model =>
  modifyFields(model, {
    shareStats: setting => (setting === 'On' ? 'Off' : 'On'),
  })

// NOTE: each tile toggles its setting; sound, music, and full screen as
// their buttons elsewhere do.
const SETTING_TILES: Readonly<Record<SettingTile, UpdateStep>> = {
  Sound: model => unlockAudio(toggleSound(model)),
  Music: model => unlockAudio(toggleMusic(model)),
  Shake: modelStep(toggleShake),
  Cursor: modelStep(toggleCursor),
  Fullscreen: toggleFullscreen,
  Rotation: modelStep(toggleRotation),
  Rumble: modelStep(toggleRumble),
  ShareStats: modelStep(toggleShareStats),
}

export const clickedSetting = (setting: SettingTile): UpdateStep =>
  SETTING_TILES[setting]

export const resetTutorial: UpdateStep = modelStep(forgetTutorial)

export const showedLinkCode: UpdateStep = playSounds([uiCue('Whoosh')])

export const linkedDevice: UpdateStep = playSounds([uiCue('PowerUp')])

// THE LOOK TAB

const wearing = (model: Model, part: LookPart, value: string): Model =>
  modifyFields(model, {
    appearance: appearance => lookWith(appearance, part, value),
  })

const spentOn = (model: Model, kind: CosmeticKind, value: string): Model =>
  modifyFields(model, {
    rank: rank =>
      modifyFields(rank, {
        spentBones: spent =>
          spent + Option.getOrElse(priceOf(kind, value), () => 0),
      }),
    boughtCosmetics: bought => [...bought, cosmeticIdOf(kind, value)],
  })

type Pick = Readonly<{ part: LookPart; value: string }>

const tapOf = (
  model: Model,
  value: string,
  { kind, worn }: Character.Gear,
): GearTap =>
  gearTapOf(
    kind,
    value,
    worn(model.appearance),
    model.boughtCosmetics,
    rankOf(totalPointsOf(model.rank)),
  )

// NOTE: the root's part of an outcome, then the outcome told to the Profile,
// which plays the try-on, the poof, or the cue.
const lookOutcome = (
  { part, value }: Pick,
  outcome: LookOutcome,
  change: UpdateStep,
) =>
  Update.combineSteps([
    change,
    ProfileBinding.informOfLookOutcome({ part, value, outcome }),
  ])

const GEAR_TAPS: Readonly<Record<GearTap, (pick: Pick) => UpdateStep>> = {
  Stay: () => unchanged,
  Wear:
    ({ part, value }) =>
    model =>
      playSounds([uiCue('Pop')])(wearing(model, part, value)),
  Preview: () => playSounds([uiCue('Pop')]),
  Locked: () => playSounds([uiCue('Denied')]),
}

// NOTE: a pick in the Look tab. A free part is put on. An earned one is put
// on if it is owned, tried on if it is for sale (the BUY pill buys it, see
// `buyLook`), and leaves the look as it was and shakes the padlock if it is
// a gift not reached yet. Any pick ends an earlier try-on and clears the
// picked look's NEW badge.
export const chooseLook = (pick: Pick) =>
  makeStep(model =>
    Option.match(Character.gearOf(pick.part), {
      onNone: () => lookOutcome(pick, 'Wear', GEAR_TAPS.Wear(pick)),
      onSome: gear => {
        const tap = tapOf(model, pick.value, gear)
        return lookOutcome(pick, tap, stepModel =>
          GEAR_TAPS[tap](pick)(
            withoutFresh(stepModel, lookUnlockId(gear.kind, pick.value)),
          ),
        )
      },
    }),
  )

const bought =
  ({ part, value }: Pick, kind: CosmeticKind): UpdateStep =>
  model =>
    combine(wearing(spentOn(model, kind, value), part, value), [
      playSounds([uiCue('Purchase')]),
    ])

// NOTE: the BUY pill: spends the Bones on the look being tried on and keeps
// it on. Short of Bones it shakes the price and stays. Only the try-on ends
// if the look is no longer for sale, so a stale click buys nothing.
export const buyLook = (pick: Pick) =>
  makeStep(model =>
    Option.match(Character.gearOf(pick.part), {
      onNone: () => lookOutcome(pick, 'Stay', unchanged),
      onSome: gear =>
        tapOf(model, pick.value, gear) !== 'Preview'
          ? lookOutcome(pick, 'Stay', unchanged)
          : canAfford(model.rank, gear.kind, pick.value)
            ? lookOutcome(pick, 'Bought', bought(pick, gear.kind))
            : lookOutcome(pick, 'Short', playSounds([uiCue('Denied')])),
    }),
  )

export const flipLook =
  (toggle: LookToggle): UpdateStep =>
  model =>
    playSounds([uiCue('Pop')])(
      modifyFields(model, {
        appearance: appearance => Character.flipLook(appearance, toggle),
      }),
    )

export const rollLook: UpdateStep = model => {
  const [rngState, appearance] = randomAppearance(
    model.cosmeticRngState,
    model.appearance,
    model.boughtCosmetics,
    rankOf(totalPointsOf(model.rank)),
  )
  return playSounds([uiCue('LootPop')])(
    modifyFields(model, {
      cosmeticRngState: () => rngState,
      appearance: () => appearance,
    }),
  )
}
