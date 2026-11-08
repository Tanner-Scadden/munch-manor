import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import { Message } from '../../app/message'
import type { Model } from '../../app/model'
import { NEWS_DAYS, type NewsBullet, type NewsDay } from './changelog'

// WHAT'S NEW

const maybeShownDay = (model: Model): Option.Option<NewsDay> =>
  Array.get(NEWS_DAYS, model.home.newsPage)

export const whatsNewText = (
  model: Model,
): Readonly<{ title: string; blurb: string }> =>
  Option.match(maybeShownDay(model), {
    onNone: () => ({
      title: "What's new",
      blurb: 'Nothing yet. Check back soon.',
    }),
    onSome: day => ({
      title: "What's new",
      blurb: `${day.date}: ${day.title}`,
    }),
  })

const bulletView = (bullet: NewsBullet, h: ApplicationViewBuilder): Html =>
  h.li(
    [h.Class('news-bullet')],
    [
      h.span([h.Class('news-emoji'), h.AriaHidden(true)], [bullet.emoji]),
      h.span([h.Class('news-text')], [bullet.text]),
    ],
  )

const dayView = (day: NewsDay, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('news-day')],
    [
      ...Option.match(day.maybeIntro, {
        onNone: () => [],
        onSome: intro => [h.p([h.Class('news-intro')], [intro])],
      }),
      h.ul(
        [h.Class('news-bullets')],
        Array.map(day.bullets, bullet => bulletView(bullet, h)),
      ),
    ],
  )

const pageButtonView = (
  label: string,
  ariaLabel: string,
  message: Message,
  h: ApplicationViewBuilder,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('panel-button news-page'),
      h.AriaLabel(ariaLabel),
      h.OnClick(message, { propagation: 'Stop' }),
    ],
    [label],
  )

// NOTE: a page button that would go nowhere is left out instead of disabled,
// so every button on the panel does something when tapped.
export const whatsNewBodyView: {
  (
    doneButton: Html,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<Html>
  (
    model: Model,
    doneButton: Html,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<Html>
} = Function.dual(
  3,
  (
    model: Model,
    doneButton: Html,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<Html> => [
    ...Option.match(maybeShownDay(model), {
      onNone: () => [],
      onSome: day => [dayView(day, h)],
    }),
    h.div(
      [h.Class('panel-actions')],
      [
        ...(model.home.newsPage < NEWS_DAYS.length - 1
          ? [
              pageButtonView(
                'Older',
                'Older news',
                Message.ClickedOlderNewsButton(),
                h,
              ),
            ]
          : []),
        ...(model.home.newsPage > 0
          ? [
              pageButtonView(
                'Newer',
                'Newer news',
                Message.ClickedNewerNewsButton(),
                h,
              ),
            ]
          : []),
        doneButton,
      ],
    ),
  ],
)
