import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { pixelArtStyle } from '../art/artSize'
import { BACK_ICON } from '../art/coopIcons'
import { CLOSE_ICON } from '../art/icons'

// The menus' corner buttons, close and back, that every dialog and screen
// shares.

// CORNER BUTTONS

// NOTE: the button's builder, concrete so the chain stays typed: Effect
// UI's PartTarget types `attr` loosely.
type ButtonBuilder<Message> = ReturnType<Html.H<Message>['button']['attr']>

// NOTE: `button` is the button's builder with what it does already on it:
// a Dialog's `close` part (`parts.close(h.button)`), or a click for a
// screen that is not a Dialog, such as co-op's (`h.button.on('click', X)`).
// An object type, not Readonly<...>, so the pipeable check matches the
// views' two signatures.
type CornerButton<B> = {
  readonly button: B
  readonly className: string
  readonly label: string
}

type BackButton<B, Message> = CornerButton<B> & {
  readonly extra?: ReadonlyArray<View.Content<Message>>
}

// NOTE: the one close button every menu dialog shares: a red pixel X on a
// 32 px face, centered in a bigger see-through button, so it looks small
// but a thumb still has a 48 px target. `className` only places it, with
// the button flush in its panel's corner so the face sits 8 px inside.
export const closeButtonView: {
  <Message>(
    h: Html.H<Message>,
  ): (self: CornerButton<ButtonBuilder<Message>>) => View.Content<Message>
  <Message>(
    self: CornerButton<ButtonBuilder<Message>>,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  2,
  <Message>(
    { button, className, label }: CornerButton<ButtonBuilder<Message>>,
    h: Html.H<Message>,
  ): View.Content<Message> =>
    button
      .attr('type', 'button')
      .class(`menu-close ${className}`)
      .attr('aria-label', label)
      .attr('aria-keyshortcuts', 'Escape')
      .children(faceView(CLOSE_ICON, 'menu-close-icon', h)),
)

// NOTE: the matching back button: the same 48 px target and 32 px face in a
// neutral fill, an arrow in place of the X. `extra` is for a key cap.
export const backButtonView: {
  <Message>(
    h: Html.H<Message>,
  ): (
    self: BackButton<ButtonBuilder<Message>, Message>,
  ) => View.Content<Message>
  <Message>(
    self: BackButton<ButtonBuilder<Message>, Message>,
    h: Html.H<Message>,
  ): View.Content<Message>
} = Function.dual(
  2,
  <Message>(
    {
      button,
      className,
      label,
      extra = [],
    }: BackButton<ButtonBuilder<Message>, Message>,
    h: Html.H<Message>,
  ): View.Content<Message> =>
    button
      .attr('type', 'button')
      .class(`menu-close menu-back ${className}`)
      .attr('aria-label', label)
      .children(faceView(BACK_ICON, 'menu-back-icon', h), ...extra),
)

const faceView = <Message>(
  icon: string,
  iconClass: string,
  h: Html.H<Message>,
): View.Content<Message> =>
  h.span
    .class('menu-close-face')
    .attr('aria-hidden', 'true')
    .children(h.span.class(iconClass).style(pixelArtStyle(icon)))
