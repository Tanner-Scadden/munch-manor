import type { Option } from 'effect'

import type { Model } from '@game/app/model'

import type { HarnessConfig } from './config'

const PLAYER_X = 160
const PLAYER_Y = 90

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

export type HarnessPage = {
  settings: SceneSettings
  framesSent: number
  framesRun: number
  sceneNumber: number
  maybeCarriedModel: Option.Option<Model>
}

export const emptyTimings = (): Window['__timings'] => ({
  update: [],
  view: [],
  viewFrames: [],
  tickFrames: [],
})

export const animationFrameTime = (): number =>
  Number(document.timeline.currentTime ?? -1)
