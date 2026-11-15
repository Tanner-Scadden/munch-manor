# Munch Studio

A local page for looking at the game's art and asking Claude for changes, made for someone who does not code. It draws the game's own sprites and rooms from the same modules the game uses, so what it shows is what the game draws.

```sh
bun dev
# then open http://localhost:5173/tools/studio/
# on an iPad on the same Wi-Fi: bun dev --host, then the Network address it prints
```

It is dev only: `bun run build` never includes it.

## Using it

1. Pick a tab (Zombies, Heroes, Looks, Rattles, Items, Rooms) and tap anything. The Rooms tab opens on **3D**: the manor as the game draws it, lit, through its own 3D renderer. Pick the room to stand in, the mood (a break's warm light, a wave early and late, a frenzy, Uncle Chunk), the zombies (none, a crowd, a lineup of sizes), a lightning strike, the chandelier down, flat bodies to compare, and the HUD. **📌 Pin** picks tiles for a note as below; **🔍 Loupe** shows the pixels under the pointer big, each square one game pixel, ringing in magenta any that are mixed (a half-pixel edge, a soft rim), with its spot, tile, and color. Beside 3D it shows the manor and the escape's drafted rooms (the dining room, the library, the cellar), each with its toggle: the kitchen boarded or open, the chandelier hung or fallen, the secret shelf shut or open. The Items tab's Dare things holds every thing the dare can ask for, big and as its HUD icon (the napkin ring, the dare note, the false teeth, and the invitation are the four the Dare Journal's milestones open), and the journal's own icon. Its Dare marks holds the dare ladder's eight badges.
2. It opens big at the top: play, pause, step frame by frame, slow it down, show the frame before as a ghost, or stand it **next to the crew** (the player and a Groaner) to check its size.
3. Tap the big picture to drop a pin (in a room, drag over the tiles you mean), pick what kind of note it is (✏️ Change, 💡 Idea, 🐞 Something's off, ❤️ Love it), write it, and press **Send to Claude**.
4. The note shows ⏳ Waiting. When Claude has done it, it turns ✅ Done with a short reply and a picture of how it looked before, and the sprite, its card, and its tab sparkle with ✨ Updated until it is opened.

5. Any sprite tab's **🧊 Blocks** stands the picked thing carved in blocks on a lit floor, through the game's own 3D renderer and carve. Drag to turn it, **🔄 Spin** to turn it by itself, **🎮 Game camera** to look from the game's 49°. The presets light it as the manor would: a break, a wave, the frenzy, the dread, beside a candle, under the chandelier, in the cellar's dark by a flashlight, in a lightning strike. A tap on a block pins the sprite pixel it was carved from.
6. **🎨 Light lab** (under the stage, or over a live room) has a slider or a color for every value of the look (`lookSpecs.ts`), the flames (`lightSpecs.ts`), and the moods' ambient (`mood.ts`). The stage and the live room change as you slide. **Propose these** sends a note with each value as shipped and as slid, by file, and **Reset** puts them back. Nothing changes the game until an agent lands the note.

Every note is listed under **All your notes**; tap one to go back to what it is about. The view survives a reload, so an art change (which reloads the page) lands back where it was.

## For the agent

```sh
bun tools/studio/inbox.ts            # the open notes: what, where its pixels live, the pin, the before picture
bun tools/studio/inbox.ts --all      # every note, done ones with their reply
bun tools/studio/resolve.ts n3 "Bigger lid, and it wobbles now"   # mark a note done, with a short reply
```

A sprite note's pin is in the sprite's own pixels from its anchor (its feet, centered). A room note picks a block of tiles (a drag over the room), and the inbox prints the map's letters under it. Make the change, check it in the page (it reloads by itself), then resolve the note with a reply in the game's own plain, short voice. The page picks the reply up within two seconds.

The log is `tools/studio/notes.jsonl` (events, one JSON line each: `Noted` and `Resolved`), and before pictures are `tools/studio/before/<id>.png`. Neither is committed.

## Files

| File                               | What it holds                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.ts`                       | The tabs and their entries, each a sprite from the game's art modules, and the crew                                                                  |
| `block.ts`                         | The Block contract: Model, Messages, flags                                                                                                           |
| `update.ts`                        | init and update: the controls, picking, pins, sending, the notes coming back                                                                         |
| `commands.ts`                      | Saving the view and what was seen, the before picture and sending, polling the notes                                                                 |
| `view.ts`                          | The controls, the gallery's lazy cards, the room with its grid and pins                                                                              |
| `stageView.ts`, `inspectorView.ts` | The big view with its frame controls; the right side: asking, the notes, all notes                                                                   |
| `drawing.ts`, `pins.ts`, `room.ts` | Drawing helpers; pins on a picture; the Rooms tab's rooms, their toggles, and the note's picture crop                                                |
| `liveScene.ts`                     | The live room's scene (the room, the mood, the bodies, the storm, the chandelier) and the audit harness's query for it                               |
| `worldStage.ts`, `bridge.ts`       | `<studio-world>`: the harness in a frame, the marks over it, the loupe, and the note's picture; what the harness hands it (its camera and pixels)    |
| `stage3d.ts`, `stagePresets.ts`    | `<studio-stage>`: one sprite carved on a lit floor by the game's renderer, the turntable, the pins on blocks; the light presets as the game's lights |
| `lab.ts`, `labView.ts`             | The light and color lab: a control per value, the edits made into the renderer's tables, the proposal note; its panel                                |
| `draftRooms.ts`                    | The escape's drafted rooms (`docs/ROOM_DRAFTS.md`): their maps, laid out with the game's walls and doors and the rooms' art                          |
| `notes.ts`                         | The notes' Schemas and log, shared with the dev server and the scripts                                                                               |
| `inbox.ts`, `resolve.ts`           | The agent's scripts                                                                                                                                  |
| `entry.ts`, `index.html`           | The page and its styles                                                                                                                              |
| `../vite/studioNotes.ts`           | The dev server's side: takes notes, answers the list, keeps and serves before pictures                                                               |

A lab proposal names each value by its path (`LOOK.rooms.Dining.light: 0x... -> 0x...`) under the file that holds it: copy the new numbers in. `bun run heavy -- --shared bun tools/audit/studioLab.ts` (with `STUDIO` set to the dev server's Studio) checks the stage, a pin, the lab, and a proposal in Chrome.

A new kind of art (a room, an escape piece, a party guest) gets an entry in `catalog.ts`, or a tab of its own.
