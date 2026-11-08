import { GuideComposition } from './composition'
import { isGuideOpen } from './model'
import { closeQuietly, goBack, open } from './steps'

// NOTE: the parent's requests. Toggle is the shop's ? key: it opens a shut
// guide and goes back from an open one.
export const inMessageUpdate = GuideComposition.makeInMessageUpdate({
  RequestedOpen: (model, { section }) => open(section)(model),

  RequestedToggle: (model, { section }) =>
    isGuideOpen(model) ? goBack(model) : open(section)(model),

  RequestedClose: model => ({ model: closeQuietly(model) }),
})
