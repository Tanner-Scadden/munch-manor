import { Array, Function, Option } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '#app/definition.ts'
import type { Model } from '#app/model.ts'
import { NEWER_NEWS_ICON, OLDER_NEWS_ICON } from '#art/icons.ts'
import type { TabStep } from '#input/padFocus.ts'
import { iconView } from '#ui/menuParts.ts'

import { NEWS_DAYS, type NewsBullet, type NewsDay } from './changelog.ts'
import { WhatsNewMessage } from './message.ts'

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

const bulletView = (
  bullet: NewsBullet,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.li
    .class('news-bullet')
    .children(
      h.span
        .class('news-emoji')
        .attr('aria-hidden', 'true')
        .children(bullet.emoji),
      h.span.class('news-text').children(bullet.text),
    )

const dayView = (
  day: NewsDay,
  page: number,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div
    .key(`news-day-${page}`)
    .class('news-day')
    .children(
      ...Option.match(day.maybeIntro, {
        onNone: () => [],
        onSome: intro => [h.p.class('news-intro').children(intro)],
      }),
      h.ul
        .class('news-bullets')
        .children(Array.map(day.bullets, bullet => bulletView(bullet, h))),
    )

type PageArrow = Readonly<{
  className: string
  icon: string
  ariaLabel: string
  message: WhatsNewMessage
  padPage: TabStep
  isOpen: boolean
}>

const pageArrowView = (
  arrow: PageArrow,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.button
    .attr('type', 'button')
    .class(`news-page news-arrow ${arrow.className}`)
    .attr('data-pad-page', arrow.padPage)
    .attr('aria-label', arrow.ariaLabel)
    .attr('aria-disabled', arrow.isOpen ? undefined : 'true')
    .on('click', () => (arrow.isOpen ? arrow.message : undefined))
    .children(iconView('news-arrow-icon', arrow.icon, h))

const dayHeaderView = (
  day: NewsDay,
  page: number,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div.class('news-header').children(
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
    h.p
      .class('news-day-title')
      .attr('aria-live', 'polite')
      .children(
        h.span.class('news-date').children(day.date),
        h.span.class('news-title').children(day.title),
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
  )

export const whatsNewBodyView: {
  (
    doneButton: ApplicationHtml,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<ApplicationHtml>
  (
    model: Model,
    doneButton: ApplicationHtml,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(
  3,
  (
    model: Model,
    doneButton: ApplicationHtml,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml> => [
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
