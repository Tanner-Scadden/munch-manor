import { Function } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { pixelArtStyle } from '#art/artSize.ts'
import { BACK_ICON } from '#art/coopIcons.ts'
import { CLOSE_ICON } from '#art/icons.ts'

type ButtonBuilder<Message> = ReturnType<Html.H<Message>['button']['attr']>

type CornerButton<B> = {
  readonly button: B
  readonly className: string
  readonly label: string
}

type BackButton<B, Message> = CornerButton<B> & {
  readonly extra?: ReadonlyArray<View.Content<Message>>
}

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
