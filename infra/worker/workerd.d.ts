import type {
  WebSocket as WorkersWebSocket,
  WebSocketRequestResponsePair as WorkersPair,
} from '@cloudflare/workers-types'

declare global {
  const WebSocketPair: {
    new (): { 0: WorkersWebSocket; 1: WorkersWebSocket }
  }
  const WebSocketRequestResponsePair: {
    new (request: string, response: string): WorkersPair
  }
  interface ResponseInit {
    webSocket?: WorkersWebSocket | null
  }
}
