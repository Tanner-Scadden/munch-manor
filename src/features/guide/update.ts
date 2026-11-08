import { GuideComposition } from './composition'
import { goBack, showSection } from './steps'

// NOTE: the guide's own Messages: a section button turns it, BACK shuts it
// and focuses what opened it.
export const update = GuideComposition.makeUpdate({
  ClickedSectionButton: (model, { section }) => ({
    model: showSection(section)(model),
  }),
  ClickedBackButton: goBack,
  CompletedFocusControl: model => ({ model }),
})
