import { Array, Effect, Number, Option, Order, Result, Schema } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../src/app/message'
import { type Model, Phase } from '../../src/app/model'
import { initialModel } from '../../src/app/pureApp'
import { addBot } from '../../src/domain/bots'
import { RunRecordingJson, finishRecording } from '../../src/platform/recording'
import { PLAYER_MAX_HP } from '../../src/shared/constants'
import {
  APPLICATION,
  SURFACE,
  changeModel,
  isPlaying,
  messageIfAny,
  settleRunCommands,
  startedRun,
} from '../../src/test/testing'
import { asVeteran } from '../../src/test/veteran'
import { focusOf, modifyFocus } from '../../src/world/party/party'
import type { Zombie } from '../../src/world/schema/entitySchema'
import { replayRecording } from './replayRun'

// A scripted run recorded as a player's would be (src/platform/recording.ts),
// sent through JSON as the upload is, and played back through the plain
// step (tools/learn/replayRun.ts) to the same last World. The script walks,
// aims at the nearest zombie and fires, reloads, presses READY, plays
// beside a teammate bot, steps frames of mixed length, and refills its
// hearts outside the step, so every kind of edit a recording keeps shows.

const FRAMES = 900

const FRAME_MS: ReadonlyArray<number> = [1000 / 60, 1000 / 30, 1000 / 120, 25]

const MOVES: ReadonlyArray<string> = ['KeyW', 'KeyD', 'KeyS', 'KeyA']

const recordingStart = (model: Model): Model =>
  modifyFields(model, {
    maybeSurface: () => Option.some(SURFACE),
    maybeVisitId: () => Option.some('0123456789abcdef'),
    recordUnlock: () => 'Unlocked',
    recordRuns: () => 'On',
  })

const nearestZombie = (current: Model) => {
  const { x, y } = focusOf(current).player
  return Array.head(
    Array.sort(
      Array.filter(current.zombies, zombie => zombie.state._tag === 'Walking'),
      Order.mapInput(
        Number.Order,
        (zombie: Zombie) => (zombie.x - x) ** 2 + (zombie.y - y) ** 2,
      ),
    ),
  )
}

const keyFor = (frame: number): string =>
  MOVES[Math.floor(frame / 40) % MOVES.length] ?? 'KeyW'

const scriptFrame = (frame: number) =>
  Story.steps(
    messageIfAny(current =>
      frame % 40 === 0 && isPlaying(current)
        ? Option.some(Message.ReleasedKey({ code: keyFor(frame - 1) }))
        : Option.none(),
    ),
    messageIfAny(current =>
      frame % 40 === 0 && isPlaying(current)
        ? Option.some(Message.PressedKey({ code: keyFor(frame) }))
        : Option.none(),
    ),
    messageIfAny(current =>
      frame % 30 === 0 && Phase.isAnyOf(['Preparation'])(current.phase)
        ? Option.some(Message.PressedKey({ code: 'Enter' }))
        : Option.none(),
    ),
    messageIfAny(current =>
      Array.contains(current.input.pressedKeys, 'Enter')
        ? Option.some(Message.ReleasedKey({ code: 'Enter' }))
        : Option.none(),
    ),
    messageIfAny(current =>
      frame % 150 === 75 && Phase.isAnyOf(['Wave'])(current.phase)
        ? Option.some(Message.PressedKey({ code: 'KeyR' }))
        : Option.none(),
    ),
    messageIfAny(current =>
      Array.contains(current.input.pressedKeys, 'KeyR')
        ? Option.some(Message.ReleasedKey({ code: 'KeyR' }))
        : Option.none(),
    ),
    messageIfAny(current =>
      frame % 4 === 0
        ? Option.map(nearestZombie(current), zombie =>
            current.input.mouseButton._tag === 'Held'
              ? Message.MovedMouse({ clientX: zombie.x, clientY: zombie.y })
              : Message.PressedPointer({
                  pointerId: 1,
                  device: 'Mouse',
                  clientX: zombie.x,
                  clientY: zombie.y,
                }),
          )
        : Option.none(),
    ),
    messageIfAny(current =>
      isPlaying(current)
        ? Option.some(
            Message.TickedFrame({
              deltaTime: FRAME_MS[frame % FRAME_MS.length] ?? 1000 / 60,
            }),
          )
        : Option.none(),
    ),
    changeModel(current =>
      focusOf(current).player.hp < PLAYER_MAX_HP / 2
        ? modifyFocus(current, {
            player: player => modifyFields(player, { hp: () => PLAYER_MAX_HP }),
          })
        : current,
    ),
    ...(frame % 60 === 0 ? [settleRunCommands] : []),
  )

const recordedRun = Effect.gen(function* () {
  const started = yield* startedRun(
    addBot(recordingStart(asVeteran(initialModel))),
  )
  return yield* Story.story(
    APPLICATION,
    Story.given(started),
    ...Array.makeBy(FRAMES, scriptFrame),
    settleRunCommands,
  )
})

describe('a recorded run', () => {
  it.effect('replays through JSON to the same last World', () =>
    Effect.gen(function* () {
      const played = yield* recordedRun
      const recording = yield* Option.match(finishRecording(played.recorder), {
        onNone: () => Effect.die('the run was not recorded'),
        onSome: Effect.succeed,
      })
      expect(recording.end.ticks).toBeGreaterThan(FRAMES / 2)
      expect(Array.length(recording.edits)).toBeGreaterThan(0)

      const sent = yield* Schema.encodeEffect(RunRecordingJson)(recording)
      const received = yield* Schema.decodeEffect(RunRecordingJson)(sent)
      const replayed = replayRecording(received)
      expect(Result.map(replayed, ({ replayed: end }) => end)).toEqual(
        Result.succeed(recording.end),
      )
    }),
  )
})
