import { Array, Function, Option } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '#app/definition.ts'
import type { Model } from '#app/model.ts'
import { pixelArtStyle } from '#art/artSize.ts'
import { PROP_ICONS } from '#art/callingArt.ts'
import { DARE_ICON_URLS, DARE_SILHOUETTE_URLS } from '#art/dareArt.ts'
import { SKULL_ICONS } from '#art/icons.ts'
import { markIcon } from '#art/markArt.ts'
import type { DareOutcome, FriendsDare } from '#domain/beatLink.ts'
import { maybeShownDareOf, unopenedThingsOf } from '#domain/beatMyRun.ts'
import { DifficultyCard } from '#domain/clientSchema.ts'
import { isOnHome } from '#domain/run.ts'
import { HomeMessage } from '#features/home/message.ts'
import { isLearned } from '#features/onboarding/onboarding.ts'
import { closeButtonView } from '#ui/cornerButtons.ts'
import { iconView } from '#ui/menuParts.ts'
import { CALLING_NAMES, DARE_NAMES } from '#world/names.ts'
import { DIFFICULTIES } from '#world/run/difficulty.ts'

export const isBeatCardShown = (model: Model): boolean =>
  isOnHome(model.phase) &&
  Option.isSome(maybeShownDareOf(model)) &&
  DifficultyCard.$is('Seen')(model.difficultyCard) &&
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

const dareLabel = (dare: FriendsDare): string =>
  `Beat my run: a friend ${OUTCOME_WORDS[dare.outcome]} on wave ${dare.wave}, ${DIFFICULTIES[dare.difficulty].name}, as the ${CALLING_NAMES[dare.hero]}, with ${dare.found.length} of the dare's things. Play their house`

const thingsView = (
  dare: FriendsDare,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Array.match(dare.found, {
    onEmpty: () => null,
    onNonEmpty: found =>
      h.span
        .class('beat-card-things')
        .attr('aria-hidden', 'true')
        .children(
          Array.map(found, thing =>
            h.span
              .class('beat-card-thing')
              .attr('title', DARE_NAMES[thing])
              .style(pixelArtStyle(DARE_ICON_URLS[thing])),
          ),
        ),
  })

const unopenedView = (
  model: Model,
  dare: FriendsDare,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Array.match(unopenedThingsOf(model, dare), {
    onEmpty: () => null,
    onNonEmpty: things =>
      h.span
        .class('beat-card-unopened')
        .children(
          ...Array.map(things, thing =>
            h.span
              .class('beat-card-thing beat-card-thing-dim')
              .attr('aria-hidden', 'true')
              .style(pixelArtStyle(DARE_SILHOUETTE_URLS[thing])),
          ),
          h.span.class('beat-card-unopened-mark').children('?'),
          h.span
            .class('sr-only')
            .children(
              `Their list can hold ${things.length === 1 ? 'a thing' : 'things'} you have not opened yet.`,
            ),
        ),
  })

const resultView = (
  model: Model,
  dare: FriendsDare,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.span
    .class('beat-card-result')
    .children(
      h.span
        .class('beat-card-stamp')
        .attr('data-outcome', dare.outcome)
        .attr('aria-hidden', 'true')
        .children(OUTCOME_STAMPS[dare.outcome]),
      iconView('beat-card-hero', PROP_ICONS[dare.hero], h),
      iconView('beat-card-skull', SKULL_ICONS[dare.difficulty], h),
      ...(dare.dareMark > 0
        ? [iconView('beat-card-mark', markIcon(dare.dareMark), h)]
        : []),
      h.span
        .class('beat-card-wave')
        .attr('aria-hidden', 'true')
        .children(`W${dare.wave}`),
      thingsView(dare, h),
      unopenedView(model, dare, h),
    )

export const beatCardView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isBeatCardShown(model)
      ? Option.match(maybeShownDareOf(model), {
          onNone: () => null,
          onSome: dare =>
            h.div.class('beat-card').children(
              h.button
                .attr('type', 'button')
                .id(BEAT_CARD_ID)
                .class('beat-card-take')
                .attr('aria-label', dareLabel(dare))
                .on('click', HomeMessage.ClickedBeatMyRunButton())
                .children(
                  h.span
                    .class('beat-card-flag')
                    .attr('aria-hidden', 'true')
                    .children('BEAT MY RUN!'),
                  resultView(model, dare, h),
                ),
              closeButtonView(
                {
                  button: h.button.on(
                    'click',
                    HomeMessage.ClickedDismissBeatMyRunButton(),
                  ),
                  className: 'beat-card-close',
                  label: "Let the friend's dare go",
                },
                h,
              ),
            ),
        })
      : null,
)
