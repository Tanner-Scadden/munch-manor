# Flow

The game's vision as flow charts, to plan and talk through with collaborators. It draws from [`GAME_DESIGN.md`](./GAME_DESIGN.md) (what is decided and built) and [`LORE.md`](./LORE.md) (the story). The escape the manor update was built on 2026-11-10 (see "Escape the manor" in `GAME_DESIGN.md`), so most of chart 3 is built now; what is left proposed is marked. When a chart and those docs disagree, the docs win: fix the chart.

The charts are Mermaid, so GitHub draws them. Every chart uses the same key:

```mermaid
flowchart LR
  built[Built and live]:::built
  proposed[Proposed, not decided]:::proposed
  choice{A choice}
  built --> proposed
  built -.->|proposed path| choice

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## 1. A session, from the link to the next run

Everything a player passes through, start to finish.

```mermaid
flowchart TD
  link([Open munchmanor.com or the installed app]):::built --> splash[Loading splash]:::built
  splash --> home
  home --- dareArt[PLAY is the dare: a folded card reading I DARE YOU]:::built

  home[Home menu]:::built --> playBtn{PLAY or CO-OP?}
  home --> more[MORE: How to play, What's New, Munchopedia, Profile, tip jar]:::built
  more --> home

  playBtn -->|PLAY, first time| tutorial[Straight into a run: wave 1 is practice, then the first break teaches a key, a crate, a case, and the dare card]:::built
  playBtn -->|PLAY| lobby[Single player lobby]:::built
  playBtn -->|CO-OP| coop[Co-op hub: code or QUICK PLAY]:::built

  lobby --> picks[Pick hero, mode, difficulty, modifiers, map, add BOT seats]:::built
  coop --> coopLobby[Co-op lobby, up to 4 players]:::built
  coopLobby --> picks

  picks --- dareCard[The lobby is the dare card: going in, coming as, drag along, out or stay, the stakes, extra dares]:::built
  dareCard --> shake[SHAKE ON IT starts the run. CHICKEN OUT goes home]:::built
  shake --> intro[The intro, from the car to the slam: see chart 3]:::built
  intro --> run[[A run: see chart 2]]:::built
  tutorial --> intro

  run --> ended{How did it end?}
  ended -->|Munched| gameOver[Game Over card]:::built
  ended -->|Walked out the front door| escaped[Escaped card: your proof to share]:::built

  gameOver --> reward[Rank bar fills, Bones paid, NEW BEST]:::built
  escaped --> reward

  reward --> spend[Spend Bones: heroes, looks, hats, gun skins]:::built
  reward -.-> rattlesMemory[Your friends in the car remember how the last run ended]:::proposed
  spend --> home
  rattlesMemory -.-> home
  reward -->|RETRY| picks

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## 2. A run: breaks and waves

The core loop: Preparation, then a wave, then Preparation again, until the crew walks out the front door or is munched. Since 2026-11-10 there is no shop and no fixed wave count.

```mermaid
flowchart TD
  start([After the slam: the run starts at the dining room's table, exits padlocked]):::built --> prep

  subgraph Break [Preparation: the break]
    prep[Walk the manor, read the door preview, hunt the dare's list]:::built --> crates[Trap crates: a Plank Pile, a Grumpy Gnome, or a heart for the hurt]:::built
    prep --> cases[Display cases: finish a feat, take the gun]:::built
    prep --> fridge[Mystery Leftovers: spend keys on a pull]:::built
    prep --> boards[Spend skeleton keys on padlocked boards: a room opens]:::built
    prep --> traps[Place traps, stand by one to mend it]:::built
    crates --> ready
    cases --> ready
    fridge --> ready
    boards --> ready
    traps --> ready
    ready{READY?}
  end

  ready -->|READY, or the clock runs out: 30 s on Dare and Double Dare, 20 s above| wave

  subgraph Fight [The wave]
    wave[Zombies through the doors and up through the floor]:::built --> fight[Shoot, stab, swap guns, grab drops and skeleton keys]:::built
    fight --> level[Kills level the gun up: Beefy, DELUXE, 3000]:::built
    fight --> midBuy[Open a room mid-wave]:::built
    fight --> downed{Hearts gone?}
    downed -->|Co-op: a teammate is up| revive[Downed, wait for a revive]:::built
    revive --> fight
    downed -->|No one left| lost([Munched: Game Over]):::built
    downed -->|Still standing| cleared{Wave cleared}
  end

  cleared -->|The list is not done| prep
  cleared -->|The list is done| finale[[The finale: see chart 3]]:::built
  cleared -->|Endless: stay the night| prep

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## 3. Escape the manor

The direction in `LORE.md`, chosen 2026-11-10 and built the same week: the Munch Manor dare. A hundred years ago the Munches threw a dinner party, the doors shut, and nobody came out. You are dared to go in, bring back proof, and get out. The party never ended: Uncle Chunk is still the host, the zombies are his guests and every daredevil who failed, and Rattles took the dare in 1924. The waves stay as the pressure, so a player who ignores the hunt still plays chart 2.

```mermaid
flowchart TD
  dare([Fill in the dare card: going in, coming as, drag along, the stakes]):::built --> shake
  shake[Shake on it]:::built --> car

  subgraph Intro [The intro: this feels really off. Skippable up to the slam]
    car[Your friends drive you up at night: the radio drifts into static, the sign is chewed]:::built --> arrive2[The drive is full of daredevils' cars from every decade]:::built
    arrive2 --> walk[A trampled party hat and a dropped flashlight on the steps]:::built
    walk --> knock[Knock knock. Silence. One knock back]:::built
    knock --> opens[The doors creak open. A hundred years of coats at the coat check, a bony hand waves]:::built
    opens --> hello[HELLO? A feast a hundred years old. A place card with your name on it]:::built
    hello --> door[The doors slam and lock behind you. Never skipped: the run starts here, for everyone at once]:::built
  end

  door --> arrive
  arrive([The run kicks off at the dining room's table, its exits padlocked]):::built --> list

  list[Roll this run's dare: 2 to 4 rooms behind boards, one thing in each, by difficulty]:::built --> pocket
  pocket[The dare card opens from your pocket: your friends' scrawl]:::built --> fold
  fold[The dare card on the HUD: empty outlines to fill]:::built --> waves
  waves[Waves count up, each harder than the last: the number is how far you got]:::built --> explore

  explore[Spend skeleton keys on the padlocked boards, room by room]:::built --> roomRoll{Which room is behind the boards?}
  roomRoll -->|North| fixedRoom[The kitchen, always]:::built
  roomRoll -->|The other three slots| dish[A cloche lifts: the parlour, the library, or the cellar, rolled each run]:::built

  fixedRoom --> hunt
  dish --> hunt

  hunt[Each room holds one thing: find it in the room you opened]:::built
  hunt --> anyThing[Any thing in any room, rolled each run: the recipe, the spoon, the bell, the music box, the portrait, or a guest book page]:::built

  anyThing --> all
  all{Everything but the hat?}

  all -.->|Leave early with part of the dare| early([Early escape: pays less, and you are a chicken]):::proposed
  all -->|Yes| hungry[The house gets hungrier: more zombies]:::built
  hungry --> goodbye[Uncle Chunk comes through the front door, in his party hat, at the next wave: never before wave 6 to 9 by difficulty]:::built
  goodbye --> holdout[Take his hat, then hold the hall while the front door unlocks]:::built
  holdout --> doorMark[A door out of view gets a marker at the screen's edge]:::built
  doorMark --> escaped([Walk out together: Escaped, and the proof to share]):::built

  hungry -->|Munched| lost([Game Over: you join the party]):::built

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

### No shop: how you get stronger

There is no shopkeeper. You get stronger from the house itself, and zombies drop skeleton keys, the one thing you count. Ammo never runs out, but magazines and reloads stay.

```mermaid
flowchart LR
  kill[Drop zombies]:::built --> keys[Skeleton keys: one shared ring in co-op]:::built
  keys --> boards[Padlocked boards: spend the number on the lock, a room opens]:::built
  keys --> fridge[The fridge's padlock: spend keys for a pull]:::built
  kill --> feats[Feats this run: kill counts, skill, exploring]:::built
  feats --> cases[Display cases spring open: a gun or the Laser Sight]:::built
  feats --> stove[The stove and the gas valve]:::built
  kill --> use[Kills with a gun level it up: Beefy, DELUXE, 3000]:::built
  crates[Trap crates each break]:::built --> found[Traps, and a heart when someone is hurt]:::built
  ammo2[Ammo never runs out. Reloads stay]:::built

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
```

### Power-ups are the house's things

Built on 2026-11-10. Each power-up is something you would find in an old manor, and its look on you matches it. Same rules as before; the zombies drop them because the daredevils pocketed them as proof.

| Before          | In the manor  | What it does                     | How it looks on you                           |
| --------------- | ------------- | -------------------------------- | --------------------------------------------- |
| Hot Sauce       | Wind-Up Key   | Rapid fire, never reloads        | A brass key turns in your back, gears tick    |
| Mean Beans      | Family Silver | Twice the damage, more knockback | A silver gleam, shots fly as silver streaks   |
| Zoomy Socks     | Dancing Shoes | Runs 1.4 times as fast           | Music notes and sparkly footprints            |
| Shish Kebullets | Hat Pins      | Shots go through 3 zombies       | A ring of pins circles you, shots fly as pins |
| Big Burp        | Dinner Gong   | A shove all around you           | A gong appears and BONG: a ring of sound      |
| Pickled Heart   | Pickled Heart | One heart                        | Stays: a jar from the curiosity cabinet       |

### Difficulty sets the list

The four levels scale the zombies (health, speed, bites) and the break clock, and since 2026-11-10 they also set how much you have to find and how much Rattles helps. Uncle Chunk's party hat is always the last thing on every list: he comes through the front door wearing it only once the rest is found, at the next wave, but never before wave 6 on Dare, 8 on Double Dare, or 9 on Triple Dare and Triple Dog Dare.

```mermaid
flowchart LR
  easy[Dare: 2 things. Rattles names the room every break, hidden things sparkle]:::built --> normal[Double Dare: 3 things. One hint a break]:::built
  normal --> hard[Triple Dare: 3 things. No sparkle, no hints]:::built
  hard --> nightmare[Triple Dog Dare: 4 things, one in every room behind boards. No hints, Rattles heckles]:::built
  nightmare --> hungrier[The house hungrier from the first find]:::built

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
```

### The order it landed in

From `LORE.md`, cheapest first. Everything but early exits landed in one update (see `docs/ESCAPE_PLAN.md`).

```mermaid
flowchart LR
  words[1. Words and art: the dining room, the power-ups and zombies restyled, the dare card]:::built --> noShop[2. No shop: feats, finds, and skeleton keys]:::built
  noShop --> fixed[3. The dare as the goal, and the finale]:::built
  fixed --> spots[4. Rolled spots and a rolled list, sized by difficulty]:::built
  spots --> rooms[5. Rolled rooms: the parlour, library, and cellar]:::built
  rooms -.-> leave[6. Early exits: balance work]:::proposed

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## Open questions to settle together

The lore choices still open, from `LORE.md`:

1. Which more things join the rooms, and which room each fits.
2. Rattles' lines and his 1924 look.
3. The feat pools per difficulty and the key costs, tuned in the balance pass.
4. Leaving early, and what your friends in the car say between runs.

The build is in [`docs/ESCAPE_PLAN.md`](./docs/ESCAPE_PLAN.md). Settled and built on 2026-11-10: no shop (feats open display cases, guns level up with kills, zombies drop skeleton keys for rooms and the fridge); endless ammo with reloads kept; your friends write the dare card; the power-ups are the house's things; the difficulty levels are Dare, Double Dare, Triple Dare, and Triple Dog Dare; the dining room is a brand-new room; the parlour, the library, and the cellar roll into the house's slots.
