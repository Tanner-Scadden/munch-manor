import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel, update } from '../../app/pureApp'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../shared/constants'
import { asVeteran } from '../../test/veteran'
import {
  focusOf,
  forEachSeat,
  modifyFocus,
  playersOf,
} from '../../world/party/party'
import { withWorld } from '../../world/schema/world'

// Phase 1's exit check (MULTIPLAYER.md): two players at one keyboard play a
// whole campaign to Victory. Player 1 walks a pattern on WASD and aims the
// mouse at the nearest zombie; player 2 walks a pattern on IJKL holding U.
// Both press READY through every break and walk off from the stall. Their
// hearts refill each frame, so the run always reaches the boss.
// NOTE: the bots walk fixed patterns, so on some seeds they fall into a
// loop with a zombie neither ever hits: of seeds 1 to 7, 1 and 4 did before
// zombies came in promptly after their warning, and 2, 3, 5, and 7 did
// after. The seed is one whose run plays through; a change that moves the
// run may need another.

const SURFACE = { left: 0, top: 0, width: 320, height: 180 }
const MAX_FRAMES = 120_000
const FRAMES_PER_MOVE = 75

const P1_MOVES: ReadonlyArray<ReadonlyArray<string>> = [
  ['KeyW'],
  ['KeyD'],
  ['KeyS'],
  ['KeyA'],
]
const P2_MOVES: ReadonlyArray<ReadonlyArray<string>> = [
  ['KeyL'],
  ['KeyI'],
  ['KeyJ'],
  ['KeyK'],
]
const MOVE_KEYS = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
]

const send = (current: Model, sent: Message): Model =>
  update(current, sent).model

const tap = (current: Model, code: string): Model =>
  send(
    send(current, Message.PressedKey({ code })),
    Message.ReleasedKey({ code }),
  )

const hold = (current: Model, wanted: ReadonlyArray<string>): Model => {
  const held = current.input.pressedKeys
  const released = Array.reduce(
    Array.filter(MOVE_KEYS, key => held.includes(key) && !wanted.includes(key)),
    current,
    (model, code) => send(model, Message.ReleasedKey({ code })),
  )
  return Array.reduce(
    Array.filter(wanted, key => !held.includes(key)),
    released,
    (model, code) => send(model, Message.PressedKey({ code })),
  )
}

type Target = Readonly<{ x: number; y: number; distance: number }>

const nearestZombie = (current: Model): Target | undefined =>
  Array.reduce(
    Array.filter(current.zombies, zombie => zombie.state._tag === 'Walking'),
    Option.none<Target>(),
    (best, zombie) => {
      const distance =
        (zombie.x - focusOf(current).player.x) ** 2 +
        (zombie.y - focusOf(current).player.y) ** 2
      return Option.isNone(best) || distance < best.value.distance
        ? Option.some({ x: zombie.x, y: zombie.y, distance })
        : best
    },
  ).pipe(Option.getOrUndefined)

// NOTE: the breaks have no clock on Normal, so a player the READY key finds
// at a purchasable (held there to buy) would hold the break forever. The
// walking pattern carries on through the break, so both come off it.
const walking = (frame: number): ReadonlyArray<string> => {
  const step = Math.floor(frame / FRAMES_PER_MOVE)
  return [
    ...(P1_MOVES[step % P1_MOVES.length] ?? []),
    ...(P2_MOVES[(step + 1) % P2_MOVES.length] ?? []),
  ]
}

const prepare = (current: Model, frame: number): Model => {
  const still = hold(current, walking(frame))
  const leftStall =
    focusOf(still).shop._tag === 'Browsing' ? tap(still, 'Escape') : still
  return tap(tap(tap(leftStall, 'KeyO'), 'KeyY'), 'Enter')
}

const fight = (current: Model, frame: number): Model => {
  const moved = hold(current, walking(frame))
  const firing = moved.input.pressedKeys.includes('KeyU')
    ? moved
    : send(moved, Message.PressedKey({ code: 'KeyU' }))
  const target = nearestZombie(firing)
  if (frame % 4 !== 0 || target === undefined) {
    return firing
  }
  const aimed = send(
    firing,
    Message.MovedMouse({ clientX: target.x, clientY: target.y }),
  )
  return aimed.input.mouseButton._tag === 'Held'
    ? aimed
    : send(
        aimed,
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: target.x,
          clientY: target.y,
        }),
      )
}

const drive = (current: Model, frame: number): Model =>
  Phase.matchOrElse(
    current.phase,
    {
      Preparation: () => prepare(current, frame),
      Wave: () => fight(current, frame),
    },
    () => current,
  )

const refillHearts = (current: Model): Model =>
  withWorld(current, world =>
    forEachSeat(world, seatWorld =>
      modifyFocus(seatWorld, {
        player: player => modifyFields(player, { hp: () => PLAYER_MAX_HP }),
      }),
    ),
  )

const isPlaying = (current: Model): boolean =>
  current.phase._tag === 'Preparation' || current.phase._tag === 'Wave'

type Played = Readonly<{ end: Model; frames: number }>

const play = (start: Model): Played =>
  Array.reduce(
    globalThis.Array.from({ length: MAX_FRAMES }),
    { end: start, frames: 0 },
    (played, _, frame) =>
      isPlaying(played.end)
        ? {
            end: refillHearts(
              send(
                drive(played.end, frame),
                Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
              ),
            ),
            frames: frame + 1,
          }
        : played,
  )

describe('two keyboards on one desktop', () => {
  test('play a whole campaign to Victory', () => {
    const ready = send(
      modifyFields(asVeteran(initialModel), {
        rngState: () => 4,
        localPlayers: () => 2,
        difficulty: () => ({ chosen: 'Normal', nightmare: 'Unlocked' }),
      }),
      Message.MeasuredGameSurface(SURFACE),
    )
    const started = tap(tap(ready, 'Enter'), 'Enter')
    expect(playersOf(started)).toHaveLength(2)
    const { end, frames } = play(started)
    expect(end.phase._tag).toBe('Victory')
    const [lead, mate] = playersOf(end)
    expect(lead?.wallet.earned).toBeGreaterThan(0)
    expect(mate?.wallet.earned).toBeGreaterThan(0)
    expect(mate?.seat.kills).toBeGreaterThan(0)
    expect(frames).toBeLessThan(MAX_FRAMES)
  }, 300_000)
})
