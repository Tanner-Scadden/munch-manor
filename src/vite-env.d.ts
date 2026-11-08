/// <reference types="vite/client" />

declare const __BUILD_ID__: string

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_COOP?: string
  readonly VITE_ROOM_LINK_BASE?: string
}

declare module 'virtual:sprite-atlas' {
  const atlas: import('./art/spriteAtlas').SpriteAtlas
  export default atlas
}
