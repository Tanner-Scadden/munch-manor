# Room research: why the rooms feel the same, and what to do about it

Written 2026-11-10 as research for the owner. The owner's picks are in "Decided (2026-11-10)" at the end; the build is layers 19 to 21 of [`ESCAPE_PLAN.md`](./ESCAPE_PLAN.md). It reads the rooms as they stand on the escape stack (`src/world/level/plan.ts`, `docs/ROOM_DRAFTS.md`, "Escape the manor" in `GAME_DESIGN.md`), compares them with how other wave and house games build rooms, and proposes a change for each room.

The owner's brief: "Every room looks a bit different, but at the same time, it's the same. ... It's very important for us to nail this part." And: the breaks are for catching your breath, so things should happen during waves too.

**The short answer.** The three slot rooms share one template: the same 32 by 18 box, the same doors in the same places, the same cases in the same corners, four hiding spots each, and a mostly open floor. Their twists are mostly passive (the cellar's dark is cosmetic), one-shot (the shelf swings once a run), or live in another room (the parlour's fire is lit from the kitchen). And most of what a room offers happens in the break. So a room changes how the fight _looks_, not what you _do_. The fix is to give each room one verb you use mid-wave, a shape of its own inside the slot, and a way of finding its dare thing that belongs to it.

## 1. Principles

The ten that matter most here, each with where it comes from.

### P1. Each room has one verb you do mid-fight

A room is remembered for what you did in it, not what it held. Luigi's Mansion is built room by room, and its best rooms are puzzles about the room's own ghost (open the curtains on the ghost at the desk, steal the knitting grandma's wool). Nintendo made a house where "the most 'identical' rooms were two toilets". Hades keeps traps "a supplementary part of encounters", but each biome's traps are its own (magma and smoke in Asphodel). Our kitchen already proves this: you shoot ovens and skid zombies on soup.

- Luigi's Mansion: [Lit and Play review](https://litandplay.com/luigis-mansion/game-reviews/), [N-Europe](https://n-europe.com/features/all-gamecube-games-1-luigis-mansion/), [Gaming Reinvented](https://gamingreinvented.com/review/luigis-mansion-an-underrated-mario-classic/)
- Hades: [Ed Gorinstein's level design thread](https://threadreaderapp.com/thread/1311777010239193088.html), [Kotaku write-up](https://kotaku.com/hades-level-design-is-less-random-than-it-seems-1845254545)

### P2. Shape is identity; dressing is not

Josh Bridge (Dead Rising 2) warns that when cover pieces repeat, "the player starts to see the game and not the world. The player can see the Combat Zone coming." Giant Bomb's one line on Zombie Estate 2's maps is that they have "no special features other than slightly different layouts and aesthetics". Supergiant tried modular rooms and found it "more effort to try and make a room modular versus just making more rooms". A new palette on the same box reads as the same room.

- [Anatomy of a Combat Zone, Game Developer](https://www.gamedeveloper.com/design/anatomy-of-a-combat-zone)
- [Zombie Estate 2, Giant Bomb](https://giantbomb.com/wiki/Games/Zombie_Estate_2)
- [DigiPen interview with Ed Gorinstein](https://www.digipen.edu/showcase/news/eduardo-gorinstein-delivers-challenge-and-fun-hades)

### P3. Every room needs a loop, and each loop should feel different

CoD Zombies players judge a map by its training spots: Kino's stage is "the best training spot", and a tier list argues maps without good training areas "rank lower". Der Riese's Bowie Knife room is loved because it has a wall gun, a teleporter, and "several exits in case you get overwhelmed". Dead by Daylight names its loops by type (T and L walls, shacks, jungle gyms, long walls), and players feel the difference between them. Brotato's whole arena is a loop: circle it and you pick up everything.

- [Kino der Toten wiki](https://call-of-duty-nazi-zombies.fandom.com/wiki/Kino_der_Toten), [ZombiesCodex Kino guide](https://www.zombiescodex.com/black-ops/kino-der-toten/), [CoD map tier list](https://virtual.usj.ac.cr/cod-zombies-map-tier-list/)
- [Der Riese camping, training, and loops (forum)](https://www.callofdutyzombies.com/topic/152874-der-riese-camping-training-and-map-loops/)
- [DbD tiles guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2904838739), [DbD map layouts and tiles](https://progameguides.com/dead-by-daylight/how-to-loop-all-map-tiles-in-dead-by-daylight/)
- [Rogueliker on Brotato's arenas](https://rogueliker.com/bullet-heaven-games-like-vampire-survivors/)

### P4. Mix strong and weak space, and spread the strong

DbD players' main complaint is strong tiles chained together; the fix they ask for is to "spread out strong tiles ... but in between ... put unsafe/weaker tiles". Their other complaint is "dead zones", stretches with nothing to use. The Level Design Book says chokepoints bound territory, and none should be coverable from one spot. A room that is all open floor is a dead zone with walls.

- [What is good map design in DbD (BHVR forum)](https://forums.bhvr.com/dead-by-daylight/discussion/341609/what-is-considered-good-map-design-in-dbd), [Dead zones and trash loops](https://forums.bhvr.com/dead-by-daylight/discussion/401828/dead-zones-and-trash-loops)
- [The Level Design Book: Map balance](https://book.leveldesignbook.com/process/combat/balance)

### P5. Less cover, better cover

The Level Design Book: "often less cover is better"; "most arcade games are about moving around cover". More cover slows the fight. Epic's designers call an open arena a "combat bowl", built for a "spinning, rotating flow". Andrew Yoder: convex corners make the best cover, and an arena that pushes the player out needs "a foothold of cover" to draw them in. For a twin-stick game, cover is mostly a thing to circle and to break a line of zombies on, not to hide behind.

- [The Level Design Book: Cover](https://book.leveldesignbook.com/process/combat/cover)
- [The Door Problem of Combat Design, Andrew Yoder](https://andrewyoderdesign.blog/2019/08/04/the-door-problem-of-combat-design/)
- [Hullett and Whitehead, Design Patterns in FPS Levels](https://users.soe.ucsc.edu/~ejw/papers/hullett-fps-fdg2010.pdf)

### P6. Every door must lead to something worth buying

Players of CoD custom maps hate "no reason to buy the door near the pool when quick revive is in the other one", and "massive expanses of nothing you gotta run between". In Isaac, every floor has four core rooms (treasure, boss, shop, secret), each with its own job. A room you pay 55 keys for should change your run the moment it opens, not only hold the list's next thing.

- [CoD custom map review comments (Steam)](https://steamcommunity.com/sharedfiles/filedetails/comments/3020277242), [another](https://steamcommunity.com/sharedfiles/filedetails/comments/2037701309)
- [Edmund McMillen: Binding of Isaac gameplay explained](http://edmundmcmillen.blogspot.com/2011/09/binding-of-isaac-gameplay-explained.html)

### P7. Put the reward at the end of a risk

Enter the Gungeon puts most chests "at the end of a one way loop, or deep enough into the level to force you to fight many rooms". Its rooms are hand-made and replayed until fun, then placed by rules; enemy rooms are "reasonably spaced with breather rooms". The library's bays already do this (cases at the back of dead ends). It should be the rule for where dare things hide.

- [Dungeon generation in Enter the Gungeon, Boris the Brave](https://www.boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon/)
- [Q&A: the guns and dungeons of Enter the Gungeon](https://www.gamedeveloper.com/design/q-a-the-guns-and-dungeons-of-i-enter-the-gungeon-i-)

### P8. A room should escalate inside a wave

Left 4 Dead's director tracks each player's intensity and runs build up, peak, and relax, with crescendo events the players set off themselves ("low probability + high drama = memorable"). Hades' Asphodel rooms start "relatively calm", and new dangers switch on as each wave of foes falls. Risk of Rain's teleporter is a holdout you choose to start. Our waves already have a sawtooth (`src/world/waves/pacing.ts`); the rooms do not join in.

- [Mike Booth, Replayable Cooperative Game Design: Left 4 Dead (GDC 2009 slides)](https://cdn.fastly.steamstatic.com/apps/valve/2009/GDC2009_ReplayableCooperativeGameDesign_Left4Dead.pdf), [Shacknews on the talk](https://www.shacknews.com/article/57892/left-4-dead-at-gdc), [11 secrets of the AI Director](https://www.cs.drexel.edu/~so367/teaching/2012/CS680/papers/11%20Secrets%20about%20LEFT%204%20DEAD%e2%80%99s%20AI%20Director%20and%20its%20Procedural%20Zombie%20Population%20%7c%20AiGameDev.com.pdf)
- [Crescendo Event, L4D wiki](https://left4dead.fandom.com/wiki/Crescendo_Event), [Risk of Rain 2 teleporter](https://riskofrain2.wiki.gg/wiki/Teleporter)

### P9. A holdout is better when it moves

L4D players find plain holdouts dull ("a conveniently defendable area, typically with a minigun"), and like gauntlets because they "provide just enough pressure". The Park's crescendo makes you race a fenced maze to switch off an alarm. A mid-wave room verb should pull the player to a spot and back, not let them stand on it.

- [Steam discussion on gauntlets and finales](https://steamcommunity.com/app/550/discussions/0/4848777260028252864/), [The Park](https://left4dead.fandom.com/wiki/The_Park)

### P10. The house should knot together as you open it

The Spencer Mansion is "a giant puzzle box you solve from the inside out": as it opens, you learn quicker, safer routes. Kino hides Pack-a-Punch behind teleporters, and the teleporter doubles as a panic button. Mark Brown's Boss Keys graphs show a good dungeon folds back on itself rather than running in a line. Our secret shelf is this exactly; it is the only one.

- [Atomicbobomb on the Spencer Mansion](https://atomicbobomb.home.blog/2021/10/19/resident-evil-remake-the-spencer-mansion/), [GamesRadar, Hostile Architecture](https://www.gamesradar.com/hostile-architecture-resident-evils-spencer-mansion-wants-to-kill-you/), [Recursive Unlocking](https://horror.dreamdawn.com/?p=81213)
- [Mark Brown, how the Boss Keys graphs work](https://www.patreon.com/posts/how-my-boss-key-13801754), [Lock and key dungeons, Boris the Brave](https://www.boristhebrave.com/2021/02/27/lock-and-key-dungeons/)

### P11. A secret must be readable before it is found

Isaac's tinted rocks are "discernible but subtle", pushing players to check every corner, and its secret room rules keep the entrance clear of rocks and spikes. Luigi's Mansion hints at each portrait ghost's puzzle through the ghost's own habits. A find feels good when you _noticed_ something, then _did_ something, then _got_ something.

- [Zelda's legacy in Isaac, The Gemsbok](https://thegemsbok.com/art-reviews-and-articles/video-game-reviews-mid-week-mission-the-binding-of-isaac-rebirth-edmund-mcmillen/), [Isaac Secret Room rules](https://bindingofisaacrebirth.wiki.gg/wiki/Secret_Room)

### P12. Size the room to the screen and the speeds

Brotato's small fixed arena lets you "have a good idea where enemies are"; Vampire Survivors' endless fields lose track of items. Zombie Estate 2's fans steer you to fight in the central hallway and outdoors, since in its small rooms "it is easier to get overwhelmed", and they split on whether newer maps are "too small, with few places to dodge". Our numbers: the landscape view is 320 by 180 (`src/shared/constants.ts`), exactly one slot room. The player runs 72 px a second, so a slot room is 4.4 s across and 2.5 s top to bottom. Groaners walk 16 to 28 px a second, Hotfoots 44 to 52. Portrait shows 180 px across (`src/render/screen.ts`), so every room scrolls sideways on a phone held upright.

- [Brotato vs Vampire Survivors](https://steamcommunity.com/app/1942280/discussions/0/3807278817571243827/), [Brotato analysis](https://note.com/kurisiro_tumugi/n/nb76d92dcabc7?hl=en)
- [Estate map, ZE wiki](https://zombie-estate.fandom.com/wiki/Estate), [ZE2: A Master Class (Steam guide)](https://steamcommunity.com/sharedfiles/filedetails/?id=2553653365)

**Not used.** Searches on Don't Starve Together, and on Treyarch's own design talks about Mob of the Dead and Origins, found no design writing worth citing; [Blundell's Mob of the Dead interview](https://callofduty.fandom.com/wiki/User_blog:Damac1214/Mob_of_the_Dead_Development_Interview) only says "location, location, location".

## 2. Audit: what makes the rooms "the same"

The numbers below are from the maps in `src/world/level/plan.ts`. "Cover" counts solid furniture tiles over all walkable and furniture tiles.

| Room    | Size    | Cover | Spawn doors               | Twist                                            | When the twist acts                                    |
| ------- | ------- | ----- | ------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Dining  | 36 x 22 | 15%   | N, W, E, S (one per side) | Chandelier drops into the table's gap, 60 damage | Once a wave, rehung at the break                       |
| Kitchen | 20 x 15 | 19%   | Back door, window         | Ovens belch when shot; soup skids zombies        | Any time (oven cooldown 8 s)                           |
| Parlour | 32 x 18 | 12%   | `n` top, `s` bottom       | Hearth fire, lit by the kitchen's gas valve      | Only once someone turns the valve in another room      |
| Library | 32 x 18 | 22%   | `n` top, `s` bottom       | Red book swings the shelf open                   | Once a run                                             |
| Cellar  | 32 x 18 | 23%   | `n` top, `s` bottom       | Dark, pools of light                             | Always, but cosmetic only (`src/render/cellarDark.ts`) |

**1. One template for three rooms.** Every slot room is the same box: 32 by 18 tiles, ports in rows 8 and 9 of both side walls, `n` in the top wall, `s` in the bottom, rows 13 and 14 of the side walls kept clear for a shelf, two `cc` cases in the bottom corners, a `tt` crate, and four hiding spots (`PARLOUR_SLOT_MAP`, `LIBRARY_MAP`, `CELLAR_MAP`). The rolling rule ("Rooms that roll", `GAME_DESIGN.md`) needs every room to fit any slot, so the footprint and the edges were fixed first and each room filled in afterwards. That is the root of the sameness (P2).

**2. Every room is the same shape: a rectangle with a clear ring round its edge.** All three slot rooms keep a 1 to 2 tile ring of floor along every wall and the cross aisle between the ports (rows 7 to 9) open. So every room has the same loop (round the edge), the same straight run port to port, and the same safe middle. None is L-shaped, split in two, or built round a feature you must go round (P3, P5).

**3. The library and the cellar are mirror images left to right.** Both are built in symmetric bands (shelf, aisle, shelf; rack, lane, rack). A symmetric room has no "this side" and "that side" to learn or call out in co-op. The parlour is the old start room with its edges changed, so it is mostly open floor at 12% cover (P4).

**4. Doors behave the same in every room.** Two spawn doors, top and bottom, zombies walk in at the same speed (`ZOMBIE_ENTRY_SPEED`), and every room's doors join the same wave tables. A room never changes _how_ zombies come, only _where from_ (P6).

**5. The twists are passive, one-shot, or elsewhere.**

- The parlour's fire is lit from the kitchen (`src/world/kitchen/gasValve.ts`), so the parlour on its own has no twist.
- The library's shelf is used once a run (`src/world/library/secretShelf.ts`); after that it is a doorway.
- The cellar's dark changes what you see, never what you can do. The design doc keeps it "cosmetic only".
- The chandelier is the one mid-wave tool in a slot-free room, and it fires once a wave (`src/world/dining/chandelier.ts`).
- Only the kitchen gives a verb you can use again and again in a wave (P1).

**6. The rooms feed the breaks, not the waves.** Crates open each break, the pantry stocks each break, the stove offers a perk each break, the chandelier rehangs at the break, Rattles' hints and the sparkles come in the break, and mending traps is a break job. In a wave, every slot room is just floor. This is the opposite of the owner's ask (P8, P9).

**7. Finding the dare thing is walking onto it.** A thing lies on one of a room's four hand-picked spots, and walking onto it finds it (`src/world/dare/dare.ts`). The spots sit beside furniture (a coffin, a trunk, a desk drawer, a barrel's tap), but nothing is opened, pulled, lit, or solved. On Dare the thing sparkles in a break, so the hunt is a walk. The find has no "notice, act, get" beat (P11), and the room's own identity plays no part in it.

**8. Opening a room adds space, not a change.** Behind 55 keys (90 for the far room) you get floor, a case, a crate, and two more spawn doors. Besides the shelf, no opened room changes the rest of the house: no shortcut, no new tool in the dining room, no new route (P6, P10). The kitchen is the exception, through the gas valve and the stove.

**9. The dining room is big and open where it matters least.** At 36 by 22 it is larger than a screen, and its south half (the front hall) is kept open for the finale. For the first waves, while it is the whole house, that is a lot of open floor with one loop (the table). This is open question 8 in `docs/ROOM_DRAFTS.md`.

**What already works and should be kept.** The kitchen (two live hazards, its own doors, its own feats). The party table as a figure-eight loop with a 2 tile gap. The library's tight aisles that a Big Lug corks, and its bays with prizes at the back. The secret shelf as an idea. The cellar's long lanes. The pinwheel of doors.

## 3. A proposal for each room

Each room gets one verb, a shape that is its own inside the 32 by 18 slot, a tool used in waves, a find that uses the verb, and a change to the rest of the house when it opens. The slot edges stay as they are (ports in rows 8 and 9, `n` and `s` where they are, rows 13 and 14 of the side walls clear), so rolling still works; the shapes are carved inside with interior wall (`#`), which costs nothing new in the engine.

Sizes below are in tiles. A loop's lap time is for the player at 72 px a second.

### The dining room: TURN THE TABLE (the hub where the party never ended)

**Identity.** The room you always come back to. Its verb is the loop: you circle the table while the guests chase you round it, as at every bad dinner party.

**Shape.** Keep the figure eight round the table (about 58 tiles a lap, 8 s). Close up the open front hall a little for the early waves: two pairs of candelabras on the hall's edges, so the south half is a "foothold" (P5) rather than a field. Consider 34 by 20 (open question 4 in the drafts) so the room is close to one screen.

**Wave tool: the chandelier's rope.** Today a shot drops it once a wave and the house rehangs it at the break. Instead, put its rope on a cleat on the west wall: stand at the cleat for 3 s in a wave to winch it back up, so you can drop it again. The winch is a gauntlet in miniature (P9): you leave the loop, stand still while zombies close in, and the payoff is another crush. Keep "it never hurts a player".

**Dare thing.** None (decided: the dining room holds none, since you start there).

**When opened.** It is open from the start. Its job is to change as the house opens: each room's opening adds something to the dining room (see each room's "when opened"), so the hub reads the whole run.

### The kitchen: HEAT AND SLIP (dinner is still cooking)

**Identity.** Already the strongest room: shoot an oven, it belches fire; zombies skid on soup.

**Shape.** Keep it. It is the only room that is not 32 by 18, and it plays like it.

**Wave tool.** Add one: a shot pot of soup on the stove spills a fresh puddle in front of it (one pot a wave). This turns the soup from map dressing into a choice you make in the fight, and pairs with the ovens: skid them into the flames.

**Dare thing: the dumbwaiter.** One of its spots becomes the dumbwaiter hatch. Hold at it for 2 s and the car rises with a ding; the thing is on the tray (or a gag: a cold roast, a key). The hold in the hottest room is the risk.

**When opened.** Already gives the valve and the stove. Add: the dumbwaiter has its other end in the dining room's sideboard, so a thing sent down (a heart from the pantry) can be picked up in the hub. Cheap to cut if it is too much.

### The parlour: THE GRAMOPHONE (the party's dance floor)

**Identity.** Today the weakest room: the old start room with its edges changed, 12% cover, and a fire lit from elsewhere. Make it the party's ballroom: the open floor is the point, a "combat bowl" (P5) where the waves are biggest and the loop is the widest.

**Shape.** A round dance floor in the middle (a rug, no cover), ringed by the furniture as a broken circle: piano, sofa, armchairs, the coffin, with four gaps. The ring is the loop (about 70 tiles, 10 s). The hearth stays on the north wall. Doors stay at `n` and `s`, so zombies enter on the ring and are drawn to the floor.

**Wave tool: wind the gramophone.** A gramophone on a side table by the ring. Hold at it for 2 s to wind it; for 10 s it plays a scratchy foxtrot, and Groaners in the parlour stop chasing and shuffle in a waltz toward it at half speed, a crowd on the dance floor to mow down. Big Lugs and Uncle Chunk ignore it. Zombies who reach it knock it over and it needs winding again. It is a lure you must leave the loop to set (P9). The music box on the dare list can answer it as a gag (its tune plays when found in here).

**Dare thing: inside the piano.** Its spots become the piano (lift the lid), the coffin (it creaks open), the trunk, and the hearth's ash. Each is a 1 s rummage, and the piano plays a sour chord when its lid lifts. The ash can be searched only while the fire is out, and the fire burns for the rest of the run once lit, so a crew that turns the kitchen's valve before searching the hearth has buried that spot (the thing then moves to another spot): a small puzzle that ties the parlour to the kitchen's valve, and no fire ever hurts a player.

**When opened.** The hearth's flue warms the dining room: no rule, just the parlour's music faintly playing in the hub. Cosmetic, cheap, and it tells the player the house is waking up.

### The library: TOPPLE (the stacks have been waiting for a reader)

**Identity.** The maze. Tight aisles where a Big Lug corks the way, bays with a reward at the back (P7). Its verb should be about the shelves themselves.

**Shape.** Break the mirror. One side keeps the double stacks with 2 tile aisles (the maze); the other side is a reading nook: an open corner with the desk, the globe, and windows, a breather to retreat to. Players learn "the stacks" and "the nook" and call them out in co-op.

**Wave tool: topple a stack.** Each free-standing stack has a lean (drawn as a crooked top). Walk into a stack's end in a wave and it topples along its aisle like a domino, crushing the zombies in that aisle and lying there as a wall for the rest of the wave, so the maze changes shape as you fight. The house rights them at the break, as it rehangs the chandelier. Two or three stacks lean; the rest are fixed, so it never seals the room.

**The secret shelf.** Make it revolving, as in every old film: walking into the red book spins the shelf, and the player comes out in the next room. Zombies who follow get spun back. Usable any time, by anyone, with a short cooldown. This keeps the "decided" shelf but makes it a tool you use in waves rather than a door you open once.

**Dare thing: the book that is not a book.** Its spots become books that stick out of the stacks, one glinting more than the rest. Pull one (walk into it): a wrong book drops a moth or a key; the right one is hollow, with the thing inside. It uses the room's own verb (pull a book) and rewards looking (P11).

**When opened.** The shelf links two rooms both ways. That is already the right change (P10).

### The cellar: ROLL THE BARREL (the wine is a hundred years old)

**Identity.** The dark, long-lane room. Its long east-west lanes (five of them) are its shape; make them the verb.

**Shape.** Keep the racks in lanes, but make the lanes differ: two long lanes that run the room, one short lane with a dead end at the coal heap, and the barrel block off centre so the ring round it is lopsided (a long side and a short side).

**Wave tool: roll a barrel.** The barrel block holds 3 barrels a wave. Stand at the block's end and push: a barrel rolls down the lane it faces like a bowling ball, knocking down every zombie in the lane and breaking at the far wall in a splash of old wine (cosmetic, or a short slip like soup). In the dark, you hear it rumble and see eyes go down. It uses the lanes, the dark, and the dinner party at once.

**The dark in play.** Today it is cosmetic only. A light tool would give it teeth without a new rule for zombies: the bare bulb's pull chain, which you yank in a wave to light the whole cellar for 8 s, then it flickers out. Rattles can heckle about the electric bill.

**Dare thing: only in the light.** Its spots are in the dark, and the thing glints only inside a pool of light, a muzzle flash, or with the bulb on. You find it by lighting it: shoot near it, or yank the chain and look (P11).

**When opened.** The cellar's fuse box. Opening the cellar lets a player throw it once a wave (hold 2 s) to flicker every light in the house: zombies everywhere stagger for a second. One tool in one room that reaches the whole house (P6, P10).

## 4. Order of build

Ranked by impact for effort. Effort is rough: S is a day or less, M a few days, L a week or more.

| #   | Change                                                                                                                                           | Impact | Effort | Changes a "Decided" rule?                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Reshape the slot rooms inside their footprint: break the library's and cellar's mirror, give the parlour its ring, vary the case and crate spots | High   | S to M | No. Maps are data; the slot edges stay. Re-check reachability with the drafts' script and re-run the balance smoke pass.     |
| 2   | A wave verb for each slot room: gramophone, toppling stacks, rolling barrels                                                                     | High   | M each | No new decided rule, but each is a new trap-like World rule, so `test:full` and a balance pass per room.                     |
| 3   | The chandelier's winch (reuse in a wave)                                                                                                         | Medium | S      | Touches open question 5 in the drafts ("once a wave"), which is the owner's call.                                            |
| 4   | A find for each room: rummage, pull a book, light it, the dumbwaiter                                                                             | High   | M      | **Yes.** "Walking onto a thing finds it" (`src/world/dare/dare.ts`, the dare's rules in `GAME_DESIGN.md`).                   |
| 5   | The revolving shelf                                                                                                                              | Medium | S to M | **Yes.** "A secret shelf swings open for the run" (`GAME_DESIGN.md`, "The library and the cellar").                          |
| 6   | The cellar's bulb chain and the light-only find                                                                                                  | Medium | M      | **Yes.** "The light is baked images, cosmetic only." Light would become a World fact (the bulb's state), not only a drawing. |
| 7   | Each opened room adds to the hub or the house: the fuse box, the dumbwaiter's other end                                                          | Medium | M      | No, but it is new scope; cut first if time is short.                                                                         |
| 8   | The kitchen's spilt pot                                                                                                                          | Low    | S      | No.                                                                                                                          |
| 9   | Shrink the dining room's front hall, or the whole room to 34 by 20                                                                               | Medium | S      | Touches drafts' open questions 4 and 8. The finale's hold-out needs a check.                                                 |
| 10  | Rooms with footprints of their own (an L-shaped cellar, a long thin library)                                                                     | High   | L      | **Yes.** "Rooms that roll" into same-size slots. Would need slots per room shape, or a room that fits only some slots.       |

Every mid-wave tool should share one shape of rule so it is cheap to build and to teach: stand or hold at a marked spot (the same stand or hold as the boards, `src/world/shop/purchase.ts`), it acts, it has a cooldown or a count per wave, it never hurts a player, and a zombie can spoil it. That is how the gas valve and the stove already work.

Watch the frame. Toppled stacks and rolled barrels change solid tiles mid-wave, as the fallen chandelier does (`LevelState.dropped`). The flow field is built each frame over the whole house (the drafts' "first perf risk"), so each new drop should reuse the drop mechanism and be checked with `bun run perf:check`.

## 5. Questions for the owner

1. **How is a dare thing found?**
   - (a) Walk onto it, as now.
   - (b) A short rummage at its spot (hold about 1 s), the same in every room.
   - (c) Each room its own way: rummage in the parlour, pull a book in the library, light it in the cellar, the dumbwaiter in the kitchen. (Recommended)
   - (d) (c), plus wrong spots hold a small gift (a key, a gag) so every search pays a little.

2. **How much may a room's shape break the slot template?**
   - (a) Keep 32 by 18 and the edges; reshape inside only. (Recommended for now)
   - (b) Let a room fit only some slots (a long room only in the far slot), so rolling has fewer arrangements.
   - (c) Give each slot its own size and make rooms per slot, dropping "any room in any slot".

3. **How often can a room's wave tool be used?**
   - (a) Once a wave, reset at the break (like the chandelier now).
   - (b) A cooldown of about 15 to 20 s, any number of times.
   - (c) Charged by kills in that room, as the stove's feat is.
   - (d) A mix: the strong ones (topple, fuse box) once a wave, the small ones (gramophone, barrels) on a cooldown.

4. **Should the cellar's dark matter in play?**
   - (a) No, keep it cosmetic.
   - (b) Only through a tool: the bulb's chain lights it for a while. (Recommended)
   - (c) Yes: zombies in the dark are a little faster, or the thing shows only in light.

5. **What is the parlour?**
   - (a) The dance floor with a gramophone that makes zombies waltz. (Recommended)
   - (b) A séance room: a planchette you work to banish a few zombies.
   - (c) Keep it the hearth room and move the valve into it, so its fire is its own.

6. **The secret shelf: a door or a tool?**
   - (a) A door that opens once and stays open, as now.
   - (b) A revolving shelf you can spin any time, zombies spun back.
   - (c) Both: it opens once, then can also spin.

7. **Should opening a room change the rest of the house?**
   - (a) No: a room is its own space, its thing, and its doors.
   - (b) A small touch per room in the hub (the parlour's music, the dumbwaiter's end).
   - (c) A tool that reaches the whole house (the cellar's fuse box).

8. **Should opening a room set off a short event?**
   - (a) No, the boards come down and that is it.
   - (b) Yes: the room "wakes up", a burst from its own doors for about 10 s, a small crescendo (P8).
   - (c) Only the far room, as its toll.

## Decided (2026-11-10)

The owner answered the questions above the same day: the rooms feel "a bit different, but at the same time, it's the same", and "it is very important to nail this". Where a pick differs from a recommendation above, the pick wins.

1. **Finding a thing: each room its own way (question 1, c).** The parlour's piano or coffin rummage, the library's hollow book, the cellar's thing that glints only in light, and the kitchen's dumbwaiter. This replaces "walking onto a thing finds it". Built in part 3.
2. **Shape: inside the slot only (question 2, a).** Every slot room keeps 32 by 18 tiles, its edges, and its ports, so any room still rolls into any slot. Each is reshaped inside.
3. **Room tools: a cooldown sized to the tool (question 3, b, sized).** Every room tool is on its own cooldown, longer for a stronger tool. Every tool must be **set up**: "your character works on it when next to it, and can't shoot." Standing next to it and staying (nearly) still works it; the player's arms are busy, so no shot fires; stepping away lets the work run down. No extra button, so it works the same on touch.
4. **The parlour is the dance floor with the gramophone (question 5, a).**
5. **The cellar's dark matters both ways (question 4, b and c).** The bulb's chain lights the cellar for a while, zombies are a little faster in the dark, and the cellar's thing glints only in light.
6. **The secret shelf opens once, then also spins (question 6, c).** It swings open for the run as now, and is then also a revolving shelf, a tool on a cooldown.
7. **Opening a room adds small touches to the hub (question 7, b).** No house-wide tool: the cellar's fuse box is dropped.
8. **Opening a room wakes it (question 8, b).** A short rush of zombies from the opened room's own doors, about 10 s.
9. **Breaks are for catching a breath.** Things happen mid-wave. The crates, the stove, the pantry, and mending move into waves in a separate change.

How it is built, in [`ESCAPE_PLAN.md`](./ESCAPE_PLAN.md):

- **Layer 19, part 1: shapes and set-up.** Each room's new shape inside its slot (section 3's shapes: the parlour's dance floor ringed by furniture with four gaps, the library's stacks and nook, the cellar's uneven lanes and lopsided barrel block, the dining room's firmer south foothold, the kitchen kept), the shared work station a room tool is set up at, and the dining room's chandelier cleat as its first tool.
- **Layer 20, part 2: the room tools.** The gramophone, the leaning stacks, the revolving shelf, the rolled barrels, the bulb's chain and the dark's speed, and the kitchen's soup pot, each a work station.
- **Layer 21, part 3: the finds, the wake-ups, and the hub touches.**
