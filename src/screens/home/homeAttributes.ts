import { Function } from 'effect'
import type { Html } from 'foldkit/html'

import type {
  ApplicationAttribute,
  ApplicationViewBuilder,
} from '../../app/composition'
import type { Model } from '../../app/model'
import type { HomeButton } from '../../features/home/homeSchema'
import { HomeMessage } from '../../features/home/message'
import { keyCapView } from '../../ui/menuParts'
import { HOME_KEYS, homeButtonId } from './home'

// What every home menu button wears: its key's cap for a keyboard player,
// its id, its key, and focus for the arrow keys.

export const keyBadgeView: {
  (
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<Html>
  (
    model: Model,
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<Html>
} = Function.dual(
  3,
  (
    model: Model,
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<Html> => keyCapView(model, HOME_KEYS[button].cap, h),
)

// NOTE: what every home button shares, a link like the coffee too: its id,
// its key, and focus for the arrow keys.
export const homeFocusAttributes: {
  (
    h: ApplicationViewBuilder,
  ): (button: HomeButton) => ReadonlyArray<ApplicationAttribute>
  (
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationAttribute>
} = Function.dual(
  2,
  (
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationAttribute> => [
    h.Id(homeButtonId(button)),
    h.AriaKeyshortcuts(HOME_KEYS[button].name),
    h.OnFocus(HomeMessage.FocusedHomeButton({ button })),
    h.OnBlur(HomeMessage.BlurredHomeButton()),
  ],
)

export const homeButtonAttributes: {
  (
    h: ApplicationViewBuilder,
  ): (button: HomeButton) => ReadonlyArray<ApplicationAttribute>
  (
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationAttribute>
} = Function.dual(
  2,
  (
    button: HomeButton,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationAttribute> => [
    h.Type('button'),
    ...homeFocusAttributes(button, h),
  ],
)
