import { Effect, Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import type { Model } from '../app/model'
import { pixelArtStyle } from '../art/artSize'
import { PROP_ICONS } from '../art/callingArt'
import { PADLOCK_ICON, SKULL_OFF_ICON } from '../art/icons'
import { badgeImage } from '../art/rankArt'
import type { Calling } from '../shared/playerData'
import { badgeTierOf } from '../world/heroes/rank'

export const iconView: {
  <Message>(
    icon: string,
    h: Html.H<Message>,
  ): (className: string) => View.Content<Message>
  <Message>(
    className: string,
    icon: string,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  3,
  <Message>(
    className: string,
    icon: string,
    h: Html.H<Message>,
  ): View.Content<Message> =>
    h.span
      .class(className)
      .attr('aria-hidden', 'true')
      .style(pixelArtStyle(icon)),
)

export const skullFaceViews: {
  <Message>(
    h: Html.H<Message>,
  ): (face: {
    readonly className: string
    readonly icon: string
    readonly isLocked: boolean
  }) => ReadonlyArray<View.Content<Message>>
  <Message>(
    face: {
      readonly className: string
      readonly icon: string
      readonly isLocked: boolean
    },
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>>
} = Function.dual(
  2,
  <Message>(
    face: {
      readonly className: string
      readonly icon: string
      readonly isLocked: boolean
    },
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>> =>
    face.isLocked
      ? [
          iconView(face.className, SKULL_OFF_ICON, h),
          iconView('lock-badge', PADLOCK_ICON, h),
        ]
      : [iconView(face.className, face.icon, h)],
)

export const callingPropView: {
  <Message>(
    calling: Calling,
    h: Html.H<Message>,
  ): (className: string) => View.Content<Message> | null
  <Message>(
    className: string,
    calling: Calling,
    h: Html.H<Message>,
  ): View.Content<Message> | null
} = Function.dual(
  3,
  <Message>(
    className: string,
    calling: Calling,
    h: Html.H<Message>,
  ): View.Content<Message> | null =>
    calling === 'You'
      ? null
      : h.span
          .class(className)
          .attr('data-calling', calling)
          .attr('aria-hidden', 'true')
          .style(pixelArtStyle(PROP_ICONS[calling])),
)

export const rankBadgeImgView: {
  <Message>(
    scale: number,
    h: Html.H<Message>,
  ): (rank: number) => View.Content<Message>
  <Message>(
    rank: number,
    scale: number,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  3,
  <Message>(
    rank: number,
    scale: number,
    h: Html.H<Message>,
  ): View.Content<Message> =>
    Option.match(badgeImage(badgeTierOf(rank)), {
      onNone: () => h.span.class('rank-badge-img'),
      onSome: image =>
        h.img
          .class('rank-badge-img')
          .attr('src', image.src)
          .attr('alt', '')
          .attr('aria-hidden', 'true')
          .style({
            width: `${image.width * scale}px`,
            height: `${image.height * scale}px`,
            '--art-w': `${image.width}`,
          }),
    }),
)

export const rankTagView: {
  <Message>(
    rank: number,
    scale: number,
    h: Html.H<Message>,
  ): (className: string) => View.Content<Message>
  <Message>(
    className: string,
    rank: number,
    scale: number,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  4,
  <Message>(
    className: string,
    rank: number,
    scale: number,
    h: Html.H<Message>,
  ): View.Content<Message> =>
    h.span
      .class(className)
      .attr('data-tier', badgeTierOf(rank))
      .attr('aria-hidden', 'true')
      .children(
        rankBadgeImgView(rank, scale, h),
        h.span.class('rank-number').children(`${rank}`),
      ),
)

export const isKeyboard = (model: Model): boolean =>
  model.lastDevice === 'KeyboardMouse'

export const keyCapView: {
  <Message>(
    cap: string,
    h: Html.H<Message>,
  ): (model: Model) => ReadonlyArray<View.Content<Message>>
  <Message>(
    model: Model,
    cap: string,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>>
} = Function.dual(
  3,
  <Message>(
    model: Model,
    cap: string,
    h: Html.H<Message>,
  ): ReadonlyArray<View.Content<Message>> =>
    isKeyboard(model)
      ? [h.span.class('home-key').attr('aria-hidden', 'true').children(cap)]
      : [],
)

export const percentOf: {
  (whole: number): (part: number) => string
  (part: number, whole: number): string
} = Function.dual(
  2,
  (part: number, whole: number): string => `${(part * 100) / whole}%`,
)

export const newBadgeView = <Message>(
  h: Html.H<Message>,
): View.Content<Message> =>
  h.span.class('look-new').attr('aria-hidden', 'true').children('NEW')

export const newPipView = <Message>(
  h: Html.H<Message>,
): View.Content<Message> => h.span.class('new-pip').attr('aria-hidden', 'true')

export const focusById = (id: string): Effect.Effect<void> =>
  Effect.sync(() => {
    document.getElementById(id)?.focus()
  })

export const clickById = (id: string): Effect.Effect<void> =>
  Effect.sync(() => {
    document.getElementById(id)?.click()
  })
