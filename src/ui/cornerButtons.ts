import { Function } from 'effect'
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'

import { BACK_ICON } from '../art/coopIcons'
import { CLOSE_ICON } from '../art/icons'

// The menus' corner buttons, close and back, that every dialog and screen
// shares.

// CORNER BUTTONS

// NOTE: an object type, not Readonly<...>, so the pipeable check matches the
// views' two signatures.
type CornerButton<Message> = {
  readonly attributes: ReadonlyArray<Attribute<Message> | ChildAttribute>
  readonly className: string
  readonly label: string
}

// NOTE: the one close button every menu dialog shares: a red pixel X on a
// 32 px face, centered in a bigger see-through button, so it looks small
// but a thumb still has a 48 px target. `className` only places it, with
// the button flush in its panel's corner so the face sits 8 px inside.
// `attributes` carry what it does: a Dialog's `closeButton`, or an OnClick
// for a screen that is not a Dialog, such as co-op's.
export const closeButtonView: {
  <Message>(h: HtmlBuilder<Message>): (self: CornerButton<Message>) => Html
  <Message>(self: CornerButton<Message>, h: HtmlBuilder<Message>): Html
} = Function.dual(
  2,
  <Message>(
    { attributes, className, label }: CornerButton<Message>,
    h: HtmlBuilder<Message>,
  ): Html =>
    h.button(
      [
        h.Type('button'),
        ...attributes,
        h.Class(`menu-close ${className}`),
        h.AriaLabel(label),
        h.AriaKeyshortcuts('Escape'),
      ],
      [faceView(CLOSE_ICON, 'menu-close-icon', h)],
    ),
)

// NOTE: the matching back button: the same 48 px target and 32 px face in a
// neutral fill, an arrow in place of the X. `extra` is for a key cap.
export const backButtonView: {
  <Message>(
    h: HtmlBuilder<Message>,
  ): (
    self: CornerButton<Message> & Readonly<{ extra?: ReadonlyArray<Html> }>,
  ) => Html
  <Message>(
    self: CornerButton<Message> & Readonly<{ extra?: ReadonlyArray<Html> }>,
    h: HtmlBuilder<Message>,
  ): Html
} = Function.dual(
  2,
  <Message>(
    {
      attributes,
      className,
      label,
      extra = [],
    }: CornerButton<Message> & Readonly<{ extra?: ReadonlyArray<Html> }>,
    h: HtmlBuilder<Message>,
  ): Html =>
    h.button(
      [
        h.Type('button'),
        ...attributes,
        h.Class(`menu-close menu-back ${className}`),
        h.AriaLabel(label),
      ],
      [faceView(BACK_ICON, 'menu-back-icon', h), ...extra],
    ),
)

const faceView = <Message>(
  icon: string,
  iconClass: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [h.Class('menu-close-face'), h.AriaHidden(true)],
    [h.span([h.Class(iconClass), h.Style({ backgroundImage: icon })])],
  )
