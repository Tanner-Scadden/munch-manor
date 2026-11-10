# Flow

The game's vision as flow charts, to plan and talk through with collaborators. It draws from [`GAME_DESIGN.md`](./GAME_DESIGN.md) (what is decided and built) and [`LORE.md`](./LORE.md) (the escape the manor direction, still a proposal). When a chart and those docs disagree, the docs win: fix the chart.

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
  home -.- dareArt[PLAY is the dare: a card your friends hand you, also the icon and the share card]:::proposed

  home[Home menu]:::built --> playBtn{PLAY or CO-OP?}
  home --> more[MORE: How to play, What's New, Munchopedia, Profile, tip jar]:::built
  more --> home

  playBtn -->|PLAY, first time| tutorial[Straight into a run: wave 1 is the tutorial]:::built
  playBtn -->|PLAY| lobby[Single player lobby]:::built
  playBtn -->|CO-OP| coop[Co-op hub: code or QUICK PLAY]:::built

  lobby --> picks[Pick hero, mode, difficulty, modifiers, map, add BOT seats]:::built
  coop --> coopLobby[Co-op lobby, up to 4 players]:::built
  coopLobby --> picks

  picks -.- dareCard[The lobby is the dare card: who goes in, coming as, who you drag along, the stakes, extra dares]:::proposed
  dareCard -.-> shake[START is shaking on it. BACK is chickening out]:::proposed
  shake -.-> run
  picks --> run[[A run: see chart 2]]:::built
  tutorial --> run

  run --> ended{How did it end?}
  ended -->|Munched| gameOver[Game Over card]:::built
  ended -->|Beat wave 10| victory[Victory card]:::built
  ended -.->|Got out| escaped[Escaped card: your proof to share]:::proposed

  victory -->|KEEP GOING| endless[Same run carries into Endless]:::built
  endless --> run

  gameOver --> reward[Rank bar fills, Bones paid, NEW BEST]:::built
  victory --> reward
  escaped -.-> reward

  reward --> spend[Spend Bones: heroes, looks, hats, gun skins]:::built
  reward --> rattlesMemory[Your friends in the car remember how the last run ended]:::proposed
  spend --> home
  rattlesMemory -.-> home
  reward -->|RETRY| picks

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## 2. A run: breaks and waves

The core loop: Preparation, then a wave, then Preparation again, until the player dies or wins.

```mermaid
flowchart TD
  start([Run starts in the parlour, exits boarded]):::built --> prep

  subgraph Break [Preparation: the break]
    prep[Walk the manor, read the door preview]:::built --> shop[Rattles' stall: guns, ammo, hearts, traps, upgrades]:::built
    prep --> fridge[Mystery Leftovers: the fridge pull]:::built
    prep --> boards[Buy a boarded exit open: the kitchen first]:::built
    prep --> traps[Place Plank Piles and Grumpy Gnomes]:::built
    prep --> stand[Pick a room to make a stand in]:::built
    shop --> ready
    fridge --> ready
    boards --> ready
    traps --> ready
    stand --> ready
    ready{READY?}
  end

  ready -->|Easy, Normal: waits for READY| wave
  ready -->|Hard, Nightmare: clock runs out| wave

  subgraph Fight [The wave]
    wave[Zombies through the doors and up through the floor]:::built --> fight[Shoot, stab, swap guns, grab drops]:::built
    fight --> ammo[Ammo window at the stall]:::built
    fight --> midBuy[Buy a room open mid-wave]:::built
    fight --> downed{Hearts gone?}
    downed -->|Co-op: a teammate is up| revive[Downed, wait for a revive]:::built
    revive --> fight
    downed -->|No one left| lost([Munched: Game Over]):::built
    downed -->|Still standing| cleared{Wave cleared}
  end

  cleared -->|Waves 1 to 9| prep
  cleared -->|Wave 10| boss[Uncle Chunk, the finale]:::built
  boss --> won([Victory]):::built
  won -->|KEEP GOING| endless[Endless: waves keep getting beefier]:::built
  endless --> prep

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## 3. Escape the manor (proposed)

The direction in `LORE.md`, chosen 2026-11-10: the Munch Manor dare. A hundred years ago the Munches threw a dinner party, the doors shut, and nobody came out. You are dared to go in, bring back proof, and get out. The party never ended: Uncle Chunk is still the host, the zombies are his guests and every daredevil who failed, and Rattles took the dare in 1924. The waves stay as the pressure, so a player who ignores the hunt still plays chart 2.

```mermaid
flowchart TD
  dare([Fill in the dare card: who goes in, coming as, who you drag along, the stakes]):::proposed --> shake
  shake[Shake on it: the card goes in your pocket]:::proposed --> car

  subgraph Intro [The intro: this feels really off. Skippable up to the slam]
    car[Your friends drive you up at night: the radio drifts into static, the sign is chewed]:::proposed --> arrive2[The drive is full of daredevils' cars from every decade]:::proposed
    arrive2 --> walk[A trampled party hat and a dropped flashlight on the steps. Footprints go in, none come out]:::proposed
    walk --> knock[Knock knock. Silence. One knock back]:::proposed
    knock --> opens[The doors creak open on their own. A hundred years of coats at the coat check, a bony hand waves]:::proposed
    opens --> hello[HELLO? A feast a hundred years old, still steaming. A place card with your name on it]:::proposed
    hello --> door[The doors slam and lock behind you. Never skipped: the run starts here, for everyone at once]:::proposed
  end

  door --> arrive
  arrive([The run kicks off in the dining room, its exits boarded]):::proposed --> list

  list[Roll this run's dare from the pool: 2 to 4 things, by difficulty]:::proposed --> card
  card[The dare card opens: your friends' scrawl, this run's list in pictures]:::proposed --> fold
  fold[The card folds into the HUD: empty outlines to fill. The first wave starts]:::proposed --> waves
  waves[Waves count up, each harder than the last: the number is how far you got]:::proposed --> explore

  explore[Spend skeleton keys on the padlocked boards, room by room]:::proposed --> roomRoll{Which room is behind the boards?}
  roomRoll -->|Today| fixedRoom[The kitchen, always]:::built
  roomRoll -.->|Rolled rooms| dish[A cloche lifts: one of a few hand-made rooms]:::proposed

  fixedRoom --> hunt
  dish -.-> hunt

  hunt{How does this thing come to you?}:::proposed
  hunt --> hidden[Hidden in one of a few spots: the silver spoon in a sofa]:::proposed
  hunt --> carried[A daredevil zombie carries it: drop him, grab the portrait]:::proposed
  hunt --> bought[Locked in a display case, opened by a feat: a page of the guest book]:::proposed
  hunt --> cooked[Made at the stove: Grandma Munch's recipe]:::proposed
  hunt --> heard[Follow the sound: the music box playing]:::proposed

  hidden --> all
  carried --> all
  bought --> all
  cooked --> all
  heard --> all
  all{Everything but the hat?}

  all -.->|Leave early with part of the dare| early([Early escape: pays less, and you are a chicken]):::proposed
  all -->|Yes| hungry[The house gets hungrier: waves press harder]:::proposed
  hungry --> goodbye[Uncle Chunk appears at the front door, only now, in his party hat]:::proposed
  goodbye --> holdout[Take his hat, then hold the hall while the front door unlocks]:::proposed
  holdout --> escaped([Escaped with the whole dare: pays most, and the proof to share]):::proposed

  hungry -->|Munched| lost([Game Over: you join the party. Your friends remember]):::built

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

### No shop: how you get stronger

There is no shopkeeper. You get stronger from the house itself, and zombies drop skeleton keys, the one thing you count. Ammo never runs out, but magazines and reloads stay.

```mermaid
flowchart LR
  kill[Drop zombies]:::proposed --> keys[Skeleton keys]:::proposed
  keys --> boards[Padlocked boards: spend the number on the lock, a room opens]:::proposed
  keys --> fridge[The fridge's padlock: spend keys for a pull]:::proposed
  kill --> feats[Feats this run: kill counts, skill, exploring]:::proposed
  feats --> cases[Display cases spring open: a gun]:::proposed
  find[Things the dare did not ask for]:::proposed --> cases
  kill --> use[Kills with a gun level it up: Beefy, DELUXE, 3000]:::proposed
  rooms[Rooms and drops]:::proposed --> found[Hearts and traps found where they lie]:::proposed
  ammo2[Ammo never runs out. Reloads stay]:::proposed

  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

### Power-ups are the house's things

Each power-up becomes something you would find in an old manor, and its look on you matches it. Same rules as today; the zombies drop them because the daredevils pocketed them as proof.

| Today           | In the manor  | What it does                     | How it looks on you                           |
| --------------- | ------------- | -------------------------------- | --------------------------------------------- |
| Hot Sauce       | Wind-Up Key   | Rapid fire, never reloads        | A brass key turns in your back, gears tick    |
| Mean Beans      | Family Silver | Twice the damage, more knockback | A silver gleam, shots fly as silver streaks   |
| Zoomy Socks     | Dancing Shoes | Runs 1.4 times as fast           | Music notes and sparkly footprints            |
| Shish Kebullets | Hat Pins      | Shots go through 3 zombies       | A ring of pins circles you, shots fly as pins |
| Big Burp        | Dinner Gong   | A shove all around you           | A gong appears and BONG: a ring of sound      |
| Pickled Heart   | Pickled Heart | One heart                        | Stays: a jar from the curiosity cabinet       |

### Difficulty sets the list

Today the four levels scale only the zombies (health, speed, bites) and the break clock. The escape adds a second dial: how much you have to find, and how hard the house hides it. Uncle Chunk's party hat is always the last thing on every list: he shows up at the front door wearing it only once the rest is found, never at a set wave.

```mermaid
flowchart LR
  easy[Dare: 2 things. The card's doodles point the way, spots sparkle]:::proposed --> normal[Double Dare: 3 things. One doodled hint a break]:::proposed
  normal --> hard[Triple Dare: 3 things. No sparkle, one is always on a marked zombie]:::proposed
  hard --> nightmare[Triple Dog Dare: 4 things. The house gets hungrier from the first find, no hints]:::proposed

  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

### The order it would land in

From `LORE.md`, cheapest first, so the story lands before the systems do.

```mermaid
flowchart LR
  words[1. Words and art: the dining room, the power-ups and zombies restyled, the dare card art]:::proposed --> noShop[No shop: feats, finds, and skeleton keys]:::proposed
  noShop --> fixed[2. One fixed dare in fixed spots]:::proposed
  fixed --> spots[3. Rolled spots and a rolled list, sized by difficulty]:::proposed
  spots --> rooms[4. Rolled rooms: needs a second room and a change to Not now]:::proposed
  rooms --> leave[5. Early exits and the hungrier house: balance work]:::proposed

  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## Open questions to settle together

The lore choices that most change these charts, from `LORE.md`:

1. What goes in the pool of things the dare asks for, and how does each one come to you?
2. What does Rattles say now? He stays as the 1924 daredevil who gives hints.
3. Which feats open which display cases, and how many skeleton keys a room and a fridge pull cost?
4. Do rooms roll, or only what is in them?

The build is planned in [`docs/ESCAPE_PLAN.md`](./docs/ESCAPE_PLAN.md). Settled on 2026-11-10: no shop (feats open display cases, guns level up with use, zombies drop skeleton keys for rooms and the fridge); endless ammo with reloads kept; your friends write the dare card; the power-ups become the house's things; the difficulty levels are Dare, Double Dare, Triple Dare, and Triple Dog Dare; the dining room is a brand-new room.
