import { UiSchema } from '@effect/ui'

import { TutorialChoice } from '../../shared/nameKeys'
import { Difficulty } from '../../shared/playerData'
import { ZombieKind } from '../../world/schema/entitySchema'
import { HandCard, HomeButton } from './homeSchema'

export const homeCases = {
  ClickedCampaignButton: {},
  ClickedEndlessButton: {},
  ClickedPlayButton: {},
  ClickedCoopButton: {},
  ClickedCharacterButton: {},
  ClickedHowToPlayButton: {},
  ClickedSettingsButton: {},
  ClickedSupportButton: {},
  ClickedMenuButton: {},
  ClickedLeaveRunButton: {},
  ClickedStayButton: {},
  ClickedPlayTutorialButton: {},
  ClickedDifficultyCardButton: { difficulty: Difficulty },
  ClickedTutorialChoiceButton: { choice: TutorialChoice },
  FocusedHomeButton: { button: HomeButton },
  BlurredHomeButton: {},
  ClickedWhatsNewButton: {},
  ClickedMunchopediaButton: {},
  ClickedProofButton: {},
  ClickedNewEntryButton: { kind: ZombieKind },
  ClickedManorButton: {},
  ClickedBeatMyRunButton: {},
  ClickedDismissBeatMyRunButton: {},
  ClickedTurnHint: {},
  SteppedHandFocus: { card: HandCard },
}
export const HomeMessage = UiSchema.TaggedEnum(homeCases)
export type HomeMessage = typeof HomeMessage.Type
