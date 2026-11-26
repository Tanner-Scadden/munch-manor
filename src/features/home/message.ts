import { UiSchema } from '@effect/ui'

import { TutorialChoice } from '../../shared/nameKeys'
import { Difficulty } from '../../shared/playerData'
import { ZombieKind } from '../../world/schema/entitySchema'
import { HandCard, HomeButton } from './homeSchema'

// NOTE: the home menu, the MANOR hand, the panels, and the pause MENU pill.
// Their handlers are in src/app/update/home.ts, but for those that open a
// child Block the root drives: PLAY (src/app/update/lobby.ts), CO-OP
// (src/app/update/coop.ts), and BEAT MY RUN (src/app/update/beatMyRun.ts).
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
