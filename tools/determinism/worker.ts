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
