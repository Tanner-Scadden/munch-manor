import { Array, Effect, Option } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  EVERY_EXIT_OPEN,
  LEARNED_ALL,
  OPEN_BREAK,
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  listFromEnv,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

type Scene = Readonly<{ name: string; query: (house: number) => string }>

const WAVE = `${LEARNED_ALL}&wave=5&start=wave&elapsed=6000&god&crowd=12&${EVERY_EXIT_OPEN}`

const SEAMS: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'kitchen-seam', query: `${OPEN_BREAK}&px=100&py=30` },
  { name: 'kitchen-in', query: `${OPEN_BREAK}&px=100&py=-40` },
  { name: 'west-seam', query: `${OPEN_BREAK}&px=20&py=110` },
  { name: 'west-in', query: `${OPEN_BREAK}&px=-30&py=110` },
  { name: 'east-seam', query: `${OPEN_BREAK}&px=340&py=90` },
  { name: 'east-in', query: `${OPEN_BREAK}&px=390&py=90` },
  { name: 'far-seam', query: `${OPEN_BREAK}&px=670&py=90` },
  { name: 'dining-north', query: `${OPEN_BREAK}&px=270&py=40` },
  { name: 'dining-south', query: `${OPEN_BREAK}&px=70&py=190` },
  { name: 'dining-east', query: `${OPEN_BREAK}&px=330&py=180` },
  { name: 'west-doors', query: `${OPEN_BREAK}&px=-120&py=80` },
  { name: 'west-south', query: `${OPEN_BREAK}&px=-240&py=190` },
  { name: 'east-doors', query: `${OPEN_BREAK}&px=520&py=40` },
  { name: 'east-south', query: `${OPEN_BREAK}&px=540&py=150` },
  { name: 'far-doors', query: `${OPEN_BREAK}&px=820&py=40` },
  { name: 'far-south', query: `${OPEN_BREAK}&px=860&py=150` },
  { name: 'wave-north', query: `${WAVE}&px=270&py=60&freeze=40` },
  { name: 'wave-west', query: `${WAVE}&px=-120&py=60&freeze=40` },
]

const ROSE_SPOTS: ReadonlyArray<string> = [
  'px=592&py=60',
  'px=912&py=60',
  'px=-88&py=100',
  'px=-88&py=100',
  'px=912&py=60',
  'px=592&py=60',
]

const FRONT_ROWS: ReadonlyArray<
  Readonly<{ room: string; xs: ReadonlyArray<number>; py: number }>
> = [
  { room: 'dining', xs: [60, 180, 300], py: 185 },
  { room: 'west', xs: [-270, -160, -50], py: 185 },
  { room: 'east', xs: [410, 520, 630], py: 145 },
  { room: 'far', xs: [730, 840, 950], py: 145 },
]

const FRONT_WALLS: ReadonlyArray<Scene> = [
  ...Array.flatMap(FRONT_ROWS, ({ room, xs, py }) =>
    Array.map(xs, (px, at) => ({
      name: `front-${room}-${at}`,
      query: () => `${OPEN_BREAK}&px=${px}&py=${py}`,
    })),
  ),
  { name: 'side-door-west', query: () => `${OPEN_BREAK}&px=40&py=40` },
  { name: 'side-door-east', query: () => `${OPEN_BREAK}&px=320&py=180` },
]

const CORNERS: ReadonlyArray<Readonly<{ name: string; spot: string }>> = [
  { name: 'kitchen-w', spot: 'px=30&py=-25' },
  { name: 'kitchen-e', spot: 'px=165&py=-25' },
  { name: 'dining-w', spot: 'px=35&py=185' },
  { name: 'dining-e', spot: 'px=325&py=185' },
  { name: 'west-w', spot: 'px=-285&py=185' },
  { name: 'west-e', spot: 'px=-45&py=185' },
  { name: 'east-w', spot: 'px=395&py=145' },
  { name: 'east-e', spot: 'px=645&py=145' },
  { name: 'far-w', spot: 'px=715&py=145' },
  { name: 'far-e', spot: 'px=965&py=145' },
]

const SHELF_SPOTS: ReadonlyArray<Readonly<{ library: string; near: string }>> =
  [
    { library: 'px=400&py=160', near: 'px=320&py=160' },
    { library: 'px=720&py=160', near: 'px=640&py=160' },
    { library: 'px=-40&py=200', near: 'px=40&py=200' },
    { library: 'px=-40&py=200', near: 'px=40&py=200' },
    { library: 'px=720&py=160', near: 'px=640&py=160' },
    { library: 'px=400&py=160', near: 'px=320&py=160' },
  ]

const SHUT_BREAK = `${LEARNED_ALL}&wave=3&break=open&openexits=Kitchen,West,East,Far`

const shelfScene = (
  name: string,
  isOpen: boolean,
  side: 'library' | 'near',
): Scene => ({
  name,
  query: house =>
    `${isOpen ? OPEN_BREAK : SHUT_BREAK}&${Option.match(
      Array.get(SHELF_SPOTS, house),
      { onNone: () => 'px=400&py=160', onSome: spots => spots[side] },
    )}`,
})

const NORTH_WALLS: ReadonlyArray<Readonly<{ name: string; spot: string }>> = [
  { name: 'kitchen-near', spot: 'px=100&py=-110' },
  { name: 'kitchen-far', spot: 'px=100&py=-20' },
  { name: 'dining-near', spot: 'px=270&py=40' },
  { name: 'dining-far', spot: 'px=270&py=170' },
  { name: 'dining-door', spot: 'px=70&py=40' },
  { name: 'west-near', spot: 'px=-150&py=80' },
  { name: 'west-far', spot: 'px=-150&py=190' },
  { name: 'east-near', spot: 'px=500&py=40' },
  { name: 'east-far', spot: 'px=500&py=150' },
  { name: 'far-near', spot: 'px=830&py=40' },
  { name: 'far-far', spot: 'px=830&py=150' },
]

const ROOM_TOPS: ReadonlyArray<Readonly<{ name: string; spot: string }>> = [
  { name: 'parlour-wall', spot: 'px=-220&py=90' },
  { name: 'parlour-door', spot: 'px=-100&py=90' },
  { name: 'dining-wall', spot: 'px=200&py=50' },
  { name: 'dining-door', spot: 'px=70&py=50' },
  { name: 'kitchen-wall', spot: 'px=60&py=-100' },
  { name: 'kitchen-door', spot: 'px=130&py=-100' },
  { name: 'library-wall', spot: 'px=610&py=50' },
  { name: 'library-door', spot: 'px=510&py=50' },
  { name: 'cellar-wall', spot: 'px=850&py=50&tool=Bulb&firedms=200' },
  { name: 'cellar-door', spot: 'px=740&py=50&tool=Bulb&firedms=200' },
  { name: 'parlour-edge', spot: 'px=-140&py=125' },
  { name: 'dining-edge', spot: 'px=180&py=85' },
  { name: 'dining-edge-east', spot: 'px=300&py=85' },
  { name: 'kitchen-edge', spot: 'px=110&py=-65' },
  { name: 'library-edge', spot: 'px=540&py=85' },
  { name: 'cellar-edge', spot: 'px=780&py=85&tool=Bulb&firedms=200' },
  { name: 'dining-left', spot: 'px=150&py=60' },
  { name: 'dining-right', spot: 'px=220&py=60' },
  { name: 'parlour-left', spot: 'px=-150&py=95' },
  { name: 'parlour-right', spot: 'px=-250&py=95' },
  { name: 'kitchen-left', spot: 'px=150&py=-95' },
  { name: 'kitchen-right', spot: 'px=40&py=-95' },
]

const ALL_SHUT = `${LEARNED_ALL}&wave=3&break=open`

const SCENES: ReadonlyArray<Scene> = [
  ...Array.map(SEAMS, ({ name, query }) => ({ name, query: () => query })),
  {
    name: 'library-rose',
    query: house =>
      `${OPEN_BREAK}&${Array.get(ROSE_SPOTS, house).pipe(Option.getOrElse(() => 'px=592&py=60'))}`,
  },
  { name: 'dining-winch', query: () => `${OPEN_BREAK}&px=50&py=120` },
  ...FRONT_WALLS,
  ...Array.map(CORNERS, ({ name, spot }) => ({
    name: `corner-${name}`,
    query: () => `${OPEN_BREAK}&${spot}`,
  })),
  shelfScene('shelf-shut', false, 'library'),
  shelfScene('shelf-shut-near', false, 'near'),
  shelfScene('shelf-open', true, 'library'),
  shelfScene('shelf-open-near', true, 'near'),
  ...Array.map(NORTH_WALLS, ({ name, spot }) => ({
    name: `north-${name}`,
    query: () => `${OPEN_BREAK}&${spot}`,
  })),
  { name: 'north-dining-shut', query: () => `${ALL_SHUT}&px=70&py=40` },
  ...Array.map(ROOM_TOPS, ({ name, spot }) => ({
    name: `top-${name}`,
    query: () => `${OPEN_BREAK}&${spot}`,
  })),
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const picked = yield* listFromEnv('HOUSES')
    const houses = Option.match(picked, {
      onNone: () => Array.range(0, 5),
      onSome: Array.map(Number),
    })
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'nohud', 'tick=20'])
    for (const viewport of viewports) {
      for (const house of houses) {
        for (const scene of SCENES) {
          if (!(yield* isPickedScene(scene.name))) {
            continue
          }
          const page = yield* pages.open(
            viewport,
            harnessQuery(
              `${scene.query(house)}&house=${house}`,
              deviceQuery(viewport),
            ),
          )
          yield* settleAnimations(page)
          yield* shot(
            page,
            `walls-${tag}-${viewport.name}-h${house}-${scene.name}`,
          )
          pages.release(page)
        }
      }
    }
  }),
)
