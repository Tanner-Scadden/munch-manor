import { Array, Function, Option } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '#app/definition.ts'
import type { Model } from '#app/model.ts'
import { CLOCK_ICON, KILLS_ICON, SKULL_ICONS, TROPHY_ICON } from '#art/icons.ts'
import { HomeMessage } from '#features/home/message.ts'
import { missionCardView } from '#features/missions/missionCard.ts'
import { iconView } from '#ui/menuParts.ts'
import { DIFFICULTIES } from '#world/run/difficulty.ts'
import { durationLabel } from '#world/run/stats.ts'

import { bestsFor } from './home.ts'
import { homeButton, keyBadgeView } from './homeAttributes.ts'

type Best = Readonly<{ label: string; icon: string; value: string }>

const shownBests = (model: Model): ReadonlyArray<Best> => [
  ...Option.match(bestsFor(model).maybeBestEndlessWave, {
    onNone: () => [],
    onSome: wave => [
      { label: 'Best endless wave', icon: TROPHY_ICON, value: `${wave}` },
    ],
  }),
  ...Option.match(bestsFor(model).maybeFastestWinMs, {
    onNone: () => [],
    onSome: runMs => [
      { label: 'Fastest win', icon: CLOCK_ICON, value: durationLabel(runMs) },
    ],
  }),
  ...(model.bests.totalKills > 0
    ? [
        {
          label: 'Zombies splatted',
          icon: KILLS_ICON,
          value: `${model.bests.totalKills}`,
        },
      ]
    : []),
]

const bestView = (best: Best, h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('home-best')
    .children(
      h.span
        .class('home-best-label')
        .children(
          iconView('home-best-icon', best.icon, h),
          h.span.class('sr-only').children(best.label),
        ),
      h.span.class('home-best-value').children(best.value),
    )

const bestsView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Array.match(shownBests(model), {
    onEmpty: () => null,
    onNonEmpty: bests =>
      homeButton(h.button, 'Bests')
        .class('home-bests')
        .attr('data-difficulty', model.difficulty.chosen)
        .attr(
          'aria-label',
          `Your bests, ${DIFFICULTIES[model.difficulty.chosen].name}: ${Array.join(
            Array.map(bests, best => `${best.label} ${best.value}`),
            ', ',
          )}. Opens the Munchopedia`,
        )
        .attr('aria-haspopup', 'dialog')
        .on('click', HomeMessage.ClickedMunchopediaButton())
        .children(
          iconView('home-bests-level', SKULL_ICONS[model.difficulty.chosen], h),
          h.span
            .class('home-bests-list')
            .children(Array.map(bests, best => bestView(best, h))),
        ),
  })

export const topLeftView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    h.div
      .class('home-top-left')
      .children(
        bestsView(model, h),
        missionCardView(
          model,
          homeButton(h.button, 'Missions'),
          keyBadgeView(model, 'Missions', h),
          h,
        ),
      ),
)
