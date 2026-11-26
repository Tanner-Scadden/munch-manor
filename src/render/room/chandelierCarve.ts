import type { Array } from 'effect'

import {
  type CarvePart,
  type CarvedModel,
  type PixelView,
  carve,
  pixelViewOfShapes,
} from '../../art/carve'
import {
  CHAIN_COLOR,
  CHAIN_DARK_COLOR,
  CHANDELIER_SHAPES,
  CRYSTAL_COLOR,
  CRYSTAL_LIGHT_COLOR,
  type ChandelierState,
  STREAMER_COLOR,
} from './diningArt'
import {
  CANDLE_COLOR,
  FLAME_COLOR,
  FLAME_TIP_COLOR,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  GOLD_LIGHT_COLOR,
  ZOMBIE_SKIN_COLOR,
} from './roomPalette'

const HAND_SHADE_COLOR = '#5a8a3a'

const PALETTE = {
  c: CHAIN_COLOR,
  k: CHAIN_DARK_COLOR,
  G: GOLD_COLOR,
  L: GOLD_LIGHT_COLOR,
  g: GOLD_DARK_COLOR,
  w: CANDLE_COLOR,
  F: FLAME_COLOR,
  T: FLAME_TIP_COLOR,
  C: CRYSTAL_COLOR,
  W: CRYSTAL_LIGHT_COLOR,
  S: STREAMER_COLOR,
  h: HAND_SHADE_COLOR,
  Z: ZOMBIE_SKIN_COLOR,
}

const view = (rows: ReadonlyArray<string>): PixelView => ({
  rows,
  palette: PALETTE,
})

export type CarvedShowpiece = Readonly<{
  model: CarvedModel
  left: number
  foot: number
  rise: number
}>

const HUNG_BOX = { left: -13, top: -54, width: 27, height: 54 }

const HUNG_PARTS: Array.NonEmptyReadonlyArray<CarvePart> = [
  {
    name: 'chain',
    left: 12,
    rise: 3,
    near: 3,
    top: view(['kck']),
    side: view([
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
      '.',
      'c',
      'c',
      'k',
    ]),
  },
  {
    name: 'hubTop',
    left: 11,
    rise: 33,
    near: 1,
    top: view(['.GGG.', 'GGGGG', 'GGGGG', 'GGGGG', '.GGG.']),
    side: view(['G....', '.G...', '..G..', '...G.', '....G']),
  },
  {
    name: 'hubBottom',
    left: 11,
    rise: 34,
    near: 1,
    top: view(['..G..', '.GGG.', 'GGGGG', '.GGG.', '..G..']),
    side: view(['G....', '.G...', '..G..', '...G.', '....G']),
  },
  {
    name: 'stem',
    left: 12,
    rise: 36,
    near: 2,
    top: view(['LGG', 'LGG', 'LGG']),
    side: view(['G..', 'GG.', 'GGG', 'GGG', 'GGG', '.GG', '..G']),
  },
  {
    name: 'neck',
    left: 13,
    rise: 42,
    near: 3,
    top: view(['g']),
    side: view(['g', 'g', 'g', 'g']),
  },
  {
    name: 'cup0',
    left: 24,
    rise: 44,
    near: 2,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'cup1',
    left: 20,
    rise: 44,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'cup2',
    left: 12,
    rise: 45,
    top: view(['.G.', 'GGG']),
    side: view(['G.', '.G']),
  },
  {
    name: 'cup3',
    left: 4,
    rise: 44,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'cup4',
    rise: 44,
    near: 2,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'cup5',
    left: 4,
    rise: 44,
    near: 4,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'cup6',
    left: 12,
    rise: 44,
    near: 5,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'cup7',
    left: 20,
    rise: 44,
    near: 4,
    top: view(['.G.', 'GGG', '.G.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'candles',
    left: 1,
    rise: 39,
    top: view([
      '............T............',
      '....T...............T....',
      '.........................',
      'T.......................T',
      '.........................',
      '....T...............T....',
      '............T............',
    ]),
    side: view([
      'TT.T.TT',
      'FF.F.FF',
      'ww.w.ww',
      'ww.w.ww',
      'ww.w.ww',
      'ww.w.ww',
    ]),
  },
  {
    name: 'ring',
    left: 1,
    rise: 46,
    top: view([
      '......gggggggggggggg......',
      '..ggggg............ggggg..',
      'ggg....................ggg',
      'GG......................GG',
      'GGGG..................GGGG',
      '..GGGGG............GGGGG..',
      '......GGGGGGGGGGGGGG......',
    ]),
    side: view(['GGGGggg']),
  },
  {
    name: 'spokes',
    left: 5,
    rise: 45,
    near: 3,
    top: view(['ggggggg...ggggggg']),
    side: view(['g']),
  },
  {
    name: 'bowl',
    left: 11,
    rise: 44,
    near: 1,
    top: view(['.LGG.', 'GLGGG', 'GLGGG', 'GLGGG', '.LGG.']),
    side: view(['G....', 'GG...', '.GG..', '..GG.', '...GG', '....G']),
  },
  {
    name: 'bowlFoot',
    left: 11,
    rise: 47,
    near: 2,
    top: view(['.GGG.', 'GGGGG', '.GGG.']),
    side: view(['G..', '.G.', '..G']),
  },
  {
    name: 'crystal0',
    left: 3,
    rise: 47,
    top: view(['C', 'C', 'C']),
    side: view(['CC.', '.C.', '.WC']),
  },
  {
    name: 'crystal1',
    left: 6,
    rise: 48,
    top: view(['C', 'C', 'C']),
    side: view(['CC.', '.C.', '.WC']),
  },
  {
    name: 'crystal2',
    left: 9,
    rise: 46,
    top: view(['C', 'C']),
    side: view(['C.', 'C.', 'WC']),
  },
  {
    name: 'crystal3',
    left: 12,
    rise: 47,
    top: view(['C', 'C']),
    side: view(['C.', 'C.', 'WC']),
  },
  {
    name: 'crystal4',
    left: 15,
    rise: 46,
    top: view(['C', 'C']),
    side: view(['C.', 'C.', 'WC']),
  },
  {
    name: 'crystal5',
    left: 18,
    rise: 47,
    top: view(['C', 'C']),
    side: view(['C.', 'C.', 'WC']),
  },
  {
    name: 'crystal6',
    left: 21,
    rise: 47,
    top: view(['C', 'C', 'C']),
    side: view(['CC.', '.C.', '.WC']),
  },
  {
    name: 'crystal7',
    left: 24,
    rise: 49,
    near: 1,
    top: view(['C', 'C', 'C']),
    side: view(['CC.', '.C.', '.WC']),
  },
  {
    name: 'drop',
    left: 13,
    rise: 47,
    top: view(['C']),
    side: view(['C', 'C', 'C', 'W']),
  },
  {
    name: 'streamer',
    left: 22,
    rise: 47,
    near: 1,
    top: view(['SS']),
    side: view(['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S']),
  },
]

const FALLEN_FRONT = view([
  '..............CWccc................',
  '...............kkkkcckk...CW.......',
  '.....CW........kkkkcckkcc..........',
  '...........cc..kkkk....cc..........',
  '...........cgggggggggggGGkk........',
  '........gg..gkkccggggggGGkgcc......',
  'CW....ggggwwggGLLGGGgggg..gcc......',
  '.....ggggggggggGGGGGgggg.........CW',
  '....ggggggggggGGGGGG...............',
  '...wGggggg.gggGGGGGG.......w.....Z.',
  '...wGGGGG.....GGGGGGggggg..w..hZZZ.',
  '...wGGGGG.....GGGGGGggggg..w..ZZZZ.',
  '.....GGGGT................GGGGZZZZZ',
  '..CW..GGGFGGGGLLLGGGG.....GGGG...ZZ',
  '........GwGGGGGGGGGGGGGGwwGG.......',
  '.........w..GGGGGGGGGGGG...........',
  '.........w....................CW...',
  '..........................SSSSSS...',
  '.........CW....................SSS.',
  '.....................CW............',
  '...................................',
  '..................CW...............',
])

const FALLEN_PARTS: Array.NonEmptyReadonlyArray<CarvePart> = [
  {
    name: 'ring',
    left: 4,
    rise: 20,
    near: 6,
    top: view([
      '........gggggggggggGG.....',
      '....gg................g...',
      '..ggg...gggggggggggg......',
      '.gg..gggg.................',
      'gggggg.ggg................',
      'Gggg......................',
      'GGGGG...........ggggg.....',
      '.G........................',
      '..GGG.................GGGG',
      '....G.GGGGLLLGGGG.....GG..',
      '........GGGGGGGGGGGG......',
    ]),
    side: view(['GGGGggggggG', 'GGGGggggggG']),
  },
  {
    name: 'flat',
    rise: 21,
    top: view([
      '..............CW...................',
      '..........................CW.......',
      '.....CW............................',
      '...................................',
      '...................................',
      '...................................',
      'CW........www......................',
      '.................................CW',
      '...................................',
      '...w.......................w.......',
      '...w.......................w.......',
      '...w.......................w.......',
      '......www..........................',
      '..CW...............................',
      '......................wwww.........',
      '...................................',
      '..............................CW...',
      '..........................SSSSSS...',
      '.........CW....................SSS.',
      '.....................CW............',
      '...................................',
      '..................CW...............',
    ]),
    side: view(['W.WSSW.wWwwww.Ww...WWW']),
  },
  {
    name: 'chain',
    left: 11,
    rise: 20,
    near: 15,
    top: view([
      '.....ccc..........',
      '....kkkkcckk......',
      '....kkkk....cc....',
      'cc....kk..........',
      '..............kk..',
      '..kkcc..........cc',
    ]),
    side: view(['ckkckc', 'ckkckc']),
  },
  {
    name: 'hub',
    left: 14,
    rise: 19,
    near: 10,
    top: view(['GLLGGG', 'gGGGGG', 'GGGGGG', 'GGGGGG']),
    side: view(['GGGG', 'GGGG', 'GGGG']),
  },
  {
    name: 'hand',
    left: 30,
    rise: 20,
    near: 8,
    top: view(['...Z.', 'hZZZ.', 'ZZZ..', '...ZZ']),
    side: view(['ZZZZ', 'ZZZZ']),
  },
  {
    name: 'candle',
    left: 9,
    rise: 17,
    near: 5,
    top: view(['T']),
    side: view(['T', 'F', 'w', 'w', 'w']),
  },
]

const carvedOf = (state: ChandelierState): CarvedShowpiece =>
  state === 'Hung'
    ? {
        model: carve({
          views: {
            front: pixelViewOfShapes({
              shapes: CHANDELIER_SHAPES.Hung,
              box: HUNG_BOX,
            }),
            parts: HUNG_PARTS,
          },
          lean: 1,
        }),
        left: HUNG_BOX.left,
        foot: 2,
        rise: HUNG_BOX.height + 8,
      }
    : {
        model: carve({
          views: { front: FALLEN_FRONT, parts: FALLEN_PARTS },
          lean: 1,
        }),
        left: -17,
        foot: 14,
        rise: 22,
      }

const carved = new Map<ChandelierState, CarvedShowpiece>()

export const carvedChandelierOf = (state: ChandelierState): CarvedShowpiece => {
  const known = carved.get(state)
  if (known !== undefined) {
    return known
  }
  const piece = carvedOf(state)
  carved.set(state, piece)
  return piece
}
