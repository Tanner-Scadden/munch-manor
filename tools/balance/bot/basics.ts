import { Array, Function, Option, Record, String } from 'effect'

import { Message } from '../../../src/app/message'
import type {
  Difficulty,
  Model as GameModel,
  ZombieKind,
} from '../../../src/app/model'
import { update } from '../../../src/app/pureApp'
import {
  type Camera,
  cameraFocus,
  cameraFor,
  isInView as isLensInView,
  worldWindowOf,
} from '../../../src/render/camera'
import { floorToScreenDirection } from '../../../src/render/lens'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_MAX_WIDTH,
  LANDSCAPE_TOUCH_SCREEN,
  type Screen,
  landscapeTouchScreen,
} from '../../../src/render/screen'
import type { Calling } from '../../../src/shared/playerData'
import { CALLINGS } from '../../../src/world/heroes/calling'
import { levelOf } from '../../../src/world/level/arena'
import { MAX_MARK } from '../../../src/world/run/dareLadder'
import {
  MODIFIER_ORDER,
  type Modifiers,
  noModifiers,
  toggledModifier,
} from '../../../src/world/run/modifiers'
import { knobText } from './knobs'

export type Model = GameModel
type GameMessage = Parameters<typeof update>[1]
export type Vector = { x: number; y: number }
export type Kind = ZombieKind

type BotMode = 'Campaign' | 'Endless'

export type BotOptions = {
  difficulty: Difficulty
  mode: BotMode
  swapsBack: boolean
  noUpgrades: boolean
  calling: Calling
  modifiers: Modifiers
  dareMark: number
  onFrame?: (before: Model, after: Model) => void
}

export const DEFAULT_OPTIONS: BotOptions = {
  difficulty: 'Normal',
  mode: 'Campaign',
  swapsBack: false,
  noUpgrades: false,
  calling: 'You',
  modifiers: noModifiers,
  dareMark: 0,
}

export const parseCalling = (raw: string | undefined): Calling => {
  const name = String.replaceAll(
    /[\s_-]/g,
    '',
  )(String.toLowerCase(raw ?? 'you'))
  const found = Option.getOrUndefined(
    Array.findFirst(CALLINGS, calling => String.toLowerCase(calling) === name),
  )
  if (found === undefined) {
    throw new Error(`CALLING must be one of ${Array.join(CALLINGS, ', ')}`)
  }
  return found
}

export const parseDareMark = (raw: string | undefined): number => {
  const mark = Number(raw ?? '0')
  if (!Number.isInteger(mark) || mark < 0 || mark > MAX_MARK) {
    throw new Error(`MARK must be a whole number from 0 to ${MAX_MARK}`)
  }
  return mark
}

export const parseModifiers = (raw: string | undefined): Modifiers => {
  const names = Array.filter(
    Array.map(String.split(',')(raw ?? ''), name =>
      String.toLowerCase(String.trim(name)),
    ),
    name => name !== '',
  )
  return Array.reduce(names, noModifiers, (modifiers, name) => {
    const found = Option.getOrUndefined(
      Array.findFirst(
        MODIFIER_ORDER,
        modifier => String.toLowerCase(modifier) === name,
      ),
    )
    if (found === undefined || found === 'FriendlyFire') {
      throw new Error('MODS must be a list of BigCrowd, Broke, Glass')
    }
    return toggledModifier(modifiers, found)
  })
}

export const parseDifficulty = (raw: string | undefined): Difficulty => {
  const name = String.toLowerCase(raw ?? 'normal')
  if (name === 'easy') {
    return 'Easy'
  }
  if (name === 'hard') {
    return 'Hard'
  }
  if (name === 'nightmare') {
    return 'Nightmare'
  }
  if (name === 'normal') {
    return 'Normal'
  }
  throw new Error(
    `DIFFICULTY must be easy, normal, hard, or nightmare, not ${name}`,
  )
}

export const FRAME_MS = 1000 / 30
export const maxRunMs = (options: BotOptions) =>
  (options.mode === 'Endless' ? 90 : 20) * 60 * 1000
export const ROOM_CENTER: Vector = { x: 180, y: 130 }
export const KEYS = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  interact: 'Enter',
  knife: 'KeyF',
}

export const send: {
  (message: GameMessage): (model: Model) => Model
  (model: Model, message: GameMessage): Model
} = Function.dual(
  2,
  (model: Model, message: GameMessage): Model => update(model, message).model,
)

const OUT_OF_REACH = new Set(['Burrowed', 'Carried', 'Flying'])

const VIEW_SCREENS: Readonly<Record<string, Screen>> = {
  portrait: DEFAULT_PORTRAIT_SCREEN,
  touch: LANDSCAPE_TOUCH_SCREEN,
  wide: landscapeTouchScreen(LANDSCAPE_MAX_WIDTH),
}

export const maybeWindowScreen: Screen | undefined = Option.getOrUndefined(
  Option.flatMap(Option.fromNullishOr(knobText('VIEW')), view =>
    Record.get(VIEW_SCREENS, view),
  ),
)

export const windowCamera: {
  (screen: Screen): (model: Model) => Camera
  (model: Model, screen: Screen): Camera
} = Function.dual(2, (model: Model, screen: Screen): Camera =>
  cameraFor(levelOf(model), cameraFocus(model), worldWindowOf(screen)),
)

export const isInView: {
  (zombie: Model['zombies'][number]): (model: Model) => boolean
  (model: Model, zombie: Model['zombies'][number]): boolean
} = Function.dual(
  2,
  (model: Model, zombie: Model['zombies'][number]): boolean => {
    if (maybeWindowScreen === undefined) {
      return true
    }
    return isLensInView(windowCamera(model, maybeWindowScreen), zombie)
  },
)

export const standing = (model: Model) =>
  Array.filter(
    model.zombies,
    zombie =>
      zombie.state._tag === 'Walking' && !OUT_OF_REACH.has(zombie.action._tag),
  )

export const walking = (model: Model) =>
  Array.filter(standing(model), zombie => isInView(model, zombie))

export const distance: {
  (b: Vector): (a: Vector) => number
  (a: Vector, b: Vector): number
} = Function.dual(2, (a: Vector, b: Vector): number =>
  Math.hypot(a.x - b.x, a.y - b.y),
)

export const steerToward: {
  (to: Vector): (from: Vector) => Vector
  (from: Vector, to: Vector): Vector
} = Function.dual(2, (from: Vector, to: Vector): Vector => {
  const length = distance(from, to)
  return length < 2
    ? { x: 0, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
})

export const desiredKeys = (direction: Vector): Set<string> => {
  const keys = new Set<string>()
  const onScreen = floorToScreenDirection(direction)
  const length = Math.hypot(onScreen.x, onScreen.y)
  if (length < 1e-6) {
    return keys
  }
  const x = onScreen.x / length
  const y = onScreen.y / length
  if (x > 0.38) {
    keys.add(KEYS.right)
  }
  if (x < -0.38) {
    keys.add(KEYS.left)
  }
  if (y > 0.38) {
    keys.add(KEYS.down)
  }
  if (y < -0.38) {
    keys.add(KEYS.up)
  }
  return keys
}

export const pressKeys: {
  (wanted: Set<string>): (model: Model) => Model
  (model: Model, wanted: Set<string>): Model
} = Function.dual(2, (model: Model, wanted: Set<string>): Model => {
  const held = new Set(model.input.pressedKeys)
  const released = Array.filter(
    [...held],
    key => Record.values(KEYS).includes(key) && !wanted.has(key),
  )
  const pressed = Array.filter([...wanted], key => !held.has(key))
  const afterRelease = Array.reduce(released, model, (sent, code) =>
    send(sent, Message.ReleasedKey({ code })),
  )
  return Array.reduce(pressed, afterRelease, (sent, code) =>
    send(sent, Message.PressedKey({ code })),
  )
})

export const tapKey: {
  (code: string): (model: Model) => Model
  (model: Model, code: string): Model
} = Function.dual(2, (model: Model, code: string): Model =>
  send(
    send(model, Message.PressedKey({ code })),
    Message.ReleasedKey({ code }),
  ),
)
