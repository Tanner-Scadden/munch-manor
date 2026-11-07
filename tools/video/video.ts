// Renders the clips of a shot list to MP4 (and GIF) in tools/video/out:
//   bun run video -- tools/video/shots/devlog.json [--only <clip>] [--frames-only]
// It runs through the heavy guard as a CPU job. See tools/video/README.md.
import {
  Array,
  Clock,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  String,
} from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { launch, useHarness } from '../audit/lib'
import { yieldTurn } from '../heavy/turn'
import { INSTALL_FFMPEG, encodeGif, encodeMp4, hasFfmpeg } from './encode'
import {
  captureShot,
  frameName,
  loopFrames,
  openShotPage,
  outputSize,
} from './frames'
import {
  type Clip,
  FRAMES_PER_SECOND,
  type Score,
  decodeShotList,
} from './shotList'
import { renderSoundtrack } from './soundtrack'
import type { ClipCue } from './soundtrackRequest'

class VideoExit extends Schema.TaggedError<
  VideoExit,
  { readonly brand: unique symbol }
>()('VideoExit', { message: Schema.String }) {}

const USAGE =
  'usage: bun run video -- <shot list.json> [--only <clip>] [--frames-only]'

type Options = Readonly<{
  listPath: string
  maybeOnly: Option.Option<string>
  isFramesOnly: boolean
}>

const optionsOf = (args: ReadonlyArray<string>): Option.Option<Options> => {
  const onlyAt = args.indexOf('--only')
  const maybeOnly =
    onlyAt >= 0 ? Option.fromNullishOr(args[onlyAt + 1]) : Option.none()
  const positional = Array.filter(
    args,
    (arg, index) =>
      !String.startsWith('--')(arg) && (onlyAt < 0 || index !== onlyAt + 1),
  )
  return Option.map(Array.head(positional), listPath => ({
    listPath,
    maybeOnly,
    isFramesOnly: args.includes('--frames-only'),
  }))
}

const hashOf = (bytes: Uint8Array): string =>
  String.slice(
    0,
    16,
  )(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'))

// NOTE: each frame's hash and the soundtrack's, one a line, in
// hashes.txt beside them, and one hash of the lot, so two renders of the
// same shot list can be compared at a glance and, when they differ, frame
// by frame.
const hashFiles = (paths: ReadonlyArray<string>, listPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const lines = yield* Effect.forEach(paths, file =>
      Effect.map(
        fs.readFile(file),
        bytes => `${hashOf(bytes)} ${path.basename(file)}`,
      ),
    )
    const text = `${Array.join(lines, '\n')}\n`
    yield* fs.writeFileString(listPath, text)
    return hashOf(new TextEncoder().encode(text))
  })

// NOTE: a clip with its own score drops the music the game cued for its
// shots and plays the score's cues instead; `music: false` drops music.
const soundsOf = (
  clip: Clip,
  cues: ReadonlyArray<ClipCue>,
): ReadonlyArray<ClipCue> => {
  const effects = Array.filter(cues, ({ cue }) => cue._tag !== 'Music')
  if (clip.score !== undefined) {
    return [
      ...effects,
      ...Array.map(clip.score.cues, (cue): ClipCue => ({
        frame: cue.frame,
        cue: {
          _tag: 'Music',
          tick: cue.frame,
          mood: cue.mood,
          level: cue.level ?? 'Full',
          stinger: cue.stinger ?? 'None',
        },
      })),
    ]
  }
  return clip.music === false ? effects : cues
}

// NOTE: the music's first note sounds a moment after its cue, as the
// game's does (START_DELAY_SECONDS in src/music.ts).
const MUSIC_START_FRAMES = 0.05 * FRAMES_PER_SECOND

// NOTE: how far each cut (the middle of a dissolve) lands from the score's
// nearest beat, so a shot list can be cut to the music.
const beatReport = (score: Score, cuts: ReadonlyArray<number>): string => {
  const beat = (FRAMES_PER_SECOND * 60) / score.bpm
  const start = score.cues[0].frame + MUSIC_START_FRAMES
  const lines = Array.map(cuts, cut => {
    const beats = (cut - start) / beat
    const nearest = Math.round(beats)
    const off = cut - (start + nearest * beat)
    return `    frame ${cut} (${(cut / FRAMES_PER_SECOND).toFixed(2)} s): beat ${nearest}, ${off >= 0 ? '+' : ''}${off.toFixed(1)} frames`
  })
  return Array.join(
    [`  cuts against the beat at ${score.bpm} bpm:`, ...lines],
    '\n',
  )
}

const renderClip = (
  browser: Awaited<ReturnType<typeof launch>>,
  clip: Clip,
  outDir: string,
  canEncode: boolean,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const startedMs = yield* Clock.currentTimeMillis
    const clipDir = path.join(outDir, clip.name)
    const framesDir = path.join(clipDir, 'frames')
    yield* fs.remove(clipDir, { recursive: true }).pipe(Effect.ignore)
    yield* fs.makeDirectory(framesDir, { recursive: true })
    const size = outputSize(clip.format)
    yield* Console.log(
      `${clip.name}: ${clip.format}, ${size.width}x${size.height}`,
    )
    const page = yield* openShotPage({ browser, format: clip.format })
    let frames = 0
    const cues: Array<ClipCue> = []
    const cuts: Array<number> = []
    for (const shot of clip.shots) {
      yield* yieldTurn(`video ${clip.name} ${shot.name}`)
      const overlap = Math.min(frames, shot.crossfade ?? 0)
      const firstFrame = frames - overlap
      const result = yield* captureShot({
        page,
        shot,
        format: clip.format,
        dir: framesDir,
        firstFrame,
        overlapEnd: frames,
        log: line => Console.log(line),
      })
      if (firstFrame > 0) {
        cuts.push(firstFrame + Math.floor(overlap / 2))
      }
      cues.push(...result.cues)
      frames = firstFrame + result.frameCount
    }
    if (clip.loop !== undefined) {
      yield* Console.log(
        `  looping the last ${clip.loop} frames into the first`,
      )
      const tailStart = yield* loopFrames({
        page,
        dir: framesDir,
        frames,
        overlap: clip.loop,
      })
      // NOTE: the tail's sounds play over the head it dissolved into.
      const moved = Array.map(cues, cue =>
        cue.frame >= tailStart ? { ...cue, frame: cue.frame - tailStart } : cue,
      )
      cues.splice(0, cues.length, ...moved)
      frames = tailStart
    }
    yield* Effect.promise(() => page.context().close())
    const wav = path.join(clipDir, `${clip.name}.wav`)
    const sounds = soundsOf(clip, cues)
    if (clip.score !== undefined) {
      yield* Console.log(beatReport(clip.score, cuts))
    }
    const seconds = yield* renderSoundtrack({
      browser,
      cues: sounds,
      frames,
      outPath: wav,
    })
    const hash = yield* hashFiles(
      [
        ...Array.makeBy(frames, frame =>
          path.join(framesDir, frameName(frame)),
        ),
        wav,
      ],
      path.join(clipDir, 'hashes.txt'),
    )
    const outputs: Array<string> = [wav]
    if (canEncode) {
      const pattern = path.join(framesDir, 'frame-%06d.png')
      const mp4 = path.join(outDir, `${clip.name}.mp4`)
      yield* encodeMp4({ frames: pattern, wav, out: mp4 })
      outputs.push(mp4)
      if (clip.gif === true) {
        const gif = path.join(outDir, `${clip.name}.gif`)
        yield* encodeGif({ frames: pattern, out: gif })
        outputs.push(gif)
      }
    }
    const sizes = yield* Effect.forEach(outputs, file =>
      Effect.map(
        fs.stat(file),
        info => `${file} (${(Number(info.size) / 1e6).toFixed(1)} MB)`,
      ),
    )
    const finishedMs = yield* Clock.currentTimeMillis
    yield* Console.log(
      Array.join(
        [
          `${clip.name}: ${frames} frames, ${seconds.toFixed(2)} s at ${FRAMES_PER_SECOND} fps, rendered in ${((finishedMs - startedMs) / 1000).toFixed(1)} s`,
          `  frames and sound hash ${hash}`,
          ...Array.map(sizes, line => `  ${line}`),
        ],
        '\n',
      ),
    )
  })

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const options = yield* Effect.fromOption(
    optionsOf(process.argv.slice(2)),
  ).pipe(Effect.mapError(() => VideoExit.make({ message: USAGE })))
  const canEncode = !options.isFramesOnly && (yield* hasFfmpeg)
  if (!options.isFramesOnly && !canEncode) {
    return yield* VideoExit.make({ message: INSTALL_FFMPEG })
  }
  const value = yield* fs.readFileString(options.listPath)
  const list = yield* decodeShotList(value)
  const clips = Option.match(options.maybeOnly, {
    onNone: () => list.clips,
    onSome: only => Array.filter(list.clips, clip => clip.name === only),
  })
  if (clips.length === 0) {
    return yield* VideoExit.make({ message: 'no clip by that name' })
  }
  const outDir = path.join(import.meta.dir, 'out')
  yield* Effect.promise(() => useHarness())
  yield* Effect.acquireUseRelease(
    Effect.promise(() => launch()),
    browser =>
      Effect.forEach(
        clips,
        clip => renderClip(browser, clip, outDir, canEncode),
        {
          discard: true,
        },
      ),
    browser => Effect.promise(() => browser.close()),
  )
})

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('VideoExit', exit =>
      Effect.andThen(
        Console.error(exit.message),
        Effect.sync(() => process.exit(1)),
      ),
    ),
    Effect.provide(NodeServices.layer),
  ),
)
