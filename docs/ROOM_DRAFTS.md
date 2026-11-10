# Room drafts: the house plan, the dining room, the library, the cellar

Drafted 2026-11-10 for review before layers 8 to 11 of the escape build (`ESCAPE_PLAN.md`). Nothing here is built or decided. The maps use the symbol language of `src/world/level/arena.ts` (10 px tiles), with the new symbols listed under "Symbols". Every map below was checked by a script: each row is the right width, every walkable tile is reachable by a 2 by 2 tile body (the Big Lug is 13 px across, Uncle Chunk 16 px, so a 2 tile gap fits both), and all of it is one connected space.

## 1. The house plan

Five slots. Coordinates are tiles, with the dining room's top left corner at column 0, row 0. The kitchen is `KITCHEN_MAP` as it is today, unchanged, in the same place relative to the start room as it sits above the parlour now.

```
          WEST SLOT          DINING ROOM          EAST SLOT          FAR EAST SLOT
          cols -32..-1       cols 0..35           cols 36..67        cols 68..99

row -15                      +---------+ D (back door)
                            Y| KITCHEN |    yard
                             |  20x15  |
row 0                        +---KK----+--NN--+------n-------+------n-------+
                            W|                >(             )(             |
row 4     +------n-------+  W|  DINING ROOM   >(  32 x 18    )(  32 x 18    |
          |              |   |   36 x 22      ?%  rows 0-17  ?%  rows 0-17  |
          |   32 x 18    )<  <   start, table |              |              |
          |   rows 4-21  %?  ?                +------s-------+------s-------+
          |              |   |                E
row 21    +------s-------+---+--S----MMMM-----+        lawn
                                 FRONT DOOR
```

| Slot        | Footprint | Rows                     | Who goes there                     |
| ----------- | --------- | ------------------------ | ---------------------------------- |
| Dining room | 36 x 22   | 0 to 21                  | Fixed, the start                   |
| Kitchen     | 20 x 15   | -15 to -1                | Fixed, north                       |
| West        | 32 x 18   | 4 to 21 (bottom aligned) | Rolls: parlour, library, or cellar |
| East        | 32 x 18   | 0 to 17 (top aligned)    | Rolls                              |
| Far east    | 32 x 18   | 0 to 17                  | Rolls; behind the east room        |

**The boarded exits.**

| Exit                       | Where                                                                   | Opens                        | Leads to                                      |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------- |
| Kitchen (`K`)              | Dining north wall, cols 6-7                                             | Keys                         | The kitchen, as today                         |
| West (`<`)                 | Dining west wall, rows 12-13                                            | Keys                         | The west slot's `)` port                      |
| East (`>`)                 | Dining east wall, rows 8-9                                              | Keys                         | The east slot's `(` port                      |
| Far (`)` then `(`)         | East slot's east wall, rows 8-9                                         | Keys, more                   | The far east slot, only once East is open     |
| Secret shelf (`%` and `?`) | Rows 13-14 of the wall between the library and the room it faces inward | The library's twist, no keys | A second way through, for the rest of the run |
| Front door (`M`)           | Dining south wall, cols 16-19                                           | The finale                   | Out                                           |

**Why the side slots sit offset (a pinwheel).** A spawn door must face outside: `doorSpawnPoint` puts the zombie at the door's outer face plus `ZOMBIE_SPAWN_MARGIN`, so a door in a wall shared with another room would spawn inside that room. The west slot hangs off the bottom of the dining room and the east slots off the top, so the dining room keeps a stretch of outside wall on each side: West at its top left, East at its bottom right. North is top right (through the yard, as the parlour's is today) and South bottom left. The four doors go round like a pinwheel, so North and South, and West and East, are still opposite corners for the pincers in `DOOR_PAIRS`.

**Spawn doors as the house opens.** Dining 4 (North, West, East, South), the kitchen 2 (Back, Window), and 2 per slot room (its `n` and `s`), 12 with everything open. A slot room's port that faces outside (the west slot's west port, the far slot's east port) is plain wall.

**Engine constraints found.**

- **Rooms stack vertically only.** A level is one string grid (`LevelSpec.tiles`), and `KITCHEN_MAP` is padded with yard commas to the parlour's width. `topRow` can go negative but there is no column origin, so nothing can sit west of column 0. Layer 8's 2D origins fix this (or the composer shifts everything so the west slot starts at column 0). The yard should then be whatever no room covers, not hand-padded.
- **A door id has one symbol and one outward per level** (`DOOR_SYMBOLS`, `DOOR_OUTWARD`, a fixed `DoorId` literal list on the wire). A rolled room cannot carry its own door ids: its `n`, `s`, and ports are slot-neutral symbols the composer rewrites to the slot's ids (proposed: `WestTop`, `WestBottom`, `EastTop`, `EastBottom`, `FarTop`, `FarBottom`, plus `Front`). `CLOCKWISE`, `OPPOSITE_DOOR`, and `DOOR_PAIRS` (`src/world/waves/`) grow to match, with the dining room's four first so the wave tables draw what they drew before.
- **Exits are by slot too.** `ExitSpec.symbol` is per level, so the exits are `West`, `East`, `Far`, and `Secret`, never named after the room that rolled in.
- **The map gets 4.6 times bigger.** 132 x 37 tiles (4884) against today's 32 x 33 (1056). The flow field covers every walkable tile, the yard too, and is built on the frame, so this is the first perf risk in layer 8. A closed room's tiles already count as yard (`isShutAway`), so routes never bump into a shut room, but they still cost the field.
- **The secret shelf is an exit with no doors and no price.** `ExitSpec` already allows `doors: []`; what is new is an opener that is not keys (a pulled book).
- **The camera.** The dining room is 36 x 22 against a 32 x 18 screen, so the start room scrolls a little, 4 tiles each way. The parlour was exactly one screen.

## 2. Symbols

Existing: `#` wall, `N W E S` spawn doors, `D Y` the kitchen's doors, `K` the kitchen exit, `,` yard, `~` soup, and the cover `P` piano, `F` hearth, `B` bookshelf, `A` armchair, `C` couch, `T` tea table, `V` fern, `O` coffin, `U` trunk. Retired with the shop: `$` stall, `X` crates.

| New     | Meaning                                                                                     | Solid                                           |
| ------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `=`     | The party table                                                                             | Yes                                             |
| `H`     | Sideboard, china cabinet, hutch: tall wood against a wall                                   | Yes                                             |
| `i`     | Standing candelabra, one tile                                                               | Yes                                             |
| `^`     | The gap in the table under the chandelier: its drop zone                                    | No (yes while the fallen chandelier lies there) |
| `@`     | The start spot                                                                              | No                                              |
| `M`     | The front door (`Front`, never spawns)                                                      | Yes, until the finale                           |
| `<` `>` | Dining room exits to the west and east slots                                                | Until bought                                    |
| `(` `)` | A slot room's west and east ports, local rows 8-9                                           | An exit, or wall when it faces outside          |
| `n` `s` | A slot room's spawn doors, top and bottom wall; ids by slot                                 | As doors                                        |
| `%`     | The library's swinging shelf, local rows 13-14, both side walls; only the inward one swings | Until it swings                                 |
| `?`     | Plain wall that a library next door can swing open                                          | Until it swings                                 |
| `c`     | Display case spot, 2 tiles against a wall                                                   | Yes                                             |
| `t`     | Trap crate, 2 tiles                                                                         | Yes                                             |
| `1`-`4` | Hidden-item spots: stand here to search what is beside you                                  | No                                              |
| `d`     | Reading desk                                                                                | Yes                                             |
| `g`     | Globe, one tile                                                                             | Yes                                             |
| `]`     | Wine rack                                                                                   | Yes                                             |
| `o`     | Barrels                                                                                     | Yes                                             |

The digits, `@`, `c`, and `t` are review marks; in code they may be lists of spots, as the pantry's is read off its `Q` tiles.

## 3. The rooms

### The dining room (start)

```
    000000000011111111112222222222333333
    012345678901234567890123456789012345
 0  ######KK###################NN#######
 1  ######KK###################NN#######
 2  W............HHHHHHHHHH.......cc...#
 3  W.............2....................#
 4  #..................................#
 5  #..................................#
 6  #HHH.......i............i.......HHH#
 7  #HHH1...........................HHH#
 8  #..................................>
 9  #..........................3.......>
10  #.......=========^^=========.......#
11  #.......=========^^=========.......#
12  <..................................#
13  <..................................?
14  #..........i.....@@.....i..........?
15  #cc..............................cc#
16  #..................................#
17  ?..................................#
18  ?............i........i............E
19  #HH...............................4E
20  #HH......tt......................HH#
21  #####SS#########MMMM################
```

The Munches' party table, still set for a hundred years, runs down the middle in two halves with a gap under the chandelier, on the axis of the front door. A sideboard of silver against the north wall, china cabinets in the corners, candelabras round the table and flanking the front hall. The front hall (rows 15 to 20, cols 13 to 22) is kept open on purpose: it is where the crew holds while the front door unlocks.

|                  |                                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Doors**        | North (cols 27-28, from the yard), West (rows 2-3), East (rows 18-19), South (cols 5-6). Front (cols 16-19) never spawns.                                                                                                                                |
| **Lanes**        | Each spawn door opens into a lane 4 to 7 tiles across before the room: West along the north wall above the west cabinet; North between the sideboard and the case; East between the east case and cabinet; South between the cabinet and the trap crate. |
| **Kiting loop**  | The whole table, with at least 2 tiles of floor all round it. The gap makes it a figure eight.                                                                                                                                                           |
| **Chokepoints**  | The gap under the chandelier (exactly 2 wide), the four door lanes, the exits.                                                                                                                                                                           |
| **Big Lug**      | Everywhere; the gap fits him with nothing beside him.                                                                                                                                                                                                    |
| **Case spots**   | Three `cc`: by the North door, west wall, east wall.                                                                                                                                                                                                     |
| **Trap crate**   | `tt` by the South door.                                                                                                                                                                                                                                  |
| **Start**        | `@@` below the gap, facing the front door. Co-op seats round it.                                                                                                                                                                                         |
| **Hidden spots** | 1 the west china cabinet. 2 the sideboard's drawer. 3 under the far end of the table. 4 the umbrella stand by the East door.                                                                                                                             |
| **Twist**        | Shoot the chandelier's chain and it drops into the table's gap, crushing whatever stands under it; it lies there as cover, blocking the gap, until the house hoists it back up at the next break.                                                        |

### The parlour, fitted to a slot

Today's `ROOM_MAP`, changed only at its edges:

- `K` (cols 6-7) becomes wall: the kitchen now hangs off the dining room.
- `W` and `E` (rows 8-9) become the ports `(` and `)`.
- `N` (cols 21-22) becomes `n`, `S` (cols 8-9) becomes `s`: the slot's two spawn doors, ids by slot.
- `$$` (the stall) becomes a case `cc`, and the stock crates `XX` the trap crate `tt`; a second case goes in the south-west corner.
- Rows 13-14 of both side walls are `?`, clear inside, for a library next door.
- The hearth stays: the gas valve still lights it, wherever the parlour rolls. That is its twist.

```
    00000000001111111111222222222233
    01234567890123456789012345678901
 0  #####################nn#########
 1  #####################nn#########
 2  #PPP..........FFFF........BBBBB#
 3  #PPP1.......................2..#
 4  #..........A........A..........#
 5  #...TT.....A........A......TT..#
 6  #...TT.....................TT..#
 7  #..............................#
 8  (..............................)
 9  (..............................)
10  #..............................#
11  #...O3.....................VV..#
12  #...O........CCCCCC........VV..#
13  ?..............................?
14  ?.........UU4..................?
15  #..............................#
16  #cc.................tt.....cc..#
17  ########ss######################
```

Hidden spots in the parlour: 1 the piano bench, 2 behind the bookshelf, 3 the coffin, 4 the trunk.

### The library

```
    00000000001111111111222222222233
    01234567890123456789012345678901
 0  ##############nn################
 1  ##############nn################
 2  #..............................#
 3  #..............................#
 4  #..BB..BB..BB......BB..BB..BB..#
 5  #..BB..BB..BB...g..BB..BB..BB..#
 6  #..BB..BB..BB..1...BB..BB..BB2.#
 7  #..............................#
 8  (..............................)
 9  (..............................)
10  #...........dddddddd...........#
11  #..........3dddddddd...........#
12  #..............................#
13  %..............................%
14  %..BB..BB..BB......BB..BB..BB..%
15  #..BB..BB..BB......BB..BB..BB..#
16  #..BBccBBttBB......BB4.BBccBB..#
17  ################ss##############
```

Stacks of double-sided shelves, two tiles wide with two tile aisles, above and below a reading desk on the cross aisle that joins the ports. The lower stacks run into the south wall as bays.

|                  |                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lanes**        | The cross aisle (rows 7 to 9) port to port, the top aisle (rows 2-3) under `n`, the bottom aisle (rows 12-13). The aisles between stacks are exactly 2 wide.                                                                                     |
| **Kiting loop**  | Round any stack (each is an island between two aisles), and the big one round the desk.                                                                                                                                                          |
| **Chokepoints**  | Every aisle. A Big Lug fills one wall to wall, so he corks it: nothing gets past him either way, you included.                                                                                                                                   |
| **Dead ends**    | The four bays between the stacks along the south wall. Two cases and the trap crate sit at the back of bays: the reward is a risk.                                                                                                               |
| **Case spots**   | Two `cc`, at the back of the west and east bays.                                                                                                                                                                                                 |
| **Trap crate**   | `tt`, at the back of a bay.                                                                                                                                                                                                                      |
| **Hidden spots** | 1 by the globe, 2 a hollow book at the end of the north-east stack, 3 the desk drawer, 4 a bay.                                                                                                                                                  |
| **Twist**        | One book on the inward wall's shelf sticks out (it glints on Dare); stand at it to pull it and the whole shelf swings, opening a free second way into the room next door for the rest of the run, a loop through two rooms that zombies use too. |

Which wall swings: the side facing the dining room in the west and east slots, and the east room in the far slot. The neighbour's `?` tiles open with it. Every room's rows 13-14 next to the side walls stay clear for this.

### The cellar

```
    00000000001111111111222222222233
    01234567890123456789012345678901
 0  #####nn#########################
 1  #####nn#########################
 2  #.....4........................#
 3  #..............................#
 4  #..]]]]]]]]..]]]]]]..]]]]]]]]..#
 5  #...........................2..#
 6  #..............................#
 7  #..]]]]]]]]....tt....]]]]]]]]..#
 8  (.............oooo.............)
 9  (.............oooo1............)
10  #..]]]]]]]]...oooo...]]]]]]]]..#
11  #.............oooo.............#
12  #..............................#
13  ?..............................?
14  ?..]]]]]]]]..]]]]]]..]]]]]]]]..?
15  #..........................3...#
16  #cc..........................cc#
17  #######################ss#######
```

Long wine racks in rows, broken by gaps, round a block of barrels in the middle. `n` is the coal chute (a heap of coal under it), `s` the storm doors.

|                  |                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lanes**        | Five long east-west lanes between the racks (rows 2-3, 5-6, 8-9, 11-13, 15-16); the gaps in the racks (cols 11-12 and 19-20) cut across them.                                                             |
| **Kiting loop**  | The ring round the barrels and the crate (rows 7 to 12, 3 tiles of floor each side).                                                                                                                      |
| **Chokepoints**  | The rack gaps, 2 wide.                                                                                                                                                                                    |
| **Big Lug**      | Every lane and gap.                                                                                                                                                                                       |
| **Case spots**   | Two `cc`, the south corners.                                                                                                                                                                              |
| **Trap crate**   | `tt`, on top of the barrels.                                                                                                                                                                              |
| **Hidden spots** | 1 a barrel's tap, 2 a bottle that is not wine in the north-east rack, 3 a loose flagstone, 4 the coal heap under the chute.                                                                               |
| **Twist**        | Dark: only a pool round each player and the flash of each shot is lit (a baked mask, cheap per frame), so zombies show as glowing eyes until they reach the light, and the long lanes are where it bites. |

## 4. The whole house, composed

One arrangement (parlour west, library east, cellar far east), every room open, as the composer would build it. Commas are yard.

```
-15 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,############DD######,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
-14 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,############DD######,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
-13 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#QQQ..GG..GG..IIIZZ#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
-12 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#QQQ..GG..GG..IIIZZ#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
-11 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#..................#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
-10 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#...~~.............#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -9 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,Y...~~~..........RR#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -8 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,Y......LLLLLL......#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -7 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#......LLLLLL.~~...#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -6 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#.............~~~..#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -5 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#..................#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -4 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#RR...~~...........#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -3 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#....~~~...........#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -2 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#..................#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 -1 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#..................#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
  0 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,######KK###################NN#####################nn#####################nn#########################
  1 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,######KK###################NN#####################nn#####################nn#########################
  2 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,W............HHHHHHHHHH.......cc...##..............................##.....4........................#
  3 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,W.............2....................##..............................##..............................#
  4 #####################nn##########..................................##..BB..BB..BB......BB..BB..BB..##..]]]]]]]]..]]]]]]..]]]]]]]]..#
  5 #####################nn##########..................................##..BB..BB..BB...g..BB..BB..BB..##...........................2..#
  6 #PPP..........FFFF........BBBBB##HHH.......i............i.......HHH##..BB..BB..BB..1...BB..BB..BB2.##..............................#
  7 #PPP1.......................2..##HHH1...........................HHH##..............................##..]]]]]]]]....tt....]]]]]]]]..#
  8 #..........A........A..........##..................................>(..............................)(.............oooo.............)
  9 #...TT.....A........A......TT..##..........................3.......>(..............................)(.............oooo1............)
 10 #...TT.....................TT..##.......=========^^=========.......##...........dddddddd...........##..]]]]]]]]...oooo...]]]]]]]]..#
 11 #..............................##.......=========^^=========.......##..........3dddddddd...........##.............oooo.............#
 12 (..............................)<..................................##..............................##..............................#
 13 (..............................)<..................................?%..............................%?..............................?
 14 #..............................##..........i.....@@.....i..........?%..BB..BB..BB......BB..BB..BB..%?..]]]]]]]]..]]]]]]..]]]]]]]]..?
 15 #...O3.....................VV..##cc..............................cc##..BB..BB..BB......BB..BB..BB..##..........................3...#
 16 #...O........CCCCCC........VV..##..................................##..BBccBBttBB......BB4.BBccBB..##cc..........................cc#
 17 ?..............................??..................................#################ss#####################################ss#######
 18 ?.........UU4..................??............i........i............E,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 19 #..............................##HH...............................4E,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 20 #cc.................tt.....cc..##HH......tt......................HH#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
 21 ########ss###########################SS#########MMMM################,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
```

## 5. Open questions for the owner

1. **The pinwheel.** The side slots sit offset (west low, east high) so the dining room keeps outside wall for its West and East doors. The other way: the West and East doors move into the side rooms once they open (the West id moves to the west room's far wall). Simpler house, but a door that moves when you buy a room.
2. **Twelve spawn doors.** Two per slot room is a lot with the whole house open. One per room (only `n`, or only the outward port)?
3. **The secret shelf's direction.** Proposed: inward, a free loop back to the room you came from. The other way: outward, a free way into the next room ahead, skipping its boards (only possible in the east slot).
4. **The dining room's size.** 36 x 22 scrolls 4 tiles past a screen each way. Shrink to 34 x 20 (the side doors get tight against the slots), or keep it big as the start?
5. **The chandelier.** Once a wave and rehung at the break, or once a run? Does it hurt players under it (proposed: no, never, like the ovens)?
6. **The cellar's dark.** Should the ovens' and hearth's kind of light (a lit Kaboomer, a muzzle flash) light it too, and does Triple Dog Dare make the pool smaller?
7. **The far slot's price.** It is two rooms deep; 5 keys against 3 to 4 for West and East?
8. **The open front hall.** The dining room's south half is mostly floor so the hold-out has space. Too open for the early waves, when the dining room is the whole house?
