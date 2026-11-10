# Lore

The story of Munch Manor: what the game already says, what it hints at, and where it could go. Nothing here is decided until it moves into "Decided" in `GAME_DESIGN.md`. The first two sections only collect what is already in the game, quoted from its own copy, so a direction can be picked knowing what it has to fit.

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

Proposed by the owner on 2026-11-09, for discussion.

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

A proposal, built from the patterns above.

### The premise: you're invited to dinner

The invitation says "Dinner at Munch Manor. Formal. Bring an appetite." It does not say who is eating whom.

You came to a dinner party (Clue). The family (the Munches) and the other guests have already turned. Uncle Chunk is the host, still in his party hat. The house is hungry. Every run you sit down at the table in the dining room, the doors are boarded behind you, and the only way out is the front door.

This ties together what the game already says: the Groaner "eats the host", Uncle Chunk is "the relative nobody invited", MUNCHED!, the soup, the fridge, the party hat.

### Rattles is the coat check

Every party has a coat check. Rattles ran it, and he never left: the coats of every guest who never went home still hang behind his stall. He is dead but not hungry, so he sells to the living. He wants you to get out, mostly because the dead do not tip.

"Fresh meat! Er, customer." now reads as a joke about the dinner.

### You start at the table

Proposed by the owner on 2026-11-09. A run starts in the dining room, at your place setting, since you came for dinner. Today every run starts in the parlour ("Every run starts in the parlour" under "Exploring the manor" in `GAME_DESIGN.md` is decided), so this changes a decision.

The cheap way is to redress the parlour as the dining room: keep its tiles, doors, cover footprints, and stall where they are, so the waves and the balance stay as tuned, and swap the art. The seating group becomes a long dining table set for a party that never finished, the piano a sideboard, the hearth stays (dining rooms have them too), a candelabra, a chandelier. The boarded double door with the fork and knife sign already leads to the kitchen, which fits a dining room better than a parlour. A new room with its own layout is the costly way: new cover, new lanes, and the waves tuned again.

### What you need to leave changes every run

Proposed by the owner on 2026-11-09, replacing one fixed set of three. Each run rolls its list from a pool of ordinary things a guest needs to leave a party, from its own salted seeded stream (TranZit, Last Night on Earth). The goodbye to the host is always last.

What makes the list fun is less which object it is than how each one comes back to you, so each thing in the pool has its own way:

| Thing                  | How you get it back                                                       |
| ---------------------- | ------------------------------------------------------------------------- |
| Your car keys          | Hidden in one of a few spots: a sofa cushion, the fridge, under the table |
| Your coat check ticket | Rattles has it, for a price (the dead do not tip, but the living do)      |
| Your shoes             | A marked zombie wears them: kill it and grab the drop (CoD style)         |
| The doggy bag          | Cooked at the kitchen's stove, as a perk is                               |
| Your phone             | It rings somewhere in the house: follow the sound                         |
| Your umbrella          | Behind the boards of a room you have not opened yet                       |
| A goodbye to the host  | Always last: Uncle Chunk at the front door. Politely. With a shotgun.     |

Objects, no reading needed. The HUD shows this run's list as empty outlines that fill in.

### Difficulty sets the list

Today the four levels scale only the zombies and the break clock ("Difficulty levels" in `GAME_DESIGN.md`). The list is a second dial on the same curve:

| Level     | Things before the goodbye | Help finding them                                      |
| --------- | ------------------------- | ------------------------------------------------------ |
| Easy      | 2                         | Rattles points the way; hiding spots sparkle in breaks |
| Normal    | 3                         | Rattles hints once a break                             |
| Hard      | 3                         | No sparkle; one is always on a marked zombie           |
| Nightmare | 4                         | No hints; the house gets hungrier from the first find  |

A longer list makes a longer run, so the balance model and bot learn the list before the counts are tuned.

### The waves keep count

Owner, 2026-11-09: the waves are not named after the meal. A wave's number marks how far you are, and the house keeps getting harder the longer you stay, the way Endless ramps today. The banner stays WAVE 4, and Game Over says how far you got.

So an escape run has no fixed wave count. The waves ramp until the list is done, and only then does Uncle Chunk come to the front door (owner, 2026-11-09). A quick hunter meets him early against easier waves; a slow one meets him late with the house at full strength. The ten tuned waves become the start of one long ramp, as Endless is today.

### Rooms come out like dishes

When boards come down, the room behind them is one of a few hand-made rooms (Blue Prince, Betrayal). A cloche over the doorway lifts to show which: a reveal like the fridge's. The kitchen stays fixed as the first room; the rooms after it roll. The house plan is the same shape every run, only which room is where changes.

### The house gets hungrier

Once you hold everything on the list, the house knows you mean to leave (Dead by Daylight's collapse). The waves press harder until you say goodbye to Uncle Chunk at the front door. That finale is a hold-out (Left 4 Dead): the front door is unlocking, and you hold the hall until it swings open.

### Leaving early

The back door in the kitchen (or a window) is an early exit: leave with part of the list (the car keys, say, but no coat), and the run ends as an escape that pays less. The full goodbye pays most. Push your luck (extraction shooters).

### Between runs

Rattles remembers. A few lines that move on with how far you got last time, like Hades: "Back for seconds?" after a death, "You left without your coat!" after an early exit. Still a few words each.

### Heroes and bots

The heroes are the other guests who never turned: the Handyman came to fix the boiler, the Track Star was out for a jog, the Penny Pincher came for the free dinner, the Line Cook was the hired chef. The bots are Rattles' rentals, the help.

### What would change in the game

Ordered from cheapest to most work, so the story can land before the systems do:

1. **Words and art only.** The parlour redressed as the dining room, Rattles' new lines, the Munchopedia's bios nudged toward the dinner party, the invitation on the loading splash. No rule changes.
2. **One fixed list in fixed spots.** The keys, the ticket, and the goodbye as a goal over the existing ten waves. Victory becomes "you got out".
3. **Rolled spots and a rolled list.** The things move between a few hand-picked hiding spots, and the list itself rolls from the pool, sized by difficulty, from their own seeded stream.
4. **Rolled rooms.** Needs a second room and a pool, and a change to "Not now".
5. **Early exits and the hungrier house.** Needs balance work and the bot to learn the goal.

## Open questions

The lore choices that most change the game, roughly in order.

1. **Why are you in the manor?** Invited to the party (you are the last guest standing)? Broke in (a burglar, a ghost hunter, a dare)? Inherited it (the will said "spend one night")? Woke up there with no memory?
2. **Who are the zombies?** The party guests and the family? Strangers the house ate? Does Uncle Chunk lead them, or is he just the biggest?
3. **Who is Rattles?** The butler, a past guest who never got out, the house's first owner, or something the house made to keep you spending?
4. **What locks you in?** Uncle Chunk, the house itself, a curse, or Rattles (who would lose his customers)?
5. **What goes in the pool?** Which things a guest needs to leave, and how each one comes back to you (see "What you need to leave changes every run").
6. **What do the heroes and bots mean in the story?** Other guests who came for the party? The robots are Rattles' rentals?
7. **What is a Bone?** Rattles' currency, the bones of the munched, or both?
8. **Do rooms roll, or only what is in them?** See "What it goes against".
9. **Is the dining room the parlour redressed, or a new room?** See "You start at the table".
