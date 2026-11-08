import { Option } from 'effect'

// THE LINK

// NOTE: the tip jar's Stripe Payment Link. While it is empty the coffee
// button is drawn nowhere. Set to the https://buy.stripe.com/... link, it
// shows as the coffee by the gear in the home menu's corner (homeView.ts)
// and as a pill on Victory (supportView.ts). support.test.ts fails a
// link that is not https on buy.stripe.com.
export const SUPPORT_URL = 'https://buy.stripe.com/14A3cwe3i8xXcMX1qscs800'

const SUPPORT_HOST = 'buy.stripe.com'

export const isSupportUrl = (url: string): boolean =>
  Option.match(Option.liftThrowable(() => new URL(url))(), {
    onNone: () => false,
    onSome: parsed =>
      parsed.protocol === 'https:' &&
      parsed.hostname === SUPPORT_HOST &&
      parsed.pathname.length > 1,
  })

export const maybeSupportUrlOf = (url: string): Option.Option<string> =>
  isSupportUrl(url) ? Option.some(url) : Option.none()
