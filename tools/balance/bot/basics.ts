// The balance bot's basics: the Model it drives, what it plays (its
// options), its keys, and how it sends a Message, presses keys, and sees
// the zombies in its view.

import { levelOf } from '../../../src/arena'
import { CALLINGS } from '../../../src/calling'
import { cameraFocus, cameraFor, worldWindowOf } from '../../../src/camera'
import { update } from '../../../src/main'
import { Message } from '../../../src/message'
import type { Difficulty, ZombieKind, initialModel } from '../../../src/model'
import type { Calling } from '../../../src/playerData'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_TOUCH_SCREEN,
  type Screen,
} from '../../../src/screen'

export type Model = typeof initialModel
type GameMessage = Parameters<typeof update>[1]
export type Vector = { x: number; y: number }
export type Kind = ZombieKind

type BotMode = 'Campaign' | 'Endless'

// What the bot plays: the level, the mode, and how it shops and swaps.
// swapsBack is SWAP=1: it re-arms the spare gun before each wave while it
// has rounds, the way a player swaps back after a refill. The default bot
// never swaps, so once its spare runs dry it fights on with the pistol.
export type BotOptions = {
  difficulty: Difficulty
  mode: BotMode
  swapsBack: boolean
  noUpgrades: boolean
  calling: Calling
}

export const DEFAULT_OPTIONS: BotOptions = {
  difficulty: 'Normal',
  mode: 'Campaign',
  swapsBack: false,
  noUpgrades: false,
  calling: 'You',
}

// CALLING=Handyman, TrackStar, PennyPincher, or LineCook (any case, spaces
// allowed) plays that calling, with rank enough to start it.
export const parseCalling = (raw: string | undefined): Calling => {
  const name = (raw ?? 'you').toLowerCase().replaceAll(/[\s_-]/g, '')
  const found = CALLINGS.find(calling => calling.toLowerCase() === name)
  if (found === undefined) {
    throw new Error(`CALLING must be one of ${CALLINGS.join(', ')}`)
  }
  return found
}

export const parseDifficulty = (raw: string | undefined): Difficulty => {
  const name = (raw ?? 'normal').toLowerCase()
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
export const ROOM_CENTER: Vector = { x: 160, y: 95 }
export const KEYS = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  interact: 'Enter',
  knife: 'KeyF',
}

export const send = (model: Model, message: GameMessage): Model =>
  update(model, message).model

// The zombies standing in the room: alive, and not under the floor, held
// overhead, or in the air, so the bot can see, shoot, and flee them.
const OUT_OF_REACH = new Set(['Burrowed', 'Carried', 'Flying'])

// VIEW=portrait plays as a phone held upright would: it sees only the
// zombies inside the portrait camera's window, which follows it and leans
// toward its aim like the game's. Zombies out of view are not shot or fled.
// VIEW=touch plays as a phone on its side would, through the landscape
// phone's zoomed window. Both get the touch aim assist, as in the game.
export const maybeWindowScreen =
  process.env['VIEW'] === 'portrait'
    ? DEFAULT_PORTRAIT_SCREEN
    : process.env['VIEW'] === 'touch'
      ? LANDSCAPE_TOUCH_SCREEN
      : undefined

export const windowCamera = (model: Model, screen: Screen) =>
  cameraFor(levelOf(model), cameraFocus(model), worldWindowOf(screen))

export const isInView = (model: Model, zombie: Model['zombies'][number]) => {
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
}

// The zombies standing in the room, in view or not.
export const standing = (model: Model) =>
  model.zombies.filter(
    zombie =>
      zombie.state._tag === 'Walking' && !OUT_OF_REACH.has(zombie.action._tag),
  )

// The zombies standing in the bot's view: the whole room, or the phone's
// window under VIEW.
export const walking = (model: Model) =>
  standing(model).filter(zombie => isInView(model, zombie))

export const distance = (a: Vector, b: Vector) =>
  Math.hypot(a.x - b.x, a.y - b.y)

export const steerToward = (from: Vector, to: Vector): Vector => {
  const length = distance(from, to)
  return length < 2
    ? { x: 0, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

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

export const pressKeys = (model: Model, wanted: Set<string>): Model => {
  const held = new Set(model.input.pressedKeys)
  const released = [...held].filter(
    key => Object.values(KEYS).includes(key) && !wanted.has(key),
  )
  const pressed = [...wanted].filter(key => !held.has(key))
  const afterRelease = released.reduce(
    (sent, code) => send(sent, Message.ReleasedKey({ code })),
    model,
  )
  return pressed.reduce(
    (sent, code) => send(sent, Message.PressedKey({ code })),
    afterRelease,
  )
}

export const tapKey = (model: Model, code: string): Model =>
  send(send(model, Message.PressedKey({ code })), Message.ReleasedKey({ code }))
