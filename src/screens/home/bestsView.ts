import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import {
  CLOCK_ICON,
  KILLS_ICON,
  SKULL_ICONS,
  TROPHY_ICON,
} from '../../art/icons'
import { HomeMessage } from '../../features/home/message'
import { missionCardView } from '../../features/missions/missionCard'
import { iconView } from '../../ui/menuParts'
import { DIFFICULTIES } from '../../world/run/difficulty'
import { durationLabel } from '../../world/run/stats'
import { bestsFor } from './home'
import { homeButtonAttributes, keyBadgeView } from './homeAttributes'

// The home menu's top left: the bests badge, and the day's mission card
// under it (src/features/missions/missionCard.ts).

// BESTS

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

const bestView = (best: Best, h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('home-best')],
    [
      h.span(
        [h.Class('home-best-label')],
        [
          iconView('home-best-icon', best.icon, h),
          h.span([h.Class('sr-only')], [best.label]),
        ],
      ),
      h.span([h.Class('home-best-value')], [best.value]),
    ],
  )

// NOTE: a button of icons and big numbers, in the chosen level's color, that
// opens the Munchopedia, and nothing at all until the player has a best.
const bestsView = (model: Model, h: ApplicationViewBuilder): Html =>
  Array.match(shownBests(model), {
    onEmpty: () => h.empty,
    onNonEmpty: bests =>
      h.button(
        [
          ...homeButtonAttributes('Bests', h),
          h.Class('home-bests'),
          h.DataAttribute('difficulty', model.difficulty.chosen),
          h.AriaLabel(
            `Your bests, ${DIFFICULTIES[model.difficulty.chosen].name}: ${Array.join(
              Array.map(bests, best => `${best.label} ${best.value}`),
              ', ',
            )}. Opens the Munchopedia`,
          ),
          h.AriaHasPopup('dialog'),
          h.OnClick(HomeMessage.ClickedMunchopediaButton(), {
            propagation: 'Stop',
          }),
        ],
        [
          iconView('home-bests-level', SKULL_ICONS[model.difficulty.chosen], h),
          h.span(
            [h.Class('home-bests-list')],
            Array.map(bests, best => bestView(best, h)),
          ),
        ],
      ),
  })

// TOP LEFT

// NOTE: the bests badge over the mission card, in one column, so the card
// takes the badge's place while a new player has no best.
export const topLeftView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('home-top-left')],
    [
      bestsView(model, h),
      missionCardView(
        model,
        homeButtonAttributes('Missions', h),
        keyBadgeView(model, 'Missions', h),
        h,
      ),
    ],
  ),
)
