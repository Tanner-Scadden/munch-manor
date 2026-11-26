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

// HTML parts the menus and overlays share: icons, key caps, and sizes as
// CSS percents. `tools/lint/duplicateHelpers.ts` fails a copy of one in a
// view, so a new shared part goes here.

// ICONS

// NOTE: a pixel icon as a background image, hidden from screen readers.
// Generic over the Message, so the root's views and co-op's both use it.
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

// NOTE: one level's skull in a row of difficulty skulls. A locked level
// stays a skull, dim, with a padlock pinned to its corner, so the row still
// reads as four rising levels. The badge is the skull's sibling, so the
// skull's own dimming never greys it.
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

// CALLING PROPS

// NOTE: a calling's small prop beside a player's name and rank, in co-op's
// lobby and on its last run's scores. YOU has none, so nothing is drawn.
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

// RANK BADGES

// NOTE: a rank's badge as an image, `scale` times its pixels, for the
// home menu, the Profile, and co-op's lobby.
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

// NOTE: the badge with its number, a chip beside a name. Hidden from screen
// readers: the caller's label says the rank in words.
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

// KEY CAPS

export const isKeyboard = (model: Model): boolean =>
  model.lastDevice === 'KeyboardMouse'

// NOTE: the key a button answers to, shown only to a keyboard player.
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

// SIZES

export const percentOf: {
  (whole: number): (part: number) => string
  (part: number, whole: number): string
} = Function.dual(
  2,
  (part: number, whole: number): string => `${(part * 100) / whole}%`,
)

// NOTE: the NEW tag on a card or option that holds something new.
export const newBadgeView = <Message>(
  h: Html.H<Message>,
): View.Content<Message> =>
  h.span.class('look-new').attr('aria-hidden', 'true').children('NEW')

// NOTE: a red dot on a button that holds something new, for the Profile's
// Look tab, the hero button on the home menu, and the character pill.
export const newPipView = <Message>(
  h: Html.H<Message>,
): View.Content<Message> => h.span.class('new-pip').attr('aria-hidden', 'true')

// ON THE PAGE

// NOTE: focus moved to, or a click made on, the element with an id, for a
// Command's body: a Command runs once its render is committed, so the
// element is on the page if the view drew it, and one not drawn is left be.
export const focusById = (id: string): Effect.Effect<void> =>
  Effect.sync(() => {
    document.getElementById(id)?.focus()
  })

export const clickById = (id: string): Effect.Effect<void> =>
  Effect.sync(() => {
    document.getElementById(id)?.click()
  })
