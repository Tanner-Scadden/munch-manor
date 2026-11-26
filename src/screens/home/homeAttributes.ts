import { Function } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '#app/definition.ts'
import type { Model } from '#app/model.ts'
import type { HomeButton } from '#features/home/homeSchema.ts'
import { HomeMessage } from '#features/home/message.ts'
import { keyCapView } from '#ui/menuParts.ts'

import { HOME_KEYS, homeButtonId } from './home.ts'

export const keyBadgeView: {
  (
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<ApplicationHtml>
  (
    model: Model,
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(
  3,
  (
    model: Model,
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml> =>
    keyCapView(model, HOME_KEYS[button].cap, h),
)

type HomeButtonBuilder = ReturnType<ApplicationViewBuilder['button']['attr']>

export const homeFocusAttrs = (
  button: HomeButton,
): Readonly<Record<string, string>> => ({
  id: homeButtonId(button),
  'aria-keyshortcuts': HOME_KEYS[button].name,
})

export const homeButton: {
  (button: HomeButton): (b: HomeButtonBuilder) => HomeButtonBuilder
  (b: HomeButtonBuilder, button: HomeButton): HomeButtonBuilder
} = Function.dual(
  2,
  (b: HomeButtonBuilder, button: HomeButton): HomeButtonBuilder =>
    b
      .attr('type', 'button')
      .attrs(homeFocusAttrs(button))
      .on('focus', HomeMessage.FocusedHomeButton({ button }))
      .on('blur', HomeMessage.BlurredHomeButton()),
)
