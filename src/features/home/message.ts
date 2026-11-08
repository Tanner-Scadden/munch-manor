import { defineMessageUnion } from 'foldkit/message'

import { TutorialChoice } from '../../shared/nameKeys'
import { Difficulty } from '../../shared/playerData'
import { ZombieKind } from '../../world/schema/entitySchema'
import { HandCard, HomeButton } from './homeSchema'

// NOTE: the home menu, the MANOR hand, the panels, and the pause MENU pill.
// Their handlers are in ./update.ts, but for those that open a child Block
// the root drives: PLAY (src/app/update/lobby.ts) and CO-OP
// (src/app/update/coop.ts).
export const homeCases = {
  ClickedCampaignButton: {},
  ClickedEndlessButton: {},
  ClickedPlayButton: {},
  ClickedCoopButton: {},
  ClickedCharacterButton: {},
  ClickedHowToPlayButton: {},
  ClickedSettingsButton: {},
  ClickedSupportButton: {},
  CompletedClickSupportLink: {},
  ClickedMenuButton: {},
  ClickedLeaveRunButton: {},
  ClickedStayButton: {},
  ClickedDifficultyCardButton: { difficulty: Difficulty },
  ClickedTutorialChoiceButton: { choice: TutorialChoice },
  FocusedHomeButton: { button: HomeButton },
  BlurredHomeButton: {},
  CompletedFocusHomeButton: {},
  CompletedFocusEndMenuButton: {},
  ClickedWhatsNewButton: {},
  ClickedMunchopediaButton: {},
  ClickedNewEntryButton: { kind: ZombieKind },
  ClickedManorButton: {},
  ClickedTurnHint: {},
  SteppedHandFocus: { card: HandCard },
  CompletedFocusHandCard: {},
}
export const HomeMessage = defineMessageUnion(homeCases)
export type HomeMessage = typeof HomeMessage.Type
