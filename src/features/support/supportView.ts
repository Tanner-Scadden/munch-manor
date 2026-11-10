import { Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import { COFFEE_ICON } from '../../art/icons'
import { RESTART_GRACE_MS } from '../../shared/constants'
import { Phase } from '../../world/schema/worldSchema'

// VIEW

const SUPPORT_LABEL = 'Buy Rattles a coffee: support the game'

const isEscapeShown = (model: Model): boolean =>
  Phase.isAnyOf(['Escaped'])(model.phase) && model.screenMs >= RESTART_GRACE_MS

const supportLinkView = (url: string, h: ApplicationViewBuilder): Html =>
  h.a(
    [
      h.Class('support-link'),
      h.DataAttribute('placement', 'Escaped'),
      h.Href(url),
      h.Target('_blank'),
      h.Rel('noopener noreferrer'),
      h.AriaLabel(`${SUPPORT_LABEL}. Opens in a new tab`),
    ],
    [
      h.span([
        h.Class('support-link-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: COFFEE_ICON }),
      ]),
      h.span(
        [h.Class('support-link-text')],
        [
          h.span([h.Class('support-link-line')], ['BUY RATTLES']),
          h.span([h.Class('support-link-line')], ['A COFFEE']),
        ],
      ),
    ],
  )

// NOTE: on the escape's card it waits out the restart grace like the end buttons, so a
// tap meant for the last zombie never lands on it.
export const escapeSupportView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  Option.match(model.maybeSupportUrl, {
    onNone: () => h.empty,
    onSome: url => (isEscapeShown(model) ? supportLinkView(url, h) : h.empty),
  }),
)
