import { Option } from 'effect'

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
