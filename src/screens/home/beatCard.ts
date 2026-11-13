import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import { PROP_ICONS } from '../../art/callingArt'
import { DARE_ICON_URLS, DARE_SILHOUETTE_URLS } from '../../art/dareArt'
import { SKULL_ICONS } from '../../art/icons'
import { markIcon } from '../../art/markArt'
import type { DareOutcome, FriendsDare } from '../../domain/beatLink'
import { maybeShownDareOf, unopenedThingsOf } from '../../domain/beatMyRun'
import { DifficultyCard } from '../../domain/clientSchema'
import { isOnHome } from '../../domain/run'
import { HomeMessage } from '../../features/home/message'
import { isLearned } from '../../features/onboarding/onboarding'
import { closeButtonView } from '../../ui/cornerButtons'
import { iconView } from '../../ui/menuParts'
import { CALLING_NAMES, DARE_NAMES } from '../../world/names'
import { DIFFICULTIES } from '../../world/run/difficulty'

// BEAT MY RUN on the home menu (src/domain/beatMyRun.ts): a friend's SHARE
// link opened offers their dare as a card, their result in pictures (how it
// ended, the stakes, the wave, the things they found, and the things their
// list rolls from that this player has not opened). A tap takes it into the
// lobby with the picks held to the friend's; the x lets it go.

// NOTE: a player still in the tutorial's practice gate, or not yet asked
// the difficulty, plays the tutorial first: the card waits until then.
export const isBeatCardShown = (model: Model): boolean =>
  isOnHome(model.phase) &&
  Option.isSome(maybeShownDareOf(model)) &&
  DifficultyCard.isAnyOf(['Seen'])(model.difficultyCard) &&
  isLearned(model.lessons.move) &&
  isLearned(model.lessons.fire)

const BEAT_CARD_ID = 'home-beat'

const OUTCOME_STAMPS: Readonly<Record<DareOutcome, string>> = {
  Won: 'ESCAPED',
  Chicken: 'CHICKEN',
  Munched: 'MUNCHED',
}

const OUTCOME_WORDS: Readonly<Record<DareOutcome, string>> = {
  Won: 'escaped',
  Chicken: 'chickened out',
  Munched: 'got munched',
}

// NOTE: what a screen reader hears for the card's pictures.
const dareLabel = (dare: FriendsDare): string =>
  `Beat my run: a friend ${OUTCOME_WORDS[dare.outcome]} on wave ${dare.wave}, ${DIFFICULTIES[dare.difficulty].name}, as the ${CALLING_NAMES[dare.hero]}, with ${dare.found.length} of the dare's things. Play their house`

const thingsView = (dare: FriendsDare, h: ApplicationViewBuilder): Html =>
  Array.match(dare.found, {
    onEmpty: () => h.empty,
    onNonEmpty: found =>
      h.span(
        [h.Class('beat-card-things'), h.AriaHidden(true)],
        Array.map(found, thing =>
          h.span([
            h.Class('beat-card-thing'),
            h.Title(DARE_NAMES[thing]),
            h.Style({ backgroundImage: DARE_ICON_URLS[thing] }),
          ]),
        ),
      ),
  })

// NOTE: a thing the friend's list rolls from that this player has not
// opened: its silhouette with a ?, since the dare plays it anyway.
const unopenedView = (
  model: Model,
  dare: FriendsDare,
  h: ApplicationViewBuilder,
): Html =>
  Array.match(unopenedThingsOf(model, dare), {
    onEmpty: () => h.empty,
    onNonEmpty: things =>
      h.span(
        [h.Class('beat-card-unopened')],
        [
          ...Array.map(things, thing =>
            h.span([
              h.Class('beat-card-thing beat-card-thing-dim'),
              h.AriaHidden(true),
              h.Style({ backgroundImage: DARE_SILHOUETTE_URLS[thing] }),
            ]),
          ),
          h.span([h.Class('beat-card-unopened-mark')], ['?']),
          h.span(
            [h.Class('sr-only')],
            [
              `Their list can hold ${things.length === 1 ? 'a thing' : 'things'} you have not opened yet.`,
            ],
          ),
        ],
      ),
  })

const resultView = (
  model: Model,
  dare: FriendsDare,
  h: ApplicationViewBuilder,
): Html =>
  h.span(
    [h.Class('beat-card-result')],
    [
      h.span(
        [
          h.Class('beat-card-stamp'),
          h.DataAttribute('outcome', dare.outcome),
          h.AriaHidden(true),
        ],
        [OUTCOME_STAMPS[dare.outcome]],
      ),
      iconView('beat-card-hero', PROP_ICONS[dare.hero], h),
      iconView('beat-card-skull', SKULL_ICONS[dare.difficulty], h),
      ...(dare.dareMark > 0
        ? [iconView('beat-card-mark', markIcon(dare.dareMark), h)]
        : []),
      h.span(
        [h.Class('beat-card-wave'), h.AriaHidden(true)],
        [`W${dare.wave}`],
      ),
      thingsView(dare, h),
      unopenedView(model, dare, h),
    ],
  )

export const beatCardView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  isBeatCardShown(model)
    ? Option.match(maybeShownDareOf(model), {
        onNone: () => h.empty,
        onSome: dare =>
          h.div(
            [h.Class('beat-card')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Id(BEAT_CARD_ID),
                  h.Class('beat-card-take'),
                  h.AriaLabel(dareLabel(dare)),
                  h.OnClick(HomeMessage.ClickedBeatMyRunButton(), {
                    propagation: 'Stop',
                  }),
                ],
                [
                  h.span(
                    [h.Class('beat-card-flag'), h.AriaHidden(true)],
                    ['BEAT MY RUN!'],
                  ),
                  resultView(model, dare, h),
                ],
              ),
              closeButtonView(
                {
                  attributes: [
                    h.OnClick(HomeMessage.ClickedDismissBeatMyRunButton(), {
                      propagation: 'Stop',
                    }),
                  ],
                  className: 'beat-card-close',
                  label: "Let the friend's dare go",
                },
                h,
              ),
            ],
          ),
      })
    : h.empty,
)
