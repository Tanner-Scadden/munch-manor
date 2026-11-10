# Lore

The story of Munch Manor: what the game already says, what it hints at, and where it could go. Nothing here is decided until it moves into "Decided" in `GAME_DESIGN.md`. The first two sections only collect what was in the game before the escape the manor update, quoted from its own copy, so a direction could be picked knowing what it had to fit; they are kept as that record. The Munch Manor dare below was chosen on 2026-11-10 and built the same week (see "Escape the manor" in `GAME_DESIGN.md`): each part is marked Built or Proposed.

The game's rule for words holds here too: show, don't explain. Lore lands as props, art, sounds, and one-line jokes, never as a wall of text. A player who reads nothing should still feel it.

## What the game already says

### The place

- **Munch Manor.** The game's name (`CHANGELOG.md` opens "What's new in Munch Manor"), and the run's only map, "The Manor" (`MAP_NAMES`). An old house at night, haunted and falling apart: papered walls, cobwebs, a portrait, a boarded window, splintered doors with blood on the floor.
- **The parlour.** Where every run starts, its exits boarded. A fireplace on the north wall, a big worn rug, wingback armchairs and a sofa facing the hearth, a piano, a bookshelf, a coffin among the cover. A boarded double door with a fork and knife sign leads on.
- **The kitchen.** Behind the boards, smelling of soup: grimy green tiles, a rail of hanging pots, dingy checked floor, two cast iron stoves, a porcelain sink, a butcher's table, flour sacks, spilled pea soup with a yellow CAUTION sign, a pantry cupboard that always has a little something in it, and a gas valve that lights the parlour's fireplace.
- **Mystery Leftovers.** A grimy old fridge in the kitchen: yellowed cream, rust round the feet, mold creeping from the seal, a smiley magnet. Weapons grow inside it. Pull too often and it chains and padlocks itself.
- **The yard.** Outside the kitchen: the manor's garden edge at night, moonlit grass, an iron fence, gravestones, dead bushes, stepping stones. Zombies walk it; the player never can (yet).

### The player

- **YOU.** An ordinary person, any look, no pronoun ever needed. Carries a knife, picks up guns, and gets munched (MUNCHED! is how a run ends). No backstory, no stated reason for being in the manor.
- **The heroes** are callings, each wearing their trade: the **Handyman** (hard hat; cheap planks, free repairs, one fewer heart), the **Track Star** (sweatband; fast, smaller mags), the **Penny Pincher** (visor; Rattles gives a discount, kills pay less), the **Line Cook** (chef's toque; starts with the Pressure Cooker, no Pop Pistol). Nothing says who they are or why they came.
- **Bots** are little robot buddies with goofy names (Bolts, Rusty, Beepo, Tin Tim, Mr Gears, Dingus, ...). No story yet for where they come from.

### Rattles

The manor's one friendly face. A skeleton (bone white skull, green glowing eyes) in a purple top hat, navy suit, and red bow tie, running a stall on a green mat in the parlour. He dozes behind his AMMO window mid-wave and wakes when you walk up. Sells guns, ammo, planks, gnomes, Pickled Hearts, and Glue and Nails. Bangs dents out of your Clang Pan for free. Wrote the shop guide. Hollers about the kitchen until you open it.

His voice, from `src/features/shop/shopkeeper.ts`:

- "Fresh meat! Er, customer."
- "Bones half off. Not mine."
- "Everything is a bit haunted."
- "Still breathing? Spend it!"
- On a heart: "Freshly pickled!" / "Don't ask whose."
- On the gnome: "He bites. Lovingly."
- When you are short: "Need $35 more. No IOUs!"

What we know: he is dead, cheerful, mercenary, a little sinister, and on your side as long as you pay. What we don't: why a skeleton runs a shop in a zombie house, or whose hearts those are.

### The zombies

From the Munchopedia (`src/features/munchopedia/munchopedia.ts`):

| Zombie      | Bio                                                          |
| ----------- | ------------------------------------------------------------ |
| Groaner     | Shows up to every party. Brings nothing. Eats the host.      |
| Hotfoot     | Never skipped leg day. Skipped every other day.              |
| Big Lug     | Wearing a whole kitchen. Pot lid, stop sign, the works.      |
| Kaboomer    | Brought a bomb to share. Nobody asked.                       |
| Big Leaguer | Got cut from the big leagues. Still bitter.                  |
| Ankle Biter | Lives under the floorboards. Pays no rent. (a zombie spider) |
| Uncle Chunk | The relative nobody invited. He came anyway.                 |

**Uncle Chunk**, the finale: a hulking pot-bellied zombie with a tiny head and a tiny green party hat. He stomps, charges, spits, and belches up Groaners. He comes every tenth wave.

### The things

The manor's stuff is food and junk, not military kit:

- Guns: Pop Pistol, Barn Buster, Chatterbox, and from the fridge the Pressure Cooker (fires exploding pot lids), Clang Pan, and Brain Freeze. Upgrades go Beefy, DELUXE, 3000.
- Power-ups: HOT SAUCE, MEAN BEANS, ZOOMY SOCKS, SHISH KEBULLETS, BIG BURP, PICKLED HEART.
- The stove cooks a gun Spicy, Crispy, or Hearty.
- Traps: the Plank Pile and the Grumpy Gnome.
- Fridge gags: a Moldy Sandwich and a fish skeleton (the Dud).
- **Bones** are what you earn across runs and spend on heroes, hats, and shirts. Rank badges go up through tiers.

### The tone

Goofy-gory. Zombies are funny more than scary. Cartoon splatter, confetti with a little gore. Every line is a short joke.

## What it hints at

None of this is written down in the game, but the copy keeps pointing the same way. These are the threads a story can pull on.

- **A party gone wrong.** The Groaner "shows up to every party" and "eats the host". Uncle Chunk is "the relative nobody invited" and wears a party hat. The Kaboomer "brought a bomb to share". The party hat is the first rank gift. Read together: the zombies are guests, or family, at a gathering at the manor that went very wrong.
- **Munch is about eating.** The manor's name, MUNCHED!, the kitchen, the soup, the fridge, the pantry, hot sauce, beans, pickled hearts, Big Burp, Uncle Chunk belching zombies up. Food is the manor's theme, and the house seems hungry.
- **Uncle Chunk owns something.** The design doc's sketch already names "the keys to Uncle Chunk's cellar". If he is family, the manor may be his, or the family's, and he is the one who does not want anyone to leave.
- **Rattles knows more than he says.** "Everything is a bit haunted." He is the only one in the house who is dead and not hungry. He could be a former guest, a former owner, the butler, or a ghost who cannot leave and so sells to those who might.
- **The house keeps you in.** Every run starts in the parlour with its exits boarded. Nothing says who boarded them, or whether from the inside or the outside.

## A direction: escape the manor

Proposed by the owner on 2026-11-09, for discussion. The first pitch, kept as history: "The Munch Manor twist" below is what was chosen and built.

**The pitch.** You wake up in the parlour. The front door is locked. The goal is no longer only to survive the waves but to get out: find what opens the way (keys, a fuse, a crowbar, whatever the manor hides), room by room, while the house keeps sending its guests at you. Where those things turn up is rolled per run, and the rooms can vary too, so no two escapes play the same.

### How it fits what is built

- **The start is already right.** The parlour is boarded in on every run. The story only has to say why.
- **Buying rooms open is already exploring.** Each boarded exit is a door you work your way through. The escape gives that a reason beyond space and loot.
- **Rattles becomes the guide.** He already hollers about the kitchen and wrote a guide. He can hint at where the next piece is, in his few words, and sell the way out (a crowbar for the boards, a key copy for a price).
- **Uncle Chunk becomes the gatekeeper.** Owner, 2026-11-09: in an escape run he no longer comes at wave 10. He shows up only at the front door, once everything on the list is found, and beating him is what opens it. Victory becomes "you got out".
- **The wave count gets a reason.** Today a run is ten waves because ten waves were tuned. An escape run ends when you get out, so its length is however long the finding takes, with the waves as pressure.
- **Endless still fits** as staying in: the run where you never leave, or the run after you came back for more.
- **The design doc already wants it.** "A goal beyond surviving, such as restoring the power or finding the keys to Uncle Chunk's cellar" is in the "Exploring the manor" sketch.

### What it goes against

- **"Not now" in `GAME_DESIGN.md` rules out procedural manors**: "The layout is hand-made; only secrets and loot spots may shift with the seed." Rolling where the escape items spawn fits that line as written. Rolling the rooms themselves does not, and would be a change to a settled decision. A middle way that keeps hand-made rooms: a pool of hand-made rooms, with the run rolling which ones sit behind which boarded exits, or which variant of a room you get.
- **Determinism.** Any roll has to come from the World's seeded generator (its own salted stream, as the fridge and the pantry have), so co-op, replays, and the balance tools still agree.
- **Balance.** The wave tables, pacing, and the balance bot assume one fixed layout and a fixed wave count. Rolled rooms and an open-ended run length mean the balance model and the bot both learn the new goal.

## What has worked elsewhere

Games that already proved parts of this idea. We borrow the shape of what worked, never names, art, or item lists, as with Zombie Estate 2.

### Video games

| Game                                           | What worked                                                                                                                                                                                                                                                                                                             | What we take                                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Call of Duty Zombies** (Treyarch, 2008 on)   | Our closest relative: waves, buying doors open, a mystery box, a gun upgrade machine. Its later maps add a power switch, parts built into tools, and secret quests, some ending in a real escape (Mob of the Dead's plane off the island). In TranZit a buildable's parts appear in one of a few fixed spots each game. | Parts that spawn in one of a few hand-picked spots per run. A power switch that changes the house. An escape that is a quest layered on the waves, so players who ignore it still play the wave game. |
| **Blue Prince** (Dogubomb, 2025)               | A manor whose rooms are drafted: open a door, pick one of three rooms to put behind it. The house resets every day, the goal is a room you have to reach. Proved "random rooms in a mansion" is a hit.                                                                                                                  | When boards come down, the room behind them is drawn from a pool of hand-made rooms. Maybe a peek: pick one of two.                                                                                   |
| **Resident Evil** (Capcom, 1996)               | The mansion as a lock puzzle: crest keys, each opening one kind of door, a safe room with a box and a typewriter. Backtracking feels like progress because the map opens up.                                                                                                                                            | A few key kinds, each opening one kind of door. Rattles' stall as the safe room.                                                                                                                      |
| **Luigi's Mansion** (Nintendo, 2001)           | Goofy haunted house. The hook: Luigi "won" a mansion in a contest he never entered. Rooms go from dark to lit as you clear them.                                                                                                                                                                                        | A silly reason you are here (see the twist). Rooms that change once cleared or once the power is on.                                                                                                  |
| **Hades** (Supergiant, 2020)                   | A run is an escape from your family's house. Dying sends you home, and the story moves forward between deaths: the cast remembers how you died.                                                                                                                                                                         | Dying is part of the story. Rattles reacts to how the last run ended and how far you got.                                                                                                             |
| **Left 4 Dead** (Valve, 2008)                  | The finale: call for rescue, then hold out against the biggest horde until it arrives. Safe rooms between stretches.                                                                                                                                                                                                    | The last step of an escape is a hold-out at the front door, the existing wave game at its loudest.                                                                                                    |
| **Dead by Daylight** (Behaviour, 2016)         | Do objectives around the map to power the exit gates, then a collapse timer pushes everyone out.                                                                                                                                                                                                                        | Finding the pieces "arms" the way out. Once it is open, the house gets angrier until you leave.                                                                                                       |
| **Escape from Tarkov** and extraction shooters | Leaving is a choice: get out now with what you have, or stay for more and risk losing it.                                                                                                                                                                                                                               | An early exit that pays less, and the full escape that pays most.                                                                                                                                     |
| **Maniac Mansion** (Lucasfilm, 1987)           | Kids break into a weird family's mansion, each kid has different skills, and different picks open different endings. Goofy, not grim.                                                                                                                                                                                   | Heroes each open a different shortcut (the Handyman pries boards, the Line Cook opens the kitchen's back way).                                                                                        |
| **Zombies Ate My Neighbors** (LucasArts, 1993) | B-movie zombies played for laughs, rescuing neighbors for points.                                                                                                                                                                                                                                                       | The tone we already have.                                                                                                                                                                             |

### Board games

| Game                                                  | What worked                                                                                                                                                                                         | What we take                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Betrayal at House on the Hill** (Avalon Hill, 2004) | The house is built as you explore, from a stack of room tiles. Omens found along the way build to a "haunt": a surprise scenario that changes the rules partway through. Every game is a new house. | Rolled rooms behind each door. A mid-run twist from a pool, triggered by what you find.               |
| **Clue** (1949)                                       | A dinner party at a mansion, a room-by-room hunt, weapons that are household things, secret passages between corners.                                                                               | The dinner party framing. Secret passages as a room's twist. We already fight with pans and pot lids. |
| **Last Night on Earth** (Flying Frog, 2007)           | B-movie zombie scenarios with goals. "Escape in the Truck": find the keys and the gas, then reach the truck.                                                                                        | An escape built from two or three ordinary things you need to leave.                                  |
| **Room 25** (Matagot, 2013)                           | A grid of hidden rooms that slide around. Find the exit room and get out before time runs out.                                                                                                      | The house that shifts. Maybe a room that moves between runs.                                          |
| **Escape: The Curse of the Temple** (Queen, 2012)     | Ten minutes of real time to explore a temple and get out together. Anyone left inside when it collapses loses.                                                                                      | The hold-out at the end as a co-op "everyone to the door".                                            |
| **Horrified** (Ravensburger, 2019)                    | Gather particular items around the map to beat each monster.                                                                                                                                        | Uncle Chunk is beaten with what you found, not only with damage.                                      |
| **EXIT** and **Unlock!** escape room games            | Combine two found things into one that opens something.                                                                                                                                             | Kept small: at most one combine (a fuse plus the fuse box).                                           |

### What they share

1. **The goal is simple and the path is random.** "Get out" never changes; where the pieces are and which rooms you get does.
2. **Random within hand-made pieces.** Blue Prince, Betrayal, and TranZit roll hand-made rooms or hand-picked spots, never fully generated maps. This fits our "Not now" rule's spirit.
3. **The house changes as you go.** Power on, rooms opened, a haunt. Progress is something you see.
4. **The ending is a fight you choose to start.** The hold-out, the gates, the plane: players decide when they are ready.
5. **Death moves something forward.** Hades and Blue Prince make a failed run still teach or tell something.
6. **Ordinary things are the keys.** Truck keys, gas, a fuse. The sillier and more everyday, the better the joke.

## The Munch Manor twist

The direction the owner chose on 2026-11-10, built from the patterns above: the Munch Manor dare. Built on 2026-11-10 but where a part says Proposed.

### The premise: the Munch Manor dare

Everyone in town knows the legend. A hundred years ago the Munches threw a dinner party. The doors shut, and nobody came out. Kids have dared each other ever since: go in, bring back proof, get out. Nobody ever has.

It asks almost nothing of a new player, which is the point (owner, 2026-11-10: "little friction to get into it, but still a cohesive story that will make people want to talk about it"):

- **Why you go.** It is a dare. No invitation, no paperwork: your friends drive you up the hill and you walk in.
- **Why nobody stopped it.** Everyone already knows. That is what makes it a dare.
- **Why it gets talked about.** You come out with proof, or you don't come out. Either way there is a story to tell, and the game hands you the post (see "Made to be talked about").

### Why the door locks: the party never ended

The Munches made a deal with the house long ago: it gets fed, and the family gets to live forever. Mostly. The party they threw a hundred years ago is still going. Uncle Chunk is still the host, in the same party hat, and the house does not let guests leave. Anyone who walks in is a guest, and the door shuts behind them.

- **Why it gets harder the longer you stay.** The night goes on, the house wakes more guests, and they get hungrier.
- **Why Uncle Chunk waits at the front door.** A good host always sees his guests out. He just does not want you to go.
- **What happens when you are munched.** You join the party. Next time, someone new takes the dare (you again, which is odd).

### The dare's terms are the list

A dare needs proof, so the things you must bring out are the dare's terms, and they change every time, because every dare is new. Your friends wrote them on a card: "Bring back the silver spoon, the family portrait, and Uncle Chunk's party hat." The party hat is always last, and he is wearing it at the front door.

### The zombies: the guests, and every daredevil who failed

Built on 2026-11-10 (the Kaboomer carries a backpack of rockets). Two kinds of zombie live in the house, and that is a styling gift (owner, 2026-11-09: the story styles the zombies):

- **The party guests.** A hundred years in formal wear: tailcoats, gowns, pearls, monocles, all gone to rot.
- **The daredevils.** Every kid who took the dare and never came out, from every decade: a letterman jacket, an 80s headband, a 90s windbreaker, a phone still held up for the video.

| Zombie      | Who they were                                            | Styling                                                  |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Groaner     | A party guest. Shows up to every party.                  | Tattered tailcoat or gown, a napkin still tucked in      |
| Hotfoot     | The fastest kid in school, dared to run straight through | Track shorts, tube socks, an 80s headband                |
| Big Lug     | A party guest who ate everything                         | Burst waistcoat, still wearing a whole kitchen for armor |
| Kaboomer    | The kid who brought fireworks to scare everyone          | A backpack of fireworks, a lit fuse                      |
| Big Leaguer | The jock who took the dare to prove a point              | Letterman jacket, a cap on backwards                     |
| Ankle Biter | The house's own pet. Lives under the floorboards.        | Unchanged: a zombie spider                               |
| Uncle Chunk | The host                                                 | The party hat, a tuxedo far too small, a napkin bib      |

**Why zombies drop power-ups and keys.** The daredevils were grabbing proof and hunting skeleton keys when they were caught. Drop one and out falls whatever they pocketed from the house.

### Power-ups are what the house hides

Built on 2026-11-10. The owner, 2026-11-10: the power-ups should be things you would find in an old manor, and each one's look on you matches what it is (hot sauce gives you a fiery border, and so on). The rules stay as they are (`src/world/gear/powerups.ts`); the names, art, sounds, and auras change. Approved on 2026-11-10:

| Today           | What it does                      | In the manor  | How it looks on you                                                                |
| --------------- | --------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| Hot Sauce       | Rapid fire, never reloads         | Wind-Up Key   | A big brass key turns in your back like a toy; gears tick around you; shots rattle |
| Mean Beans      | Twice the damage, more knockback  | Family Silver | A silver gleam around you; shots fly as silver streaks that ring on a hit          |
| Zoomy Socks     | Runs 1.4 times as fast            | Dancing Shoes | Shiny shoes, music notes and sparkly footprints where you step                     |
| Shish Kebullets | Shots go through 3 zombies        | Hat Pins      | A ring of hat pins circles you; shots fly as long pins that skewer a row           |
| Big Burp        | A shove and damage all around you | Dinner Gong   | A gong appears and BONG: a ring of sound knocks everyone back                      |
| Pickled Heart   | One heart                         | Pickled Heart | Stays: a jar from the house's cabinet of curiosities, and a pulse of red           |

The rule holds for every boost: the aura says what you grabbed, with no words. Each aura is baked sprites, as today's are, so the frame stays cheap. The guns and the kitchen's prizes (the Pressure Cooker, the Clang Pan, Brain Freeze) already fit a house's kitchen, and the fridge is the manor's old icebox. The owner approved the renames on 2026-11-10: a change to `src/world/names.ts`, the art, the sounds, and the Munchopedia.

### No shop: feats, finds, and skeleton keys

Built on 2026-11-10. The owner, 2026-11-10: there is no shopkeeper and no shop. You get stronger from the house itself. The cases are a gun rack, a glass display case, and a trophy cabinet, and the prizes are the Barn Buster, the Chatterbox, the Laser Sight, and two old-manor guns: Old Thunder, the trophy room's hunting rifle, and the Big Blunder, the blunderbuss over the mantel. Traps come from a crate that restocks each break.

- **Guns are in display cases.** A glass case in the study, a gun rack in the cellar, a trophy case: each holds a gun, and each lock shows a feat as an icon and a ring that fills as you go. Do it this run and the case springs open. Which gun sits behind which feat can roll each run.
- **Feats of every kind** (owner, 2026-11-10): kill counts (25 kills, 10 knife kills, 5 Big Lugs), skill (a wave without a hit, a 20 kill streak, a Kaboomer caught in its own blast), exploring (a key off a marked zombie, a room opened, the fireplace lit), and the house's things.
- **Things the dare did not ask for open cases too** (owner, 2026-11-10). The pool holds more things than any one dare asks for, so opening a room and finding something off your list is never a letdown: carry it to a display case and it opens.
- **Guns level up with use.** The tiers stay (Beefy, DELUXE, 3000), earned by kills with that gun instead of bought.
- **Ammo never runs out** (owner, 2026-11-10). Every gun has endless ammo, but magazines and reloads stay: a reload is still the moment a horde gets scary, and a bigger magazine or a faster reload is still worth earning.
- **Hearts and traps are found.** Hearts from the Pickled Heart and the pantry, traps where they stand in the house (a gnome on a mantel, a plank pile in the hall).
- **Skeleton keys open rooms and the fridge** (owner, 2026-11-10). Zombies drop skeleton keys: the daredevils were collecting them, trying to find the way out. Each set of boards wears a padlock with a number on it; spend that many keys and the boards drop. The fridge's padlock takes keys for a pull. Keys are the one thing you count, so every key is still a choice: a room now, or the fridge.

What this changes is in "Escape the manor" in `GAME_DESIGN.md`: the shop, Rattles' stall and dialog, money, the heroes and modifiers that read prices, co-op's money split, and the balance bot all move.

### Rattles

Built on 2026-11-10. With no shop, Rattles has no stall. He stays as a character (owner, 2026-11-10): the first daredevil, from 1924, who never got out and hollers hints in his bubble, pointing at the thing he means: "SPOON'S OVER THERE. PROBABLY.", "I LOST THAT SPOON IN 1924.", "SOMEBODY'S WEARING IT. RUDE.", "LAST THING: HIS HAT.", "NO HINTS. TRIPLE DOG DARE." His lines are drafts for review, and whether his look changes, Demi is reinventing.

### PLAY is the dare, the lobby is the dare card

Built on 2026-11-10, as a napkin reading GOING IN, COMING AS, DRAG ALONG, OUT OR STAY, STAKES, EXTRA DARES, and WHICH HOUSE, with SHAKE ON IT and CHICKEN OUT; co-op's lobby keeps its own look, so the side by side cards are still proposed. The home menu's PLAY is a dare card your friends hand you, scrawled on a napkin. Opening it opens the lobby, which is the card you fill in. Every pick the lobby has today becomes a line on it, so the rules and the Block stay as they are and only the dress changes:

| Today's pick      | On the dare card                                                          |
| ----------------- | ------------------------------------------------------------------------- |
| Your name         | Who is going in                                                           |
| Hero              | Coming as: the Handyman, the Track Star, the Penny Pincher, the Line Cook |
| + BOT seats       | Who you drag along: wind-up tin robots from the nursery                   |
| Difficulty        | The stakes (see below)                                                    |
| Modifiers         | Extra dares: tick boxes, each with its bonus in gold                      |
| Campaign, Endless | Get out, or stay the night                                                |
| Map               | Which house, once there is more than one                                  |
| START             | Shake on it                                                               |
| BACK              | Chicken out (a cluck)                                                     |

In co-op the room code arrives as a dare: "I dare you." Each player's own card sits side by side.

**The stakes (owner, 2026-11-10).** The difficulty levels are renamed for the dare: Easy becomes Dare, Normal Double Dare, Hard Triple Dare, and Nightmare Triple Dog Dare. The numbers stay as they are; the names change everywhere a player reads them (the card, the first-run question, the end card, the bests).

**What holds it in check.** Show, don't explain: icons and tick boxes, a word or two a line. Every line works by key, mouse, and touch, in portrait and landscape. Buttons act on click, and the card's animations move the art inside, never the buttons. The first PLAY of a new save goes straight into the tutorial, past the card.

### You start at the table

Proposed by the owner on 2026-11-09 and built on 2026-11-10. A run starts in the dining room, at the table where the party never ended. Until then every run started in the parlour, so this changed a decision. Its twist is the chandelier: shoot it and it drops onto the zombies under it.

**A brand-new room (owner, 2026-11-10).** The dining room is its own hand-made room, not the parlour redrawn: a long table set for a party a hundred years old as its centerpiece and cover, a sideboard, a chandelier, candelabras, and its own doors and lanes. That is more work than a redraw: new cover, new lanes, the kitchen's door moved to it, and the waves and balance tuned again for the new start. The parlour stays in the house as a room you buy your way into. Its other ways out are boarded, as the parlour's are today, and bought open the same way.

### The intro: this feels really off

Proposed by the owner on 2026-11-09 and built on 2026-11-10 (15.4 s in full, 3.8 s after; a co-op room plays the full one while anyone in it has not seen it). A short cutscene between the dare card and the run, with one feeling: this feels really off. It stays focused: a handful of beats, each with one wrong detail and nothing else on screen, and every wrong detail is a piece of the lore the run pays off later.

| Beat                                                          | What is off                                                                                            | What it sets up                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| START: you shake on it, and the dare card goes in your pocket | Your friends grin a little too wide.                                                                   | Nobody expects you back                                              |
| Your crew in the car at night, egging you on                  | The radio drifts into static. The road sign says MUNCH MANOR, and something has chewed its corner.     | The house is hungry                                                  |
| You pull up at the manor                                      | The drive is full of other daredevils' cars, from every decade: a 50s coupe, a 90s minivan, a bike.    | Everyone who took the dare is still here: they are the zombies       |
| You walk up to the front door                                 | A trampled party hat on the steps, and a dropped flashlight still on. Footprints go in. None come out. | The party is still going, and the host is still here                 |
| Knock knock                                                   | A beat of silence. Then, from somewhere inside, one knock back.                                        | Something in the house answers                                       |
| The doors creak open on their own; you step in                | The coat check: a hundred years of coats nobody came back for, and a bony hand that waves.             | Rattles, the first daredevil                                         |
| "HELLO?" The dining room: the table set, the candles lit      | A feast a hundred years old, still steaming. And a place card with your name on it.                    | You were expected                                                    |
| The doors slam and lock behind you                            | The run starts.                                                                                        | The front door is the way out, and Uncle Chunk will be waiting at it |

The tone stays the game's: goofy first, scary second (Luigi's Mansion, not a horror film). Each wrong detail is half a joke (the chewed sign, the knock back, the waving hand), so the unease lands with a smile and the slam is the punchline. Music thins out as it goes: the radio in the car, then only footsteps and the house creaking by the door, then silence on HELLO?, then the slam and the run's music.

Show, don't explain: pictures, sound, and the one word, HELLO?, in a speech bubble. Any key or tap skips to the slam. The slam itself is never skipped (owner, 2026-11-09): it is the moment the run starts, every time. The cutscene plays in full the first time, and shorter after that (the knock and the slam), so RETRY stays quick. The first PLAY of a new save goes straight into the tutorial, so the cutscene is its opening there too. It is a client cosmetic, like the end card's beat: the World starts the same. In co-op every player sees their own crew in the car, and the run starts on the slam for everyone at once (owner, 2026-11-09): the room sets when the doors slam, a player who skips jumps to the knock at the door and waits there, and every screen slams together.

**Paying it off** (proposed). Each detail comes back: the party hat is Uncle Chunk's, the coats are a hundred years of daredevils', the cars in the drive belong to the zombies you fight, and the place card is the house's joke. A Munchopedia entry can unlock for each one once the player finds it in a run.

### The dare card in your pocket

Proposed by the owner on 2026-11-09 and built on 2026-11-10: the card rises from your pocket after the slam, writes on the list, and folds into the HUD's outlines at 4.5 s (or at a tap). Once the doors slam, the first thing in the run is the dare card: you pull it from your pocket (or it waits on the table at your place, beside the place card). It opens to your friends' scrawl, which is this run's list, mostly pictures:

> I DARE YOU to bring back: (the icons of this run's things)
> AND Uncle Chunk's hat!!
> (a doodle of a chicken) no chickening out

Then the card folds itself into the HUD, and its icons become the empty outlines that fill in as you find things. It is how a new player learns the goal without being told. In co-op every player holds a card with the crew's shared list. Alone, the first break waits while the card is read; in co-op the room never waits.

### What the dare asks for changes every run

Built on 2026-11-10, every way in the table. Each run rolls its list from a pool of things in the house, from its own salted seeded stream (TranZit, Last Night on Earth). Uncle Chunk's party hat is always last. What makes the list fun is less which object it is than how each one comes back to you, so each thing in the pool has its own way:

| Thing                    | How you get it                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| The silver spoon         | Hidden in one of a few spots: a sofa cushion, the sideboard, under the table      |
| The family portrait      | A marked zombie, a daredevil who tried to steal it, carries it: drop him, grab it |
| A page of the guest book | Locked in a display case: open it with a feat                                     |
| Grandma Munch's recipe   | Cooked at the kitchen's stove, as a perk is                                       |
| The music box            | It plays somewhere in the house: follow the tune                                  |
| The butler's bell        | Behind the boards of a room you have not opened yet                               |
| Uncle Chunk's party hat  | Always last: he is wearing it at the front door                                   |

Objects, no reading needed. The HUD shows this run's list as empty outlines that fill in.

### Difficulty sets the list

Built on 2026-11-10 with the help as Rattles' hints: Dare points every break and sparkles every hidden thing, Double Dare one hint a break, Triple Dare always lists the portrait and hints only when its carrier walks in, and Triple Dog Dare heckles. On Triple Dog Dare the house gets hungrier from the first find; on the other levels, once the list is done. The four levels scale the zombies and the break clock ("Difficulty levels" in `GAME_DESIGN.md`), and the list is a second dial on the same curve:

| Level     | Things before the hat | Help finding them                                     |
| --------- | --------------------- | ----------------------------------------------------- |
| Easy      | 2                     | The dare card's doodles point the way; spots sparkle  |
| Normal    | 3                     | One doodled hint a break                              |
| Hard      | 3                     | No sparkle; one is always on a marked zombie          |
| Nightmare | 4                     | No hints; the house gets hungrier from the first find |

A longer list makes a longer run, so the balance model and bot learn the list before the counts are tuned.

### The waves keep count

Built on 2026-11-10. Owner, 2026-11-09: the waves are not named after the meal. A wave's number marks how far you are, and the house keeps getting harder the longer you stay, the way Endless ramps today. The banner stays WAVE 4, and Game Over says how far you got.

So an escape run has no fixed wave count. The waves ramp until the list is done, and only then does Uncle Chunk come to the front door (owner, 2026-11-09). A quick hunter meets him early against easier waves; a slow one meets him late with the house at full strength. The ten tuned waves become the start of one long ramp, as Endless is today.

### Rooms come out like dishes

Built on 2026-11-10: the parlour, the library (a secret bookshelf), and the cellar (dark but near you) roll into three slots. When boards come down, the room behind them is one of a few hand-made rooms (Blue Prince, Betrayal). A cloche over the doorway lifts to show which: a reveal like the fridge's. The kitchen stays fixed as the first room; the rooms after it roll. The house plan is the same shape every run, only which room is where changes.

### The house gets hungrier

Built on 2026-11-10: 1.25 times the zombies, Uncle Chunk at the wave after the list is done but never before wave 6, 8, 9, or 9 by difficulty, a 45 s unlock that counts during waves, a marker at the screen's edge pointing to the door while it is out of view, and the run ends once every standing player has walked out. Once you hold everything on the list, the house knows you mean to leave (Dead by Daylight's collapse). The waves press harder until you take Uncle Chunk's hat at the front door. That finale is a hold-out (Left 4 Dead): the front door is unlocking, and you hold the hall until it swings open.

### Leaving early

Proposed. The back door in the kitchen (or a window) is an early exit: leave with part of the dare, and the run ends as an escape that pays less, and your friends call you chicken. The whole dare, hat and all, pays most. Push your luck (extraction shooters).

### Made to be talked about

Built on 2026-11-10.

- **SHARE is your proof.** The end card becomes the photo you show your friends: "I got Uncle Chunk's hat", or "I made it to wave 7 and took the silver spoon".
- **Co-op is daring a friend.** A room link is "I dare you".
- **Every escape is different.** The list, the hiding spots, and the rooms roll, so there is always a new story to compare.

### Between runs

Proposed. Your friends remember. They wait in the car, and greet you with a few words that move on with how far you got last time, like Hades: "Back for seconds?" after a death, "Brave or dumb?" after a quick one, "Chicken!" after an early exit. Still a few words each.

### Heroes and bots

The bots as wind-up tin robots are in the dare card's DRAG ALONG line, and the heroes' perks with no prices are built (the Penny Pincher's kills drop more keys, the Handyman's traps are sturdier and he mends faster); the heroes' reasons are still proposed. The heroes are daredevils with their own reasons: the Handyman was paid by the town to board the place up, the Track Star is the fastest kid in school and was dared to run straight through, the Penny Pincher heard about the Munch silver, and the Line Cook wants Grandma Munch's recipe. The bots are wind-up tin robots from the nursery.

### What would change in the game

Ordered from cheapest to most work, so the story could land before the systems did. Steps 1 to 5 landed together on 2026-11-10, with the hungrier house from step 6; early exits are left:

1. **Words and art only.** The difficulty names, the power-ups renamed and restyled as the house's things, the zombies restyled as guests and daredevils, the Munchopedia's bios, the dare card as art (the home menu, the icon, the share card). No rule changes.
2. **No shop.** Display cases opened by feats, guns that level up with use, endless ammo with reloads kept, found hearts and traps, and skeleton keys for rooms and the fridge. A large rules change: balance, the bot, heroes, modifiers, and co-op all move.
3. **One fixed list in fixed spots.** The dare as a goal over the existing ten waves. Victory becomes "you got out".
4. **Rolled spots and a rolled list.** The things move between a few hand-picked hiding spots, and the list itself rolls from the pool, sized by difficulty, from their own seeded stream.
5. **Rolled rooms.** Needs a second room and a pool, and a change to "Not now".
6. **Early exits and the hungrier house.** Needs balance work and the bot to learn the goal.

## Open questions

The lore choices still open, roughly in order. Settled and built on 2026-11-10: the dare, your friends writing the card, Rattles as the 1924 daredevil who hints, and rooms that roll.

1. **What goes in the pool?** Six things are defined and all six roll (see "What the dare asks for changes every run"); which come next is open.
2. **Rattles.** His lines are drafts for review, and his look is open.
3. **Which feats open which cases,** and how many skeleton keys a room and a fridge pull cost: starting numbers, tuned in the balance pass.
4. **What is a Bone?** What you earn across runs, now that the run's own currency is skeleton keys.
5. **Leaving early** and **between runs**: both still proposed.
