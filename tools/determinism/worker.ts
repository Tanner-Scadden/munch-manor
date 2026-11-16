// The harness inside workerd, the runtime of Workers and Durable Objects.
// build.ts bundles it to out/worker.js and crossEngine.ts serves it with the
// workerd binary from infra/. GET /?<request> answers with the engine's JSON.

import './globals'
import { answer } from './engine'
import { requestOf } from './request'

export default {
  fetch(request: Request): Response {
    return new Response(
      answer('workerd (V8)', requestOf(new URL(request.url).searchParams)),
      { headers: { 'content-type': 'application/json' } },
    )
  },
}
