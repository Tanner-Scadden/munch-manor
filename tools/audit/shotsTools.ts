import { Array, Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

type Scene = Readonly<{ name: string; query: string }>

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,displayCase'
const OPEN = 'openexits=Kitchen,West,East,Far,Secret'
const WAVE = `${LEARNED}&wave=3&start=wave&elapsed=6000&${OPEN}`

type Tool = Readonly<{
  id: string
  at: readonly [number, number]
  off: readonly [number, number]
  firedms: number
  crowd: string
}>

const TOOLS: ReadonlyArray<Tool> = [
  {
    id: 'Gramophone',
    at: [-215, 105],
    off: [-180, 140],
    firedms: 2500,
    crowd: 'crowd=8&crowdx=-320&crowdy=40',
  },
  {
    id: 'NorthStack',
    at: [535, 75],
    off: [500, 110],
    firedms: 300,
    crowd: 'crowd=6&crowdx=360',
  },
  {
    id: 'SouthStack',
    at: [495, 125],
    off: [460, 150],
    firedms: 300,
    crowd: 'crowd=6&crowdx=360',
  },
  {
    id: 'Shelf',
    at: [355, 140],
    off: [320, 160],
    firedms: 150,
    crowd: 'crowd=6&crowdx=360',
  },
  {
    id: 'Barrels',
    at: [855, 105],
    off: [800, 100],
    firedms: 100,
    crowd: 'crowd=6&crowdx=680',
  },
  {
    id: 'Bulb',
    at: [845, 75],
    off: [810, 110],
    firedms: 500,
    crowd: 'crowd=6&crowdx=680',
  },
  {
    id: 'SoupPot',
    at: [75, -95],
    off: [120, -60],
    firedms: 600,
    crowd: 'crowd=6&crowdy=-140',
  },
]

const toolScenes = (tool: Tool): ReadonlyArray<Scene> => {
  const base = `${WAVE}&tool=${tool.id}`
  const [ax, ay] = tool.at
  const [ox, oy] = tool.off
  return [
    { name: `${tool.id}-idle`, query: `${base}&px=${ox}&py=${oy}` },
    {
      name: `${tool.id}-worked`,
      query: `${base}&worked=0.5&px=${ax}&py=${ay}`,
    },
    {
      name: `${tool.id}-firing`,
      query: `${base}&firedms=${tool.firedms}&${tool.crowd}&px=${ox}&py=${oy}`,
    },
  ]
}

const CELLAR = `${LEARNED}&wave=3&start=wave&elapsed=6000&${OPEN}&crowd=8&crowdx=680&px=915&py=119`

const SCENES: ReadonlyArray<Scene> = [
  ...Array.flatMap(TOOLS, toolScenes),
  { name: 'cellar-dark', query: CELLAR },
  { name: 'cellar-lit', query: `${CELLAR}&tool=Bulb&firedms=500` },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=20'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        yield* shot(page, `tools-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
