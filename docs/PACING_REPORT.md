# Pacing report: why a run feels "a bit meh"

Written 2026-11-10 as research for the owner. Nothing here changes the game. The owner, after beating the escape: "The pacing always feels a bit too slow? Maybe the map will help with it, but feels a bit meh often."

**The short answer.** The waves are not empty. Dead air (no zombie alive) is only 1 to 2.5 s a wave, and a pack comes every 1.5 to 3 s. The trouble is that the waves are **flat**. From wave 3 on the bot kills about one zombie a second in every wave. It loses under one heart a wave on Double Dare until wave 6. Waves get **longer** (50 s to 88 s), not **hotter**. Each wave also ends on a slow fall: about 13 s after the last pack enters, then a 30 s break that is mostly walking. So about **44% of a run** at the break clock is a break or a stretch with fewer than 3 zombies alive. Between new things (a room, a case, a list item) the player sits through about two waves of the same fight. The map rework will help the second part. It does not touch the first.

## How it was measured

- `tools/balance/pacing.ts` (new, on this branch) plays campaign runs with the balance bot and reads the World every frame through a new `onFrame` hook in `tools/balance/bot.ts`. It records each wave's length, the time with fewer than 3 zombies alive, the time with no zombie at all, and the time with no living zombie inside the 320 by 180 landscape view ("no target"). It also records the first zombie in the room, the first within 120 px of the player, each pack's entry time, the time after the last pack enters ("tail"), and the time once nothing is left to spawn and at most 2 are alive ("stragglers"). Per wave it adds kills a second and hearts lost. Per run it records each break, each room opening, the list's completion, and the run length. Run it with `bun run heavy -- --cpu sh tools/balance/pacing.sh <runs>` (with `DIFFICULTY=` and `AIM=`), then `bun tools/balance/pacing.ts report`.
- 144 runs: Dare (Easy) 32 and Double Dare (Normal) 48 on the human bot, and Triple Dare (Hard) 32 and Triple Dog Dare (Nightmare) 32 on `AIM=sharp`, as the nightly plays them. Seeds `seedAt(1, i)`. Wave rows count only the waves that were cleared, and the numbers are medians over runs.
- **Caveats.** The bot presses READY as soon as its break jobs are done, and it walks the shortest route, so a person's breaks and walks are longer. Its kill rate is a fair stand-in: since 2026-10-31 the default bot aims like a person. The escape shares here (Normal 30 of 48) are well above the 2026-11-10 nightly's 29.5%. That could be the seeds, the sample, or a change since; check it before trusting win numbers. The pacing numbers barely move between difficulties, so they hold either way. The Normal job ran 15 m 41 s on one worker, past the guard's 10 minute lease; `pacing.sh` should yield between slices before it is used again.

## 1. The numbers

### Waves, Double Dare (Normal), human bot, 48 runs

| Wave | Runs | Zombies | Length s | Under 3 alive s | Empty s | No target in view s | Resting s | First in s | First near s | Pack gap s | Tail after last pack s | Stragglers s | Kills/s | Hearts lost |
| ---- | ---- | ------- | -------- | --------------- | ------- | ------------------- | --------- | ---------- | ------------ | ---------- | ---------------------- | ------------ | ------- | ----------- |
| 1    | 48   | 6       | 23.4     | 12.0            | 1.5     | 4.5                 | 0.0       | 1.5        | 5.1          | 3.1        | 8.8                    | 3.6          | 0.26    | 0.00        |
| 2    | 48   | 31      | 41.2     | 8.8             | 1.5     | 3.9                 | 2.1       | 1.4        | 4.9          | 2.6        | 7.8                    | 2.0          | 0.75    | 0.06        |
| 3    | 48   | 49      | 50.3     | 9.5             | 1.5     | 5.3                 | 2.6       | 1.5        | 4.1          | 1.7        | 5.5                    | 1.9          | 0.97    | 0.23        |
| 4    | 47   | 66      | 64.4     | 8.2             | 1.0     | 8.3                 | 2.6       | 0.8        | 3.6          | 2.2        | 12.2                   | 1.1          | 1.01    | 0.64        |
| 5    | 45   | 62      | 68.3     | 10.9            | 2.5     | 12.3                | 2.6       | 1.5        | 5.4          | 2.6        | 13.0                   | 3.6          | 0.91    | 0.67        |
| 6    | 42   | 67      | 69.8     | 10.4            | 1.5     | 9.8                 | 3.1       | 1.3        | 3.8          | 1.6        | 16.4                   | 4.9          | 0.96    | 1.48        |
| 7    | 36   | 73      | 87.9     | 15.4            | 1.8     | 17.1                | 5.7       | 1.2        | 5.9          | 1.6        | 14.9                   | 3.3          | 0.83    | 0.83        |
| 8    | 33   | 60      | 63.2     | 9.2             | 1.5     | 10.9                | 2.6       | 1.5        | 5.0          | 1.3        | 13.6                   | 2.0          | 0.95    | 0.52        |
| 9    | 23   | 67      | 68.2     | 8.1             | 1.2     | 13.8                | 5.6       | 1.0        | 4.1          | 1.2        | 9.0                    | 0.2          | 0.84    | 0.87        |
| 10   | 10   | 56      | 66.7     | 11.0            | 0.9     | 16.9                | 5.6       | 0.8        | 6.7          | 1.5        | (Chunk)                | (Chunk)      | 0.58    | 0.80        |

### Waves by difficulty, side by side (median length s / under 3 alive s / kills a second)

| Wave | Dare (human)       | Double Dare (human) | Triple Dare (sharp) | Triple Dog Dare (sharp) |
| ---- | ------------------ | ------------------- | ------------------- | ----------------------- |
| 1    | 24.2 / 11.7 / 0.25 | 23.4 / 12.0 / 0.26  | 22.4 / 12.6 / 0.27  | 22.4 / 12.6 / 0.27      |
| 2    | 41.7 / 9.5 / 0.74  | 41.2 / 8.8 / 0.75   | 40.2 / 9.6 / 0.77   | 40.2 / 9.6 / 0.77       |
| 3    | 51.9 / 11.0 / 0.94 | 50.3 / 9.5 / 0.97   | 50.7 / 10.4 / 0.97  | 51.2 / 9.6 / 0.96       |
| 4    | 65.7 / 8.5 / 1.00  | 64.4 / 8.2 / 1.01   | 62.2 / 9.1 / 1.06   | 62.3 / 7.8 / 1.14       |
| 5    | 71.2 / 9.8 / 0.87  | 68.3 / 10.9 / 0.91  | 67.0 / 7.9 / 0.92   | 71.2 / 9.2 / 1.06       |
| 6    | 66.4 / 10.9 / 0.96 | 69.8 / 10.4 / 0.96  | 69.7 / 10.0 / 0.95  | 69.3 / 11.8 / 1.20      |
| 7    | 88.9 / 16.4 / 0.80 | 87.9 / 15.4 / 0.83  | 85.7 / 12.5 / 0.84  | 92.6 / 18.8 / 0.98      |
| 8    | 65.9 / 7.7 / 0.91  | 63.2 / 9.2 / 0.95   | 61.0 / 8.5 / 1.03   | 65.9 / 8.9 / 1.14       |
| 9    | 75.0 / 9.1 / 0.84  | 68.2 / 8.1 / 0.84   | 77.3 / 10.5 / 0.90  | 84.5 / 11.5 / 0.94      |
| 10   | 75.5 / 9.9 / 0.74  | 66.7 / 11.0 / 0.58  | 88.0 / 13.8 / 0.69  | 67.4 / 10.4 / 0.76      |

Every difficulty plays the same tempo. The tables only change zombie health, speed, and bites (by design, "Difficulty levels"), so a harder dare is the same rhythm with more danger, and an easier one is the same rhythm with less.

### Share of wave time, all cleared waves

| Difficulty      | Under 3 alive | No target in view | After the last pack | Kills a minute | A break or under 3 alive, breaks at the clock |
| --------------- | ------------- | ----------------- | ------------------- | -------------- | --------------------------------------------- |
| Dare            | 19%           | 14%               | 19%                 | 51             | 45%                                           |
| Double Dare     | 18%           | 16%               | 19%                 | 52             | 44%                                           |
| Triple Dare     | 20%           | 13%               | 18%                 | 52             | 41%                                           |
| Triple Dog Dare | 22%           | 12%               | 19%                 | 54             | 44%                                           |

### Breaks (the bot's, which ends a break once its jobs are done)

| Break before wave | Dare s | Double Dare s | Double Dare walked px | Triple Dare s | Triple Dog Dare s |
| ----------------- | ------ | ------------- | --------------------- | ------------- | ----------------- |
| 3                 | 30.0   | 30.0          | 1234                  | 20.0          | 20.0              |
| 4                 | 30.0   | 26.7          | 1370                  | 20.0          | 20.0              |
| 5                 | 30.0   | 20.7          | 1230                  | 20.1          | 20.1              |
| 6                 | 30.0   | 14.1          | 873                   | 20.0          | 20.0              |
| 7                 | 17.4   | 20.7          | 1240                  | 20.0          | 20.0              |
| 8                 | 16.4   | 4.0           | 208                   | 10.0          | 20.0              |
| 9                 | 30.1   | 18.1          | 1234                  | 20.0          | 20.0              |
| 10                | 30.0   | 30.1          | 2082                  | 20.0          | 20.1              |

The player runs 72 px a second, so 1200 to 2000 px is 17 to 28 s of walking: **a break is a walk**. On Triple Dare and Triple Dog Dare the bot uses the whole 20 s clock in almost every break, and still pulls the fridge in under a tenth of runs (the nightly's follow-up).

### The run

| Difficulty      | Escapes | Escape, median | Of it waves / breaks (bot) | Escape with every break to its clock | Break share at the clock | Kitchen (8 keys) | Room 2 (55) | Room 3 (90) | Room 4 (90)  | List done | Uncle Chunk |
| --------------- | ------- | -------------- | -------------------------- | ------------------------------------ | ------------------------ | ---------------- | ----------- | ----------- | ------------ | --------- | ----------- |
| Dare            | 17/32   | 8.2 min        | 388 s / 119 s              | 9.5 min                              | 30%                      | wave 4, 2.5 min  | w5, 4.3 min | w7, 7.3 min | w10 (8 runs) | wave 7    | wave 7      |
| Double Dare     | 30/48   | 10.9 min       | 528 s / 128 s              | 12.7 min                             | 30%                      | wave 3, 1.3 min  | w5, 4.2 min | w7, 6.8 min | w9 (24 runs) | wave 9    | wave 9      |
| Triple Dare     | 5/32    | 13.0 min       | 673 s / 133 s              | 14.2 min                             | 26%                      | wave 4, 2.2 min  | w5, 3.8 min | w7, 6.6 min | w9 (9 runs)  | wave 9    | wave 10     |
| Triple Dog Dare | 2/32    | 12.4 min       | 598 s / 145 s              | 12.8 min                             | 26%                      | wave 4, 2.2 min  | w5, 3.7 min | w6, 5.4 min | w8 (5 runs)  | wave 8.5  | wave 9      |

Keys found by the end of each wave (Double Dare median; the other dares are within a few): 2, 12, 30, 67, 103, 144, 181, 214, 247, 277. Against the padlocks (8, then 55, then 90, then 90: 243 in all), the rooms open in the breaks before waves 3, 5, 7, and 9. **The keys, not the list, set the run's length**: on Double Dare the last room opens on the wave the list is done, and Uncle Chunk comes next. The "list done by wave 4" in `GAME_DESIGN.md` predates the 8, 55, 90 padlocks and is stale.

### Against the references

|                | Munch Manor (Double Dare)                                            | CoD Zombies (Treyarch, solo)                                                 | Left 4 Dead's AI Director                                                                                |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| First wave     | 6 zombies over 23 s; 12 s with under 3 alive                         | 6 zombies, one tried every 2 s, so all are out in about 12 s                 | n/a                                                                                                      |
| Ramp           | wave 5: 62 zombies; tempo flat at about 1 kill a second from wave 3  | round 5: 24; the spawn delay falls ×0.95 a round, so tempo rises every round | a harder game raises how often a peak comes, not how big it is                                           |
| Peak           | a scripted sawtooth, 5 to 8 s peaks                                  | the cap of 24 alive is the peak; the round is one long press                 | build up until the team's intensity crosses a line, hold the peak 3 to 5 s, fade until the fight is done |
| Relax          | 2 to 6 s rests in a wave, then a 30 s break (20 s on the hard dares) | 10 s between rounds                                                          | 30 to 45 s, or until the team moves on                                                                   |
| End of a round | the last pack's fight plays out: 13 s on average after it enters     | from round 4 the last zombie sprints once the second to last dies            | Peak Fade holds off new threats until the fight that caused the peak is over                             |

Sources: Mike Booth, [The AI Systems of Left 4 Dead (GDC 2009 slides)](https://www.slideshare.net/slideshow/ai-left-4-dead/19893053), the [AiGameDev "11 Secrets" article](https://www.cs.drexel.edu/~so367/teaching/2012/CS680/papers/11%20Secrets%20about%20LEFT%204%20DEAD%e2%80%99s%20AI%20Director%20and%20its%20Procedural%20Zombie%20Population%20%7c%20AiGameDev.com.pdf), the [Treyarch Zombies wiki](<https://callofduty.fandom.com/wiki/Zombies_(Treyarch)>) (round counts), [Project Lazarus wiki: Rounds](https://project-lazarus.fandom.com/wiki/Rounds) (the 2 s ×0.95 spawn delay), the [CoD wiki: Zombie](https://callofduty.fandom.com/wiki/Zombie) (the last zombie sprints), and the [UGX spawn delay thread](https://www.ugx-mods.com/forum/help-desk/10/zombie-spawning-delay/8886/) and [NextGenUpdate BO2 thread](https://nextgenupdate.com/forums/black-ops-2-gsc-mods-scripts-questions/886137-bo2-how-change-perk-cost-zombie-spawn-delay.html) (`zombie_spawn_delay`, `zombie_between_round_time`).

The lesson from both: **the pressure has to climb.** L4D climbs until the players feel it, then lets go. CoD climbs every round and lets the round's end snap shut. Ours runs a script that a decent player keeps up with from wave 3 on. Its sawtooth has the right shape but too little height, and its waves end with a fade and then a long break.

## 2. Where the "meh" comes from, ranked

1. **Flat tempo, low peaks (the biggest).** About 1 kill a second from wave 3 to wave 10 on every dare, while waves grow from 50 to 88 s. The fight in wave 8 feels like the fight in wave 3, only longer. On Double Dare the player loses under one heart a wave except wave 6. Zombies enter at about 1.2 a second and the player kills about 1 a second, so the room rarely fills. Double Dare's health ×0.68 (two pistol shots for a Groaner) makes every pack melt. The design asks for peaks of 1.5 to 2.5 times the player's damage ("Difficulty principles"); the bot never feels one. The wave just goes on.
2. **Every wave ends on a slow fall, then a long break.** After the last pack enters there are 9 to 16 s (19% of wave time) of mopping up the final peak, then a 30 s break. That is about 45 s of falling or no action between one wave's last peak and the next wave's first, about every 1.5 minutes. The real stragglers (at most 2 alive, nothing to come) are short, 1 to 5 s. The slow part is the last peak's fight dragging on, not one lost zombie.
3. **Two waves between new things.** The rooms open on waves 3, 5, 7, and 9, each behind a key price that takes about two waves to earn. In between, the house, the doors, and the guns are the same, so waves 4, 6, and 8 add nothing new. That reads as "slow" even when the fight is busy.
4. **The break is a walk.** The bot walks 1200 to 2000 px in most breaks (17 to 28 s): crate, case, room, list item, back. A person is slower. With 30 s on the clock, a break is a chore list, not a breath, and on the 20 s dares it doesn't fit.
5. **Off-screen zombies in the big house.** 12 to 16% of wave time has no zombie inside the 320 by 180 view. Late waves reach 17 s (wave 7) when far rooms' doors join. The first zombie is in the room at 1.5 s but reaches the player at 4 to 6 s. In a big house the walk-in eats the build up.
6. **Wave 1 is thin.** 6 Groaners over 23 s, 12 s with under 3 alive, 0.26 kills a second. It is the same count as CoD's round 1, spread over twice the time. It is the first minute of every run, tutorial done or not.
7. **Not the cause:** dead air inside a wave (no zombie alive) is 1 to 2.5 s, within the 3 s target; the quiet hurry works. Pack gaps (1.2 to 3.1 s) are short. Key earning is not slow in itself (about 30 keys a wave); the prices are what space the rooms.

## 3. Fixes

| #   | Fix                                                                                                                                                                                                                                                                                                  | Expected effect                                                                                                                                                                                                                         | Cost                                                                        | Rooms rework covers it?                                                        | Touches a "Decided" rule?                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Raise the peaks, not the length.** For waves 3 to 9, pull each peak's packs closer (pack gap ×0.7) and move about 15% of each wave's zombies from the builds into the peaks, with the same count per wave. Hold Double Dare's peak to 1.5 to 2.5 times the player's damage, as the principle asks. | Waves 10 to 20% shorter, peak alive from about 5 to 8 to 10, more close calls, kills a second rising from 1.0 toward 1.4 by wave 8. Deaths move later in waves. Needs the balance bot to keep escapes in target.                        | M: `wavePlans.ts` tables, 3 balance batches                                 | No                                                                             | No. "Packs and pacing" is proposed, not decided.                                                                              |
| 2   | **Straggler hurry-up.** Once nothing is left to spawn and 3 or fewer are alive for 3 s, the rest get a rage tell and sprint (×1.6), and an off-screen one gets an edge marker. CoD does this from round 4.                                                                                           | Tail after the last pack from about 13 s to about 6 s. Saves about 1 minute a run and ends each wave on a snap, not a fade.                                                                                                             | S: one pacing rule, the rage frames exist, the edge marker exists for co-op | No                                                                             | No. Deterministic from the World; it is telegraphed, so it keeps "Telegraph every threat".                                    |
| 3   | **Shorter, denser wave 1 and 2.** Wave 1: 8 Groaners in two quick squads, done in about 15 s. Wave 2: 31 zombies with the hold at 12 s instead of 17.5 s.                                                                                                                                            | First minute about 15 s shorter and twice as busy. Wave 1 still can't kill (bites are mercy-blinked), and the tutorial's practice wave keeps its own plan.                                                                              | S                                                                           | No                                                                             | No                                                                                                                            |
| 4   | **READY early pays keys.** Starting a wave before the clock pays 1 skeleton key per 5 s left (6 on a full 30 s break), shown as keys flying to the ring as the clock bar empties.                                                                                                                    | The 30 s break stays for those who want it. A player who is done gets a reason to go, and the bot's early READY (21 to 23% of the run in breaks against 30% at the clock) becomes a human habit. Rooms come a little sooner.            | S: the break clock, the key ring, one HUD flourish                          | No                                                                             | No: the break lengths stay. It is new key income (the key prices are "untuned").                                              |
| 5   | **Space the rooms closer.** 8, 40, 75 for the second and third rooms (the far one stays 90). Or keep the prices and drop 1 bonus key per pack wiped as a 2.                                                                                                                                          | Rooms on waves 3, 4, 6, and 8 instead of 3, 5, 7, and 9. Something new about every 1.5 waves, and the list done a wave sooner, so Uncle Chunk arrives on his floor wave (8 on Double Dare) more often. Shortens escapes about 1 minute. | S: `EXIT_RULES`, 1 to 2 balance batches                                     | Partly: rooms that "wake up" make each opening an event, not just a sooner one | The 8, 55, 90 prices were set on 2026-11-10 in "Skeleton keys" (Decided) and called untuned. A new price is the owner's call. |
| 6   | **Rooms wake up when they open, and room tools work mid-wave.** As in `ROOM_RESEARCH.md` (P8, question 8): a short burst from the new room's own doors, and each room's verb (gramophone, toppling stacks, barrels, the chandelier's winch) used in a wave.                                          | Mid-wave spikes the player sets off, a new thing to do in waves 4, 6, and 8. This is the L4D "crescendo" the owner wants.                                                                                                               | M to L                                                                      | **Yes**, fully                                                                 | Some of the rooms rework does (see its table). Not the pacing part.                                                           |
| 7   | **Doors near the player.** When a wave is rolled at Preparation, weight its any-door groups toward the doors of the room the player stands in and its neighbours (2 to 1), so a big house doesn't send half a wave on a 6 s walk.                                                                    | No target in view from about 16% to about 10% of wave time; first near from about 5 s to about 3 s. The preview stays exact, since doors are fixed when Preparation begins.                                                             | M: `wavePacks.ts` door draw, co-op (every seat counts), balance             | No                                                                             | Not decided, but it bends "No rubber banding" a little: it reads where the player stands, once, before the wave. Say so.      |
| 8   | **A marked zombie mid-wave.** Once a wave, from wave 3, a gold-collared Groaner enters with a peak and runs from the player; killing it drops 5 keys. The "key off a marked zombie" feat already exists.                                                                                             | A chase in the build up and the tail, a reason to leave the hold, and a little faster key earning.                                                                                                                                      | S to M                                                                      | No, but it fits its "finds"                                                    | No                                                                                                                            |
| 9   | **Cut wave 7's length.** Wave 7 is the long one (88 s, 15 s under 3 alive, 17 s no target): split its last two groups so its fade ends sooner, or drop the 47 s squad.                                                                                                                               | About 15 s off one wave per run, and its length into the 90 s ceiling with room to spare.                                                                                                                                               | S                                                                           | No                                                                             | No                                                                                                                            |

Not recommended: **shorter breaks** (decided by the owner, and the bot shows the hard dares' 20 s already doesn't fit the walk). Rather, make the break worth leaving early (fix 4). **More spawn doors at once**: dead air isn't the problem, and more far doors raise the off-screen time (cause 5).

The order to try them: 2 and 3 first (small, safe, felt at once), then 1 (the big one, with the balance bot), then 4 and 5 together (they both move key earning), then 7. Leave 6 to the rooms rework. Measure each step with `tools/balance/pacing.ts`: the targets to watch are kills a second rising by wave, the tail after the last pack under 8 s, and "a break or under 3 alive" under 35% of a run.

## 4. Decisions for the owner

1. **How should a wave end?**
   - (a) As now: the last fight plays out.
   - (b) The last 3 sprint with a rage tell after 3 s, and an off-screen one gets a marker. **(Recommended)**
   - (c) (b), and the very last one is shown through walls.
   - (d) A wave ends once at most 2 are left; they stay into the break.

2. **What should the waves trade: length or heat?**
   - (a) Keep the tables.
   - (b) Same zombies per wave, packed into harder peaks, so waves are shorter and hotter. **(Recommended)**
   - (c) More zombies per wave, same timing.
   - (d) Both (b) and a rise in count after wave 6.

3. **How long should waves 1 and 2 be?**
   - (a) As now (23 s and 41 s).
   - (b) Wave 1 in about 15 s with 8 zombies, and wave 2's rest sooner. **(Recommended)**
   - (c) Veterans skip wave 1 and start on wave 2.

4. **Should pressing READY early pay?**
   - (a) No.
   - (b) Yes, 1 skeleton key per 5 s left on the clock. **(Recommended)**
   - (c) Yes, but only rank points, so it doesn't change balance.

5. **How far apart should the rooms open?**
   - (a) As now, 8, 55, 90, 90: waves 3, 5, 7, 9.
   - (b) 8, 40, 75, 90: waves 3, 4, 6, 8. **(Recommended)**
   - (c) Keep the prices and pay 2 keys per pack wiped.

6. **What should happen mid-wave before the rooms rework lands?**
   - (a) Nothing; wait for the rooms rework.
   - (b) A marked zombie once a wave from wave 3, worth 5 keys. **(Recommended, and keep the rooms rework's "wake up" for later)**
   - (c) Opening a room in a break rings the dinner bell at the next wave's start.

7. **May the waves lean toward where the player stands?**
   - (a) No, doors stay drawn from all spawn doors.
   - (b) Yes, weighted 2 to 1 toward the player's room and its neighbours, fixed at Preparation. **(Recommended)**
   - (c) Only the far rooms' doors join a wave once someone has stood in that room.

8. **Should difficulty change the rhythm, not just the danger?**
   - (a) No: every dare plays the same tempo, as now.
   - (b) Yes: harder dares bring peaks more often (L4D's rule), easier ones rest longer in waves. **(Recommended, after 2)**
   - (c) Yes, but only for Triple Dog Dare.
