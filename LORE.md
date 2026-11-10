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

### The premise: a private tasting

Settled in direction with the owner on 2026-11-09, replacing "invited to dinner" as the reason you are there. Munch Foods, the Munch family's food company, holds a **private tasting** of its next product at the old family manor. You signed up: it pays, there is a free dinner, and you had to sign a waiver and an NDA to get in. A private tasting is why it is at a house and not a lab: the family's manor is the company's test kitchen, and the lab is underneath it.

The acceptance letter says "Munch Foods thanks you for joining our private tasting. Formal. Bring an appetite." It does not say who is tasting whom.

The invitation is an asset to build around, not a screen to wait on (owner, 2026-11-09: the loading splash is too quick to read one). A card on the home menu, the app icon, the store art, the share card: seen everywhere, read in a glance, never in the way.

### Why nobody caught on

The owner, 2026-11-09: a haunted house that keeps eating guests is hard to believe nobody noticed. A study has the cover built in:

- **Everyone signs an NDA.** Nobody who comes back may talk about it, and nobody comes back.
- **Missing tasters "withdrew from the study."** That is what the families are told, on letterhead.
- **It pays.** Even people who have heard the rumours sign up for the money. The rumours are why it is called haunted: locals see lights in the cellar at night and hear groaning.
- **The tasting is private.** Invitation only, no press, no phones (they are taken at check-in).

### The lab messed up

The owner, 2026-11-09: the lab made the zombies. Munch Foods was cooking up the next big snack, and the batch went wrong: the tasters who ate it are the zombies, still wearing their tasting bibs and wristbands. Rather than shut down, the lab kept going. It is now testing its new products on whoever is left: the power-ups.

So the game's stuff becomes the lab's stuff:

- **Power-ups are test batches.** HOT SAUCE, MEAN BEANS, ZOOMY SOCKS, SHISH KEBULLETS, BIG BURP, and the PICKLED HEART are experimental products, dropped by zombies (who ate them first) and sold at the stall. Each one could wear a batch label.
- **The fridge is the sample fridge.** Mystery Leftovers are unlabeled samples: you never know what a pull gives you, and neither does the lab.
- **The stove is the test kitchen.** Cooking a gun Spicy, Crispy, or Hearty is a recipe trial.
- **The waves are the study going on.** Each wave is the lab sending the next batch of failed tasters through the doors. The longer you stay, the further the study gets, and the worse the batches.

### The zombies as failed batches

The owner, 2026-11-09: the lab is a styling direction for the zombies. Every zombie wears the tasting's marks (a numbered tasting bib, a hospital-style wristband, a lanyard, sample cups stuck to them), and each kind is a product line gone wrong. Their bios already fit; the art gains the lab:

| Zombie      | The batch it ate                                            | Lab styling                                                 |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Groaner     | The control group's snack (the placebo, which still did it) | Tasting bib, wristband, a PLACEBO sticker                   |
| Hotfoot     | The energy drink trial                                      | A runner's number for a participant number, a can in hand   |
| Big Lug     | The protein shake trial, far too much of it                 | Bulked out of his lab coat, still wearing the kitchen       |
| Kaboomer    | The fizzy beans trial                                       | Bloated, a bib stained with beans, the bomb as a gas tank   |
| Big Leaguer | The strength formula                                        | A cut-off lab coat as a jersey, a tray of throwable tasters |
| Ankle Biter | Not a taster: an escaped lab specimen                       | A specimen tag on one leg, a broken jar lid                 |
| Uncle Chunk | Patient Zero: the founder, who tasted it first              | The launch party hat, a VIP lanyard, the first wristband    |

Uncle Chunk is still "the relative nobody invited": the Munch who started the company, ate the first batch at the launch party, and has been the host ever since.

### Rattles, reinvented

The owner, 2026-11-09: Rattles needs a new story for the lab. His look stays (a skeleton in a purple top hat, navy suit, and red bow tie): that is what players know. Proposed:

**The lab's anatomy skeleton.** He was the teaching skeleton on a stand in the lab, until a sample spilled on him. With no flesh, there was nothing for the batch to turn, so he woke up dead but not hungry. He dressed up for the tasting as the maître d', and now runs the check-in desk and the supply cart: he checked everyone in, holds the phones and keys they handed over, and sells the lab's stock (the guns, ammo, planks, the test batches) to anyone still breathing. He wants you out because he wants out too, and you are the only one who can open the front door. Also, he works on commission.

His lines already fit: "Fresh meat! Er, customer." "Bones half off. Not mine." "Freshly pickled! Don't ask whose." "Everything is a bit haunted" becomes a cover story he half believes.

Other ways to reinvent him:

- **The last lab tech.** He tasted every batch to check it was safe, until there was nothing left of him but bones and a good attitude.
- **The study coordinator.** He runs the participant store, as the study's own staff, and the waiver says he is not liable.

### Why the door locks: lockdown

Once you are in, the lab locks the house down: the slam is the containment protocol. The lab will not let anyone leave who might talk, so the only way out is to check out properly, with everything you came in with and your release signed, past Patient Zero at the front door.

- **Why the list changes every run.** Check-in takes your things and the lab files them wherever it likes. A new session, a new mess.
- **Why it gets harder the longer you stay.** The study goes on, and each batch is worse than the last.
- **Why Uncle Chunk waits at the front door.** Patient Zero guards the exit, and a host always sees his guests out.
- **What happens when you are munched.** You have been "re-enrolled". Next session, a new participant arrives (you again, Rattles notes, which is odd).
- **What a Bone is.** Your stipend: paid for every session you survive, more for the ones that get further.

**The party game, kept as the alternative.** Before the tasting, the bridge was a dinner party that is the host's party game, on a deal with the hungry house: he hides your things, locks the door, and lets you try to leave before dinner is served. It keeps the house haunted rather than scientific, and needs no lab.

### The letter at your place

Proposed by the owner on 2026-11-09. Once the doors slam, the first thing in the run is a letter on the dining table at your place setting, on Munch Foods letterhead. Walking onto it picks it up, and it opens: the session's instructions, which are this run's list.

Show, don't explain, so it is mostly pictures, with the fine print as the joke:

> Thank you for tasting with us! The house is now in lockdown.
> To check out, bring: (the icons of this run's things)
> Then see the host at the front door.
> (a fork and knife logo) Munch Foods. (fine print: we are not liable)

Then the letter folds itself into the HUD, and its icons become the empty outlines that fill in as you find things. It is how a new player learns the goal without being told: they picked it up themselves. In co-op the table has one letter at every seat, each with the crew's shared list. The first wave starts once the letter is read (or after a few seconds if no one picks it up), the way READY starts a wave today.

### You start at the table

Proposed by the owner on 2026-11-09. A run starts in the dining room, at your place setting, since you came for the tasting. Today every run starts in the parlour ("Every run starts in the parlour" under "Exploring the manor" in `GAME_DESIGN.md` is decided), so this changes a decision.

The cheap way is to redress the parlour as the dining room: keep its tiles, doors, cover footprints, and stall where they are, so the waves and the balance stay as tuned, and swap the art. The seating group becomes a long tasting table set for a session that never finished, the piano a sideboard, the hearth stays (dining rooms have them too), a candelabra, a chandelier. The boarded double door with the fork and knife sign already leads to the kitchen, which fits a dining room better than a parlour. A new room with its own layout is the costly way: new cover, new lanes, and the waves tuned again.

### The intro: this feels really off

Proposed by the owner on 2026-11-09. A short cutscene between the RSVP and the run, with one feeling: this feels really off. It stays focused: a handful of beats, each with one wrong detail and nothing else on screen, and every wrong detail is a piece of the lore that the run, the Munchopedia, and Rattles pay off later. The player should walk into the dining room already uneasy, and leave the game knowing why.

| Beat                                                                    | What is off                                                                                            | What it sets up                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| START stamps the seal; the RSVP card floats away                        | The seal is the Munch Foods fork and knife. Below your signature, a lot of fine print.                 | You signed a waiver, and you may be the meal                         |
| Your crew in the car at night (you, your plus ones, your co-op friends) | The radio drifts into static. The road sign says MUNCH MANOR, and something has chewed its corner.     | The house is hungry                                                  |
| You pull up at the manor                                                | The drive is full of the other tasters' cars. One still has its headlights on and a door hanging open. | The other tasters came and never left: they are the zombies          |
| You walk up to the front door                                           | A trampled launch party hat and a tasting wristband on the steps. Footprints go in. None come out.     | The launch went wrong, and the host is still here                    |
| Knock knock                                                             | A beat of silence. Then, from somewhere inside, one knock back.                                        | Something in the house answers                                       |
| The doors creak open on their own; you step in                          | The check-in desk: phones and keys in trays nobody came back for, and a bony hand that waves.          | Rattles, the check-in, and the things you need to leave              |
| "HELLO?" The dining room: the table set, the candles lit, nobody there  | Sample cups half eaten, chairs knocked back. Your participant number on a place card, on a plate.      | You are the next tasting                                             |
| The doors slam and lock behind you                                      | A red light flashes once: lockdown. The run starts.                                                    | The front door is the way out, and Uncle Chunk will be waiting at it |

The tone stays the game's: goofy first, scary second (Luigi's Mansion, not a horror film). Each wrong detail is half a joke (the chewed sign, the knock back, the waving hand), so the unease lands with a smile and the slam is the punchline. Music thins out as it goes: a cheery tune in the car, then only footsteps and the house creaking by the door, then silence on HELLO?, then the slam and the run's music.

The dining room's other ways out are boarded, as the parlour's are today, and bought open the same way.

Show, don't explain: pictures, sound, and the one word, HELLO?, in a speech bubble. Any key or tap skips to the slam. The slam itself is never skipped (owner, 2026-11-09): it is the moment the run starts, every time. The cutscene plays in full the first time, and shorter after that (the knock and the slam), so RETRY stays quick. The first PLAY of a new save goes straight into the tutorial, so the cutscene is its opening there too. It is a client cosmetic, like the end card's beat: the World starts the same. In co-op every player sees their own crew in the car, and the run starts on the slam for everyone at once (owner, 2026-11-09): the room sets when the doors slam, a player who skips jumps to the knock at the door and waits there, and every screen slams together.

**Paying it off.** Each detail comes back, so the intro is the first page of the story rather than a one-off: the party hat is Uncle Chunk's, the trays are the check-in desk's, the wristbands are on every zombie, the place card is the joke Rattles makes ("Fresh meat! Er, customer."), and the cars in the drive are where the car keys on the list belong. A Munchopedia entry can unlock for each one once the player finds it in a run.

### What you need to leave changes every run

Proposed by the owner on 2026-11-09, replacing one fixed set of three. Each run rolls its list from a pool of ordinary things a taster needs to check out, from its own salted seeded stream (TranZit, Last Night on Earth). Getting past the host at the front door is always last.

What makes the list fun is less which object it is than how each one comes back to you, so each thing in the pool has its own way:

| Thing                  | How you get it back                                                       |
| ---------------------- | ------------------------------------------------------------------------- |
| Your car keys          | Hidden in one of a few spots: a sofa cushion, the fridge, under the table |
| Your signed release    | Rattles has it, for a price (he works on commission)                      |
| Your wristband scanner | A marked zombie wears it: kill it and grab the drop (CoD style)           |
| Your take-home sample  | Cooked at the kitchen's stove, as a perk is                               |
| Your phone             | Taken at check-in, now ringing somewhere in the house: follow the sound   |
| Your coat              | Behind the boards of a room you have not opened yet                       |
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

Once you hold everything on the list, the lab knows you mean to leave (Dead by Daylight's collapse). The waves press harder until you say goodbye to Uncle Chunk at the front door. That finale is a hold-out (Left 4 Dead): the front door is unlocking, and you hold the hall until it swings open.

### Leaving early

The back door in the kitchen (or a window) is an early exit: leave with part of the list (the car keys, say, but no release), and the run ends as an escape that pays less. The full goodbye pays most. Push your luck (extraction shooters).

### PLAY is the invitation, the lobby is your RSVP

Proposed by the owner on 2026-11-09. The home menu's PLAY is the invitation itself, a sealed envelope with the Munch crest. Opening it opens the lobby, which is the RSVP card you fill in for the tasting, waiver and all. Every pick the lobby has today becomes a line on the card, so the rules and the Block stay as they are and only the dress changes:

| Today's pick      | On the RSVP card                                                          |
| ----------------- | ------------------------------------------------------------------------- |
| Your name         | Guest name, written in your own hand                                      |
| Hero              | Coming as: the Handyman, the Track Star, the Penny Pincher, the Line Cook |
| + BOT seats       | Plus ones: Rattles' rentals, a robot head in each empty seat              |
| Difficulty        | Dress code, or spice level (see below)                                    |
| Modifiers         | Special requests: tick boxes, each with its bonus in gold                 |
| Campaign, Endless | Leaving after dinner, or staying the night                                |
| Map               | The venue, once there is more than one house                              |
| START             | A wax seal stamped on the card with a thunk: you have signed the waiver   |
| BACK              | Regretfully declines                                                      |

In co-op the room is the guest list: each player's own card, filled in side by side, and the room code printed on the invitation you send a friend.

**Difficulty's words.** Easy, Normal, Hard, and Nightmare are the names today, read on the end card and the bests. A food word would fit the card better (a spice level: Mild, Medium, Hot, Ghost Pepper), but renaming them is a change to "Difficulty levels" for the owner to decide. Ticking the level on the card keeps today's names either way.

**What holds it in check.** Show, don't explain: a card of icons and tick boxes, a word or two a line, never a form to read. Every line still works by key, mouse, and touch, in portrait and landscape. Buttons act on click, and the envelope and the seal animate the art inside, never the buttons. The first PLAY of a new save still goes straight into the tutorial, past the card.

### Between runs

Rattles remembers. A few lines that move on with how far you got last time, like Hades: "Back for seconds?" after a death, "Re-enrolled already?" after a quick one, "You left without your release!" after an early exit. Still a few words each.

### Heroes and bots

The heroes are the tasters who never turned, each with their own reason to sign up: the Penny Pincher came for the stipend and the free dinner, the Line Cook was hired to cook the tasting, the Handyman was called in to fix the lab's freezer, and the Track Star signed up for the energy drink trial and skipped the drink. The bots are the lab's helpers, rented out by Rattles.

### What would change in the game

Ordered from cheapest to most work, so the story can land before the systems do:

1. **Words and art only.** The parlour redressed as the dining room, Rattles' new lines, the Munchopedia's bios nudged toward the tasting, the zombies restyled with the lab's bibs and wristbands, the invitation as art (the home menu, the icon, the share card). No rule changes.
2. **One fixed list in fixed spots.** The keys, the ticket, and the goodbye as a goal over the existing ten waves. Victory becomes "you got out".
3. **Rolled spots and a rolled list.** The things move between a few hand-picked hiding spots, and the list itself rolls from the pool, sized by difficulty, from their own seeded stream.
4. **Rolled rooms.** Needs a second room and a pool, and a change to "Not now".
5. **Early exits and the hungrier house.** Needs balance work and the bot to learn the goal.

## Open questions

The lore choices that most change the game, roughly in order.

1. **The tasting.** Settled in direction on 2026-11-09: a private tasting by Munch Foods at the family manor, the lab under it made the zombies, and it now tests its power-ups on you. Left: what the product was, and how much of the haunted house stays.
2. **Who is Rattles now?** Proposed: the lab's anatomy skeleton, woken by a spilled sample (see "Rattles, reinvented").
3. **Who is Uncle Chunk?** Proposed: Patient Zero, the founder who tasted the first batch.
4. **What goes in the pool?** Which things a taster needs to check out, and how each one comes back to you (see "What you need to leave changes every run").
5. **What do the heroes and bots mean in the story?** Proposed: tasters with their own reasons, and the lab's helper robots.
6. **What is a Bone?** Proposed: your stipend for each session you survive.
7. **Do rooms roll, or only what is in them?** See "What it goes against".
8. **Is the dining room the parlour redressed, or a new room?** See "You start at the table".
