# Munch Studio

A local page for looking at the game's art and asking Claude for changes, made for someone who does not code. It draws the game's own sprites and rooms from the same modules the game uses, so what it shows is what the game draws.

```sh
bun dev
# then open http://localhost:5173/tools/studio/
# on an iPad on the same Wi-Fi: bun dev --host, then the Network address it prints
```

It is dev only: `bun run build` never includes it.

## Using it

1. Pick a tab (Zombies, Heroes, Looks, Rattles, Items, Rooms) and tap anything.
2. It opens big at the top: play, pause, step frame by frame, slow it down, show the frame before as a ghost, or stand it **next to the crew** (the player and a Groaner) to check its size.
3. Tap the big picture to drop a pin (in a room, drag over the tiles you mean), pick what kind of note it is (✏️ Change, 💡 Idea, 🐞 Something's off, ❤️ Love it), write it, and press **Send to Claude**.
4. The note shows ⏳ Waiting. When Claude has done it, it turns ✅ Done with a short reply and a picture of how it looked before, and the sprite, its card, and its tab sparkle with ✨ Updated until it is opened.

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

| File                               | What it holds                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `catalog.ts`                       | The tabs and their entries, each a sprite from the game's art modules, and the crew    |
| `block.ts`                         | The Block contract: Model, Messages, flags                                             |
| `update.ts`                        | init and update: the controls, picking, pins, sending, the notes coming back           |
| `commands.ts`                      | Saving the view and what was seen, the before picture and sending, polling the notes   |
| `view.ts`                          | The controls, the gallery's lazy cards, the room with its grid and pins                |
| `stageView.ts`, `inspectorView.ts` | The big view with its frame controls; the right side: asking, the notes, all notes     |
| `drawing.ts`, `pins.ts`, `room.ts` | Drawing helpers; pins on a picture; the manor's level and the note's picture crop      |
| `notes.ts`                         | The notes' Schemas and log, shared with the dev server and the scripts                 |
| `inbox.ts`, `resolve.ts`           | The agent's scripts                                                                    |
| `entry.ts`, `index.html`           | The page and its styles                                                                |
| `../vite/studioNotes.ts`           | The dev server's side: takes notes, answers the list, keeps and serves before pictures |

A new kind of art (a room, an escape piece, a party guest) gets an entry in `catalog.ts`, or a tab of its own.
