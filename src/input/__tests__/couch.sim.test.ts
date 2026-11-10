import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../shared/constants'
import {
  APPLICATION,
  changeModel,
  isPlaying,
  messageIfAny,
  playedThrough,
  resolveFocusLobby,
  settleRunCommands,
} from '../../test/testing'
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
// NOTE: the run is played as Block-aware Stories: a break one frame to a
// Story, since the players act on the frame's first Model, and a wave in
// stretches of WAVE_STRETCH frames, each player's choice made by
// `messageIfAny` on the Model it finds. A stretch the wave ends in is cut
// at the frame it ended on, and the run goes on from there.

const SURFACE = { left: 0, top: 0, width: 320, height: 180 }
const MAX_FRAMES = 120_000
const FRAMES_PER_MOVE = 75
const WAVE_STRETCH = 120

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

const FRAME = Message.TickedFrame({ deltaTime: FIXED_STEP_MS })

const isHeld = (current: Model, code: string): boolean =>
  Array.contains(current.input.pressedKeys, code)

const tap = (code: string): ReadonlyArray<Message> => [
  Message.PressedKey({ code }),
  Message.ReleasedKey({ code }),
]

type Target = Readonly<{ x: number; y: number; distance: number }>

const nearestZombie = (current: Model): Option.Option<Target> =>
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
  )

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

// NOTE: the move keys let go and pressed to walk the pattern at `frame`, from
// the keys the Model holds.
const holdFor = (current: Model, frame: number): ReadonlyArray<Message> => {
  const wanted = walking(frame)
  return [
    ...Array.map(
      Array.filter(
        MOVE_KEYS,
        key => isHeld(current, key) && !Array.contains(wanted, key),
      ),
      code => Message.ReleasedKey({ code }),
    ),
    ...Array.map(
      Array.filter(wanted, key => !isHeld(current, key)),
      code => Message.PressedKey({ code }),
    ),
  ]
}

// NOTE: a frame of a break, from its first Model: walk, press both
// players' READY and the lead's, then the frame.
const breakFrame = (current: Model, frame: number): ReadonlyArray<Message> => [
  ...holdFor(current, frame),
  ...tap('KeyO'),
  ...tap('KeyY'),
  ...tap('Enter'),
  FRAME,
]

const refillHearts = (current: Model): Model =>
  withWorld(current, world =>
    forEachSeat(world, seatWorld =>
      modifyFocus(seatWorld, {
        player: player => modifyFields(player, { hp: () => PLAYER_MAX_HP }),
      }),
    ),
  )

// NOTE: a frame of a wave, each choice made on the Model it finds: walk the
// pattern, hold U, every fourth frame aim at the nearest zombie and hold the
// mouse button down, then the frame, and the hearts refilled.
const waveFrame = (frame: number) => [
  ...Array.map(MOVE_KEYS, code =>
    messageIfAny(current =>
      isHeld(current, code) && !Array.contains(walking(frame), code)
        ? Option.some(Message.ReleasedKey({ code }))
        : Option.none(),
    ),
  ),
  ...Array.map(walking(frame), code =>
    messageIfAny(current =>
      isHeld(current, code)
        ? Option.none()
        : Option.some(Message.PressedKey({ code })),
    ),
  ),
  messageIfAny(current =>
    isHeld(current, 'KeyU')
      ? Option.none()
      : Option.some(Message.PressedKey({ code: 'KeyU' })),
  ),
  ...(frame % 4 === 0
    ? [
        messageIfAny(current =>
          Option.map(nearestZombie(current), ({ x, y }) =>
            Message.MovedMouse({ clientX: x, clientY: y }),
          ),
        ),
        messageIfAny(current =>
          current.input.mouseButton._tag === 'Held'
            ? Option.none()
            : Option.map(nearestZombie(current), ({ x, y }) =>
                Message.PressedPointer({
                  pointerId: 1,
                  device: 'Mouse',
                  clientX: x,
                  clientY: y,
                }),
              ),
        ),
      ]
    : []),
  Story.message(FRAME),
  changeModel(refillHearts),
]

// NOTE: up to `length` frames of a wave from `start`, and the Model each
// frame left, gathered in an array the Story alone fills.
const waveStretch = (start: Model, first: number, length: number) =>
  Effect.suspend(() => {
    const ends: Array<Model> = []
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...Array.flatMap(
        Array.makeBy(length, index => first + index),
        frame => [
          ...waveFrame(frame),
          Story.model((current: Model) => {
            ends.push(current)
          }),
        ],
      ),
      settleRunCommands,
    ).pipe(Effect.as<ReadonlyArray<Model>>(ends))
  })

type Played = Readonly<{ end: Model; frames: number }>

const playFrom = (played: Played): Effect.Effect<Played> =>
  played.frames >= MAX_FRAMES || !isPlaying(played.end)
    ? Effect.succeed(played)
    : Effect.flatMap(
        Phase.guards.Preparation(played.end.phase)
          ? Effect.map(
              playedThrough(played.end, breakFrame(played.end, played.frames)),
              end => ({ end: refillHearts(end), frames: played.frames + 1 }),
            )
          : Effect.map(
              waveStretch(
                played.end,
                played.frames,
                Math.min(WAVE_STRETCH, MAX_FRAMES - played.frames),
              ),
              ends => {
                const over = Array.findFirstIndex(
                  ends,
                  current => !Phase.guards.Wave(current.phase),
                )
                const last = Option.getOrElse(over, () => ends.length - 1)
                return {
                  end: Option.getOrThrow(Array.get(ends, last)),
                  frames: played.frames + last + 1,
                }
              },
            ),
        playFrom,
      )

describe('two keyboards on one desktop', () => {
  it.effect(
    'play a whole campaign to Victory',
    () =>
      Effect.gen(function* () {
        const ready = yield* playedThrough(
          modifyFields(asVeteran(initialModel), {
            // NOTE: seed 4 played until the library's layer opened the
            // dining room's east door onto the yard inside the map; from
            // then on its wave 2 ended in four zombies circling the two
            // players' walking pattern out of both guns' reach, forever.
            // Seed 5 stalled the same way once the cases and crates moved
            // with the rooms.
            rngState: () => 6,
            localPlayers: () => 2,
            difficulty: () => ({ chosen: 'Normal', nightmare: 'Unlocked' }),
          }),
          [Message.MeasuredGameSurface(SURFACE)],
        )
        const started = yield* Story.story(
          APPLICATION,
          Story.given(ready),
          ...Array.map(tap('Enter'), Story.message),
          resolveFocusLobby(),
          ...Array.map(tap('Enter'), Story.message),
          settleRunCommands,
        )
        expect(playersOf(started)).toHaveLength(2)
        const { end, frames } = yield* playFrom({ end: started, frames: 0 })
        expect(end.phase._tag).toBe('Victory')
        const [, mate] = playersOf(end)
        expect(end.keys.found).toBeGreaterThan(0)
        expect(mate?.seat.kills).toBeGreaterThan(0)
        expect(frames).toBeLessThan(MAX_FRAMES)
      }),
    300_000,
  )
})
