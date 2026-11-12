// The balance bot's basics: the Model it drives, what it plays (its
// options), its keys, and how it sends a Message, presses keys, and sees
// the zombies in its view.

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
  worldWindowOf,
} from '../../../src/render/camera'
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

// What the bot plays: the level, the mode, and how it shops and swaps.
// swapsBack is SWAP=1: it re-arms the spare gun before each wave, the way a
// player swaps back. The default bot never swaps.
export type BotOptions = {
  difficulty: Difficulty
  mode: BotMode
  swapsBack: boolean
  noUpgrades: boolean
  calling: Calling
  modifiers: Modifiers
  // NOTE: called with the Models before and after each frame the bot ticks,
  // for a script that reads the World over time (tools/balance/pacing.ts).
  onFrame?: (before: Model, after: Model) => void
}

export const DEFAULT_OPTIONS: BotOptions = {
  difficulty: 'Normal',
  mode: 'Campaign',
  swapsBack: false,
  noUpgrades: false,
  calling: 'You',
  modifiers: noModifiers,
}

// CALLING=Handyman, TrackStar, PennyPincher, or LineCook (any case, spaces
// allowed) plays that calling, with rank enough to start it.
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

// MODS=BigCrowd,Broke,Glass (any case, commas) plays the run with those
// modifiers on, as the lobby sets them. FriendlyFire is refused: the bot
// plays alone, and it bites only with teammates.
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
// NOTE: where the bot holds in the dining room: the open aisle between the
// party table and the start spot, which runs wall to wall.
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

// The zombies standing in the room: alive, and not under the floor, held
// overhead, or in the air, so the bot can see, shoot, and flee them.
const OUT_OF_REACH = new Set(['Burrowed', 'Carried', 'Flying'])

// VIEW=portrait plays as a phone held upright would: it sees only the
// zombies inside the portrait camera's window, which follows it and leans
// toward its aim like the game's. Zombies out of view are not shot or fled.
// VIEW=touch plays as a 16:9 phone on its side would, through the landscape
// phone's zoomed window, and VIEW=wide as a 19.5:9 or wider one, whose
// screen widens to 388 and shows 291 columns of the room. All three get the
// touch aim assist, as in the game.
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
    const camera = windowCamera(model, maybeWindowScreen)
    return (
      zombie.x >= camera.x &&
      zombie.x <= camera.x + camera.width &&
      zombie.y >= camera.y &&
      zombie.y <= camera.y + camera.height
    )
  },
)

// The zombies standing in the room, in view or not.
export const standing = (model: Model) =>
  Array.filter(
    model.zombies,
    zombie =>
      zombie.state._tag === 'Walking' && !OUT_OF_REACH.has(zombie.action._tag),
  )

// The zombies standing in the bot's view: the whole room, or the phone's
// window under VIEW.
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
  const length = Math.hypot(direction.x, direction.y)
  if (length < 1e-6) {
    return keys
  }
  const x = direction.x / length
  const y = direction.y / length
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
