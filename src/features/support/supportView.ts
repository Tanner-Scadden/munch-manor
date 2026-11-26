import { Function, Option } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '#app/definition.ts'
import type { Model } from '#app/model.ts'
import { pixelArtStyle } from '#art/artSize.ts'
import { COFFEE_ICON } from '#art/icons.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'
import { Phase } from '#world/schema/worldSchema.ts'

const SUPPORT_LABEL = 'Buy Rattles a coffee: support the game'

const isEscapeShown = (model: Model): boolean =>
  Phase.isAnyOf(['Escaped'])(model.phase) && model.screenMs >= RESTART_GRACE_MS

const supportLinkView = (
  url: string,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.a
    .class('support-link')
    .attr('data-placement', 'Escaped')
    .attr('href', url)
    .attr('target', '_blank')
    .attr('rel', 'noopener noreferrer')
    .attr('aria-label', `${SUPPORT_LABEL}. Opens in a new tab`)
    .children(
      h.span
        .class('support-link-icon')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(COFFEE_ICON)),
      h.span
        .class('support-link-text')
        .children(
          h.span.class('support-link-line').children('BUY RATTLES'),
          h.span.class('support-link-line').children('A COFFEE'),
        ),
    )

export const escapeSupportView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    Option.match(model.release.maybeSupportUrl, {
      onNone: () => null,
      onSome: url => (isEscapeShown(model) ? supportLinkView(url, h) : null),
    }),
)
