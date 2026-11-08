import { setup } from 'foldkit/test/vitest'

import { useSpriteMode } from '../art/spriteAtlas'

setup()

// NOTE: tests draw stand-ins instead of encoding a PNG for every sprite the
// game builds as it loads. src/test/testPng.ts reads their pixels back.
useSpriteMode('StandIn')
