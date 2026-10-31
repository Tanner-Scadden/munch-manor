# Video

Clips of the game for devlogs and the launch video (`RELEASE_VIDEO.md`), rendered offline from scripted runs, so a new build re-renders every clip with one command:

```sh
bun run video -- tools/video/shots/devlog.json            # every clip
bun run video -- tools/video/shots/devlog.json --only coop-looks
bun run video -- tools/video/shots/devlog.json --frames-only  # no ffmpeg needed
bun run video -- tools/video/shots/release.json --only release-30s  # the launch cut
```

`shots/release.json` holds the launch video: `release-30s` (16:9), `release-30s-vertical` (9:16, the portrait layout), and `release-loop`, the 6 second loop for the pinned reply.

It runs through the heavy guard as a CPU job and writes to `tools/video/out/` (gitignored): `<clip>.mp4`, `<clip>.gif` when the clip asks for one, and `<clip>/` with the frames, the soundtrack WAV, and `hashes.txt`. It needs ffmpeg for the MP4 and GIF (`brew install ffmpeg`), and stops with that hint when it is missing, unless `--frames-only`. Playwright comes from `tools/audit` (`cd tools/audit && bun install` once).

## How it works

| Step     | File                              | What it does                                                                                                                                                                                                                                     |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Director | `tools/audit/harness/director.ts` | With `director` in the harness query the page never ticks by itself. Each `step(n)` plays n fixed 1/60 s ticks, the shot's script first: keys, the mouse or touch sticks, a co-op room's World stepped with every seat played by a bot           |
| Frames   | `frames.ts`                       | Plays a shot one step at a time and captures each frame at six screen pixels a game pixel: 1920x1080 (16:9, mouse) or 1080x1920 (9:16, upright touch phone, the portrait layout). CSS animations are set to the shot's clock before each capture |
| Sound    | `soundtrack.ts`, `audioPage.ts`   | The sounds and music cues the game asked for, logged by tick, rendered by the game's own audio engine (`src/audio.ts`, `src/music.ts`) around an `OfflineAudioContext` in headless Chrome, into a 48 kHz stereo WAV                              |
| Encode   | `encode.ts`                       | ffmpeg: H.264 MP4 (yuv420p, AAC, fast start) and a half size 30 fps GIF on one palette, both bitexact                                                                                                                                            |

Captions (the game's pixel font, `src/font.ts`) and fades are drawn over the page before each capture, so a frame on disk is the finished frame. Slow motion repeats frames, and a hold repeats one; a repeat is a hard link.

The director has its own camera: a shot's `camera` keys say where the frame looks and how far it is pushed in, and between keys it eases, so it pans and pushes in on its own path, never tied to the player. It crops the page's own picture and scales it back up, so the game never knows. The same way, `devices` turns the frame into a laptop and three phones, each showing one seat's view of the same moment, and `crossfade` dissolves a shot's start over the last shot's end. The cards the game never shows (the title slam with its drips, the end card with the chomping Groaner, the couch of four players on their phones) are pixel art drawn over the game by the harness (`tools/audit/harness/cards.ts`), on the shot's clock.

The frames are deterministic: two renders of a shot list give the same files (compare `hashes.txt`). The soundtrack is the same tune and the same sounds on the same frames, but Chrome sums a node's inputs in an order of its own, so a few samples can differ in the last bit between renders, and so can the AAC in the MP4.

## The shot list

A JSON file of clips (see `shotList.ts` for the Schema and `shots/devlog.json` for examples). A clip has a `name`, a `format` (`16:9` or `9:16`), and shots played one after another; `gif: true` adds a GIF and `music: false` drops the music. A shot has:

- `scene`: an audit harness query (`tools/audit/README.md`), with a `seed`.
- `ticks`: how long it plays, and `step`: ticks per captured frame (1 is 60 fps).
- `segments`: from and to a tick, `keys` held, a touch `move` direction, `aim` (`"nearest"` or an offset from the player) bent by `turn` degrees, and `fire`.
- `taps` (a key on a tick) and `clicks` (a CSS selector on a tick, for HTML such as the shop's rows).
- `coop`: `seed`, `preroll` ticks played before the first frame, and `difficulty`, for a room staged with `coop=host` (four seats) or `coop=arena` (three).
- `captions` (three or four words, `place` Top, Middle, or Bottom or an exact `top`, a font `tone`), `slowMotion`, `holds`, `fadeIn`, `fadeOut`, and `hideHud`.
- `skip`: ticks played before the first frame, such as the walk to the stall.
- `camera`: keys of `at`, `zoom` (1 is the whole frame), and the center `x`, `y` in game pixels of the screen (320x180, or 180x320 upright).
- `cards`: `Title`, `End`, or `Couch` over a span of ticks; `devices`: the split screen over a span; `crossfade`: frames dissolved over the last shot.
- `coop.god` keeps every seat standing, and `coop.revive` downs a seat on purpose (`down`, at `at`, after walking to `spot`), sets its bleed out clock to `bleedMs`, and from `walkAt` sends the `reviver` to stand beside it.
- `lobby`: keys of `at`, `seats`, and `ready` that seat a staged lobby (`coop=host`) one player at a time and light their READY.
- `skip` also plays out what is already animating, such as a co-op room's 3, 2, 1, GO!, on the shot's clock, so the first frame is past it.

A clip can carry its own `score`: music cues by clip frame in place of what the game cued, with the tune's `bpm`, and the render prints how far each cut lands from a beat. `loop` dissolves the clip's last frames into its first, so it plays round with no seam.
