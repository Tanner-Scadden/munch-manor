import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import { NEWER_NEWS_ICON, OLDER_NEWS_ICON } from '../../art/icons'
import type { TabStep } from '../../input/padFocus'
import { iconView } from '../../ui/menuParts'
import { NEWS_DAYS, type NewsBullet, type NewsDay } from './changelog'
import { WhatsNewMessage } from './message'

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

// NOTE: the day's bullets scroll on their own under the arrows and the
// title, so a long day never pushes the arrows off a short screen.
// Keyed by the page, so a turned page starts at its top.
const dayView = (day: NewsDay, page: number, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Key(`news-day-${page}`), h.Class('news-day')],
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

type PageArrow = Readonly<{
  className: string
  icon: string
  ariaLabel: string
  message: WhatsNewMessage
  padPage: TabStep
  isOpen: boolean
}>

// NOTE: an arrow with no day past it stays in place, dimmed and inert, so the
// title never shifts and focus stays on it at the last day.
const pageArrowView = (arrow: PageArrow, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(`news-page news-arrow ${arrow.className}`),
      h.DataAttribute('pad-page', arrow.padPage),
      h.AriaLabel(arrow.ariaLabel),
      ...(arrow.isOpen
        ? [h.OnClick(arrow.message, { propagation: 'Stop' })]
        : [h.AriaDisabled(true)]),
    ],
    [iconView('news-arrow-icon', arrow.icon, h)],
  )

// NOTE: the day's title between its arrows, at the top where the arrows are
// always in reach. It is a live region, so a screen reader says the new
// day's title on a page turn.
const dayHeaderView = (
  day: NewsDay,
  page: number,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('news-header')],
    [
      pageArrowView(
        {
          className: 'news-newer',
          icon: NEWER_NEWS_ICON,
          ariaLabel: 'Newer news',
          message: WhatsNewMessage.ClickedNewerNewsButton(),
          padPage: 'Previous',
          isOpen: page > 0,
        },
        h,
      ),
      h.p(
        [h.Class('news-day-title'), h.AriaLive('polite')],
        [
          h.span([h.Class('news-date')], [day.date]),
          h.span([h.Class('news-title')], [day.title]),
        ],
      ),
      pageArrowView(
        {
          className: 'news-older',
          icon: OLDER_NEWS_ICON,
          ariaLabel: 'Older news',
          message: WhatsNewMessage.ClickedOlderNewsButton(),
          padPage: 'Next',
          isOpen: page < NEWS_DAYS.length - 1,
        },
        h,
      ),
    ],
  )

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
      onSome: day => [
        dayHeaderView(day, model.home.newsPage, h),
        dayView(day, model.home.newsPage, h),
      ],
    }),
    doneButton,
  ],
)
