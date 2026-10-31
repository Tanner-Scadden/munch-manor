// NOTE: what the harness page keeps: the scene's settings, read from its
// query, and the page's own state across scenes. `window.__loadScene` swaps
// in another scene without reloading the page, so entry.ts holds one
// HarnessPage and hands it, or its settings, to what reads them.

import type { Option } from 'effect'

import type { Model } from '@game/model'

import type { HarnessConfig } from './config'

const PLAYER_X = 160
const PLAYER_Y = 90

// NOTE: a scene's settings: its config, with what the harness derives from
// it once. `freezeAfter` is the frame a frozen scene holds on.
export type SceneSettings = Readonly<{
  config: HarnessConfig
  gasbagRoom: number
  px: number
  py: number
  god: boolean
  instrument: boolean
  freezeAfter: number
}>

export const settingsOf = (config: HarnessConfig): SceneSettings => ({
  config,
  gasbagRoom: config.gasroom,
  px: config.px ?? PLAYER_X,
  py: config.py ?? PLAYER_Y,
  god: config.god,
  instrument: config.instrument,
  freezeAfter:
    config.tick !== undefined || config.director
      ? 0
      : (config.freeze ?? Infinity),
})

// NOTE: the page's state: the current scene's settings, the frames it has
// run, its number (for the ready signal), and the Model the last scene
// left, which the next scene boots from.
export type HarnessPage = {
  settings: SceneSettings
  framesRun: number
  sceneNumber: number
  maybeCarriedModel: Option.Option<Model>
}
