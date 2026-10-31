# Release video

The plan for the launch video. It is shot once co-op works (multiplayer Phase 3, with lobbies and invite codes), because "bring your friends" is the hook. Planned on 2026-10-29. Not decided until the owner signs off on the cut.

## Direction

- **One idea:** a dinner party where you are the dinner. Goofy first, gory second, never mean.
- **Silent first.** X autoplays muted, so the story must read with no sound: big pixel-font words on screen, three or four words at a time. Sound is the bonus: the game's own music and splats.
- **Hook in the first two seconds.** No logo first. Open on chaos: a door splinters, a horde pours in, four players back to back on the rug.
- **Real gameplay only.** Every shot is the game itself, recorded from scripted runs. No mockups.
- **Show, don't explain.** The same rule as the game: no feature lists, no paragraphs.

## The 30 second cut (16:9)

| Time       | Shot                                                                                                                                                                                  | On-screen words          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0 to 2 s   | The north door splinters, Groaners pour in, four players on the rug open fire                                                                                                         | (none)                   |
| 2 to 4 s   | Title slam over the fireplace, with drips                                                                                                                                             | MUNCH MANOR              |
| 4 to 7 s   | The pixel couch: four characters on phones, then four device frames joining one room code                                                                                             | BRING 3 FRIENDS          |
| 7 to 13 s  | Montage, about a second each: shotgun knockback, the Big Lug's armor flying off, a Kaboomer chain, Ankle Biters popping up, the kitchen oven belching fire, a zombie slipping in soup | (none)                   |
| 13 to 16 s | Boards smash as the kitchen opens                                                                                                                                                     | GUN OR ROOM?             |
| 16 to 19 s | Rattles' shop, the MINE! stamp, coin spray                                                                                                                                            | (none)                   |
| 19 to 25 s | Uncle Chunk. A player goes down, a teammate revives with a second left                                                                                                                | DON'T GET EATEN          |
| 25 to 30 s | End card: logo, the chomping Groaner, the URL                                                                                                                                         | FREE. PHONE OR COMPUTER. |

## Other cuts

- **9:16 vertical (1080x1920)** for TikTok, Reels, and Shorts, shot in the portrait layout, which already exists. The same beats, with tighter framing.
- **A 6 second loop** for a pinned reply: the door bursting and the horde on the rug, looping cleanly.
- **Players together, mocked (owner decision 2026-10-29).** No filmed footage. Two mocked shots instead: a short pixel-art cutscene in the game's style of four player characters (built from the character looks) squished on a couch, each holding a phone, flinching and cheering in sync with the action; and a split screen of four device frames (three phones and a laptop) showing the same room from each player's camera at the same moment, which also proves the co-op is real.

## How it is made

- **Scripted, deterministic runs.** Multiplayer Phase 0 makes the game step deterministic, so a shot is a seed plus recorded inputs that replay exactly, as many times as the edit needs.
- **Rendered offline, frame by frame.** A director mode in the audit harness steps the game one fixed tick at a time and saves each frame at a whole-number scale (crisp pixels at 1080p, no dropped frames, no capture lag). It can hide the HUD, frame the camera, and slow a moment down.
- **Audio from the game itself.** The music is data in `src/music.ts`, so it renders through an `OfflineAudioContext`, and the sound effects are placed at the frames their events fire. No licensed music.
- **Assembled with ffmpeg** from a shot list file, so a new build can re-render the whole cut with one command (`bun run video`).
- **Text overlays** use the game's own pixel font, so they match.

The first slice is built: `tools/video` (see its README) with the director mode in `tools/audit/harness/director.ts`, and four devlog clips in `tools/video/shots/devlog.json`.

The cut is built too, in `tools/video/shots/release.json`: the 30 second cut in 16:9 (`release-30s`) and 9:16 (`release-30s-vertical`), and the 6 second loop (`release-loop`). `bun run video -- tools/video/shots/release.json` renders all three. The director has its own camera (pans and push-ins), dissolves between shots, the title slam, the end card, and the four device split screen (`tools/audit/harness/cards.ts`), seats a staged co-op lobby one player at a time, and scripts a co-op seat going down and a teammate reviving it. The music is one Stampede loop at 152 bpm with every cut on a beat, ending on the Victory fanfare.

The cut as rendered (revised 2026-10-31 after the owner's notes: the kitchen table shot and the GUN OR ROOM? caption are gone, and the real co-op lobby replaces the couch):

| Time           | Shot                                                                                                                                        | On-screen words                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0 to 1.2 s     | Close up on the west door: the planks splinter and Groaners pour in                                                                         | (none)                                    |
| 1.2 to 4.0 s   | Four players on the rug open fire, the camera pulls out, and the title slams with its drips                                                 | MUNCH MANOR                               |
| 4.0 to 6.0 s   | The co-op lobby: room code MNCH7, seats filling with players in their looks and name tags on the beat, READY lighting up seat by seat       | (none)                                    |
| 6.0 to 7.2 s   | Four devices, one room: a laptop and three phones on each player's view                                                                     | BRING 3 FRIENDS                           |
| 7.2 to 11.1 s  | Montage on the beat: shotgun into a crowd, a Big Lug's armor flying, a Kaboomer burst, the Clang Pan in the melee slot with zombies reeling | (none)                                    |
| 11.1 to 12.7 s | A fridge pull: the slot machine spins and lands on BRRR                                                                                     | (none)                                    |
| 12.7 to 15.1 s | The kitchen boards smash mid-wave and the horde pours through the new doorway into a hail of fire                                           | (none)                                    |
| 15.1 to 17.8 s | Rattles' shop: three buys, MINE! stamps                                                                                                     | (none)                                    |
| 17.8 to 19.8 s | Uncle Chunk winds up a stomp                                                                                                                | (none)                                    |
| 19.8 to 24.9 s | Co-op: a player goes down and a teammate revives them with about a second left                                                              | DON'T GET EATEN                           |
| 24.9 to 30 s   | End card: logo, the chomping Groaner, the Victory fanfare                                                                                   | FREE. PHONE OR COMPUTER. / MUNCHMANOR.COM |

Where the cut differs from the plan above:

- **The opening is two shots.** The west door splinters in close up (the chewers are staged at the west door, not the north one), then the four players on the rug open fire.
- **The couch is out.** The real lobby shows the same thing, friends joining, without a mock. The couch card is still in `cards.ts` for other cuts.
- **The montage shows one Kaboomer burst, not a chain**, and no Ankle Biters: one is a few pixels at full frame.
- **Uncle Chunk and the revive are two shots.** The boss fight is single player; the revive is a co-op room on Hard.
- **The vertical cut is pushed in on the room's window**, so the portrait layout's HUD band and thumb area are cropped away during play.

## Before the shoot

- **Now, while co-op is built:** short devlog clips to build an audience. The parlour before and after, Rattles' MINE! stamp, and portrait play all make good 10 second posts. These need only the director mode, not co-op.
- **Needed from co-op:** four-player rooms, room codes, revives, and teammate avatars at the edge.
- **Needed from the owner:** the X account to post from. The end card shows munchmanor.com.

## Copy

Short, in the game's voice, with the link and the video. For example: "We made a co-op zombie game you play in your browser. Bring 3 friends. Try not to get eaten." Then the link. The reply carries the 6 second loop and "free, no download, phone or computer".
