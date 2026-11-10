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
  home -.- invite[PLAY is the invitation: a sealed envelope, also the icon and the share card]:::proposed

  home[Home menu]:::built --> playBtn{PLAY or CO-OP?}
  home --> more[MORE: How to play, What's New, Munchopedia, Profile, tip jar]:::built
  more --> home

  playBtn -->|PLAY, first time| tutorial[Straight into a run: wave 1 is the tutorial]:::built
  playBtn -->|PLAY| lobby[Single player lobby]:::built
  playBtn -->|CO-OP| coop[Co-op hub: code or QUICK PLAY]:::built

  lobby --> picks[Pick hero, mode, difficulty, modifiers, map, add BOT seats]:::built
  coop --> coopLobby[Co-op lobby, up to 4 players]:::built
  coopLobby --> picks

  picks -.- rsvp[The lobby is your RSVP card: name, coming as, plus ones, dress code, requests]:::proposed
  rsvp -.-> seal[START is sealing it: a wax stamp, then you sit down at the table]:::proposed
  seal -.-> run
  picks --> run[[A run: see chart 2]]:::built
  tutorial --> run

  run --> ended{How did it end?}
  ended -->|Munched| gameOver[Game Over card]:::built
  ended -->|Beat wave 10| victory[Victory card]:::built
  ended -.->|Got out| escaped[Escaped card]:::proposed

  victory -->|KEEP GOING| endless[Same run carries into Endless]:::built
  endless --> run

  gameOver --> reward[Rank bar fills, Bones paid, NEW BEST]:::built
  victory --> reward
  escaped -.-> reward

  reward --> spend[Spend Bones: heroes, looks, hats, gun skins]:::built
  reward --> rattlesMemory[Rattles remembers how the last run ended]:::proposed
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

The direction in `LORE.md`: you came to dinner and you are the main course. You fill in your RSVP, a cutscene drives your crew up to the manor and the doors slam behind you, the run kicks off in the dining room with its exits boarded as today, and this run's list of what you need to leave is rolled from a pool, longer the harder the difficulty. The waves stay as the pressure, so a player who ignores the hunt still plays chart 2. Nothing here is decided.

```mermaid
flowchart TD
  rsvp([Fill in the RSVP card: name, coming as, plus ones, requests]):::proposed --> seal
  seal[Stamp the wax seal: the card floats away]:::proposed --> car

  subgraph Intro [The intro: this feels really off. Skippable up to the slam]
    car[The car at night: the radio drifts into static, the sign is chewed]:::proposed --> arrive2[The drive is full of guests' cars, one with its door hanging open]:::proposed
    arrive2 --> walk[A trampled party hat on the steps. Footprints go in, none come out]:::proposed
    walk --> knock[Knock knock. Silence. One knock back]:::proposed
    knock --> opens[The doors creak open on their own. Coats nobody came back for, a bony hand waves]:::proposed
    opens --> hello[HELLO? Plates half eaten, chairs knocked back. Your name on a place card, on a plate]:::proposed
    hello --> door[The doors slam and lock behind you. Never skipped: the run starts here, for everyone at once]:::proposed
  end

  door --> arrive
  arrive([The run kicks off in the dining room, its exits boarded]):::proposed --> list

  list[Roll this run's list from the pool: 2 to 4 things, by difficulty]:::proposed --> waves
  waves[Waves count up, each harder than the last: the number is how far you got]:::proposed --> explore

  explore[Buy boards open, room by room]:::built --> roomRoll{Which room is behind the boards?}
  roomRoll -->|Today| fixedRoom[The kitchen, always]:::built
  roomRoll -.->|Rolled rooms| dish[A cloche lifts: one of a few hand-made rooms]:::proposed

  fixedRoom --> hunt
  dish -.-> hunt

  hunt{How does this thing come back to you?}:::proposed
  hunt --> hidden[Hidden in one of a few spots: car keys in a sofa]:::proposed
  hunt --> carried[A marked zombie carries it: kill it, grab the drop]:::proposed
  hunt --> bought[Rattles has it, for a price: the coat ticket]:::proposed
  hunt --> cooked[Made at the stove: the doggy bag]:::proposed
  hunt --> heard[Follow the sound: your phone ringing]:::proposed

  hidden --> all
  carried --> all
  bought --> all
  cooked --> all
  heard --> all
  all{Everything on the list?}

  all -.->|Leave early with part of the list| early([Early escape: pays less]):::proposed
  all -->|Yes| hungry[The house gets hungrier: waves press harder]:::proposed
  hungry --> goodbye[Uncle Chunk appears at the front door, only now: say goodbye to the host]:::proposed
  goodbye --> holdout[Hold the hall while the front door unlocks]:::proposed
  holdout --> escaped([Escaped: the full goodbye pays most]):::proposed

  hungry -->|Munched| lost([Game Over: Rattles remembers]):::built

  classDef built fill:#1f3d2b,stroke:#4caf50,color:#fff
  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

### Difficulty sets the list

Today the four levels scale only the zombies (health, speed, bites) and the break clock. The escape adds a second dial: how much you have to find, and how hard the house hides it. Uncle Chunk's goodbye is always the last thing on every list: he shows up at the front door only once the rest is found, never at a set wave.

```mermaid
flowchart LR
  easy[Easy: 2 things. Rattles points the way, spots sparkle in breaks]:::proposed --> normal[Normal: 3 things. Rattles hints once per break]:::proposed
  normal --> hard[Hard: 3 things. No sparkle, one is always on a marked zombie]:::proposed
  hard --> nightmare[Nightmare: 4 things. The house gets hungrier from the first find, no hints]:::proposed

  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

### The order it would land in

From `LORE.md`, cheapest first, so the story lands before the systems do.

```mermaid
flowchart LR
  words[1. Words and art: the dining room, Rattles' lines, the invitation art]:::proposed --> fixed[2. One fixed list in fixed spots]:::proposed
  fixed --> spots[3. Rolled spots and a rolled list, sized by difficulty]:::proposed
  spots --> rooms[4. Rolled rooms: needs a second room and a change to Not now]:::proposed
  rooms --> leave[5. Early exits and the hungrier house: balance work]:::proposed

  classDef proposed fill:#3d2b1f,stroke:#ff9800,color:#fff,stroke-dasharray: 5 5
```

## Open questions to settle together

The lore choices that most change these charts, from `LORE.md`:

1. Why are you in the manor: invited, broke in, inherited it, or woke up there?
2. Who are the zombies, and does Uncle Chunk lead them?
3. Who is Rattles: the butler, a past guest, the first owner, or the house's own salesman?
4. What locks you in: Uncle Chunk, the house, a curse, or Rattles?
5. What goes in the pool of things to leave with, and how does each one come back to you?
6. Is the dining room the parlour redressed, or a new room?
7. Do rooms roll, or only what is in them?
