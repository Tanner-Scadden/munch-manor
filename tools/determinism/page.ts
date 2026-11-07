// The harness in a browser. build.ts bundles it as a classic script inlined
// into out/page.html, so Chrome can run it from a file URL. It reads the
// request from the page's query, runs at once while the page loads, and
// writes the answer into the page, which `chrome --headless --dump-dom`
// prints after load. The script removes itself first, so the dump is only
// the answer.

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
