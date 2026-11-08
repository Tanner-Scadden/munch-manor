import { Function, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Model } from '../../app/model'
import type { Calling } from '../../shared/playerData'
import { badgeTierOf } from '../../world/heroes/rank'
import { PROP_ICONS } from '../heroes/callingArt'
import { badgeImage } from '../rank/rankArt'

// HTML parts the menus and overlays share: icons, key caps, and sizes as
// CSS percents. `tools/lint/duplicateHelpers.ts` fails a copy of one in a
// view, so a new shared part goes here.

// ICONS

// NOTE: a pixel icon as a background image, hidden from screen readers.
// Generic over the Message, so the root's views and co-op's both use it.
export const iconView: {
  <Message>(icon: string, h: HtmlBuilder<Message>): (className: string) => Html
  <Message>(className: string, icon: string, h: HtmlBuilder<Message>): Html
} = Function.dual(
  3,
  <Message>(className: string, icon: string, h: HtmlBuilder<Message>): Html =>
    h.span([
      h.Class(className),
      h.AriaHidden(true),
      h.Style({ backgroundImage: icon }),
    ]),
)

// CALLING PROPS

// NOTE: a calling's small prop beside a player's name and rank, in co-op's
// lobby and on its last run's scores. YOU has none, so nothing is drawn.
export const callingPropView: {
  <Message>(
    calling: Calling,
    h: HtmlBuilder<Message>,
  ): (className: string) => Html
  <Message>(className: string, calling: Calling, h: HtmlBuilder<Message>): Html
} = Function.dual(
  3,
  <Message>(
    className: string,
    calling: Calling,
    h: HtmlBuilder<Message>,
  ): Html =>
    calling === 'You'
      ? h.empty
      : h.span([
          h.Class(className),
          h.DataAttribute('calling', calling),
          h.AriaHidden(true),
          h.Style({ backgroundImage: PROP_ICONS[calling] }),
        ]),
)

// RANK BADGES

// NOTE: a rank's badge as an image, `scale` times its pixels, for the
// home menu, the Profile, and co-op's lobby.
export const rankBadgeImgView: {
  <Message>(scale: number, h: HtmlBuilder<Message>): (rank: number) => Html
  <Message>(rank: number, scale: number, h: HtmlBuilder<Message>): Html
} = Function.dual(
  3,
  <Message>(rank: number, scale: number, h: HtmlBuilder<Message>): Html =>
    Option.match(badgeImage(badgeTierOf(rank)), {
      onNone: () => h.span([h.Class('rank-badge-img')]),
      onSome: image =>
        h.img([
          h.Class('rank-badge-img'),
          h.Src(image.src),
          h.Alt(''),
          h.AriaHidden(true),
          h.Style({
            width: `${image.width * scale}px`,
            height: `${image.height * scale}px`,
          }),
        ]),
    }),
)

// NOTE: the badge with its number, a chip beside a name. Hidden from screen
// readers: the caller's label says the rank in words.
export const rankTagView: {
  <Message>(
    rank: number,
    scale: number,
    h: HtmlBuilder<Message>,
  ): (className: string) => Html
  <Message>(
    className: string,
    rank: number,
    scale: number,
    h: HtmlBuilder<Message>,
  ): Html
} = Function.dual(
  4,
  <Message>(
    className: string,
    rank: number,
    scale: number,
    h: HtmlBuilder<Message>,
  ): Html =>
    h.span(
      [
        h.Class(className),
        h.DataAttribute('tier', badgeTierOf(rank)),
        h.AriaHidden(true),
      ],
      [
        rankBadgeImgView(rank, scale, h),
        h.span([h.Class('rank-number')], [`${rank}`]),
      ],
    ),
)

// KEY CAPS

export const isKeyboard = (model: Model): boolean =>
  model.lastDevice === 'KeyboardMouse'

// NOTE: the key a button answers to, shown only to a keyboard player.
export const keyCapView: {
  <Message>(
    cap: string,
    h: HtmlBuilder<Message>,
  ): (model: Model) => ReadonlyArray<Html>
  <Message>(
    model: Model,
    cap: string,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<Html>
} = Function.dual(
  3,
  <Message>(
    model: Model,
    cap: string,
    h: HtmlBuilder<Message>,
  ): ReadonlyArray<Html> =>
    isKeyboard(model)
      ? [h.span([h.Class('home-key'), h.AriaHidden(true)], [cap])]
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
