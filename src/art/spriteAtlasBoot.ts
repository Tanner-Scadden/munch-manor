import atlas from 'virtual:sprite-atlas'

import { useSpriteAtlas } from './spriteAtlas'

// NOTE: src/app/entry.ts imports this first, so the build's prebuilt sprites are
// in place before the modules that build sprites as they load. The atlas
// comes from tools/sprites/vitePlugin.ts: the generated files in a
// production build, and an empty atlas on the dev server.
useSpriteAtlas(atlas)
