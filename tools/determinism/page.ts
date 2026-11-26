import './globals'
import { Option, String } from 'effect'

import { answer } from './engine'
import { encodeEngineError, requestOf } from './request'

document.currentScript?.remove()

const chromeVersion = Option.getOrElse(
  Option.flatMap(String.match(/Chrome\/[\d.]+/)(navigator.userAgent), found =>
    Option.fromNullishOr(found[0]),
  ),
  () => navigator.userAgent,
)

const answered = (): string => {
  try {
    return answer(
      `chrome ${String.replace('Chrome/', '')(chromeVersion)} (V8)`,
      requestOf(new URLSearchParams(location.search)),
    )
  } catch (error) {
    return encodeEngineError({
      error: error instanceof Error ? (error.stack ?? error.message) : error,
    })
  }
}

const output = document.createElement('pre')
output.id = 'answer'
output.textContent = answered()
document.body.append(output)
