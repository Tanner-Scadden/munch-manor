import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, PLAYER_MAX_HP } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { forEachSeat, playersOf } from './party'
import { asVeteran } from './veteran'
import { withWorld } from './world'

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
  const released = MOVE_KEYS.filter(
    key => held.includes(key) && !wanted.includes(key),
  ).reduce((model, code) => send(model, Message.ReleasedKey({ code })), current)
  return wanted
    .filter(key => !held.includes(key))
    .reduce(
      (model, code) => send(model, Message.PressedKey({ code })),
      released,
    )
}

const nearestZombie = (current: Model) =>
  current.zombies
    .filter(zombie => zombie.state._tag === 'Walking')
    .reduce<{ x: number; y: number; distance: number } | undefined>(
      (best, zombie) => {
        const distance =
          (zombie.x - current.player.x) ** 2 +
          (zombie.y - current.player.y) ** 2
        return best === undefined || distance < best.distance
          ? { x: zombie.x, y: zombie.y, distance }
          : best
      },
      undefined,
    )

const prepare = (current: Model): Model => {
  const still = hold(current, [])
  const leftStall =
    still.shop._tag === 'Browsing' ? tap(still, 'Escape') : still
  return tap(tap(tap(leftStall, 'KeyO'), 'KeyY'), 'Enter')
}

const fight = (current: Model, frame: number): Model => {
  const step = Math.floor(frame / FRAMES_PER_MOVE)
  const moved = hold(current, [
    ...(P1_MOVES[step % P1_MOVES.length] ?? []),
    ...(P2_MOVES[(step + 1) % P2_MOVES.length] ?? []),
  ])
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
      Preparation: () => prepare(current),
      Wave: () => fight(current, frame),
    },
    () => current,
  )

const refillHearts = (current: Model): Model =>
  withWorld(current, world =>
    forEachSeat(world, seatWorld =>
      modifyFields(seatWorld, {
        player: player => modifyFields(player, { hp: () => PLAYER_MAX_HP }),
      }),
    ),
  )

const isPlaying = (current: Model): boolean =>
  current.phase._tag === 'Preparation' || current.phase._tag === 'Wave'

type Played = Readonly<{ end: Model; frames: number }>

const play = (start: Model): Played =>
  Array.from({ length: MAX_FRAMES }).reduce<Played>(
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
    { end: start, frames: 0 },
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
    const started = tap(ready, 'Enter')
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
