// The report's SQL over the analytics D1 database (infra/migrations), apart
// from report.ts so infra's Worker tests run it on the real migrations
// (infra/worker/report.test.ts). Plain SQL strings, nothing else, so infra
// reads this file with no Effect of the game's.

// NOTE: a row's party is 'Solo' or 'Crew' (an online co-op run). Every
// player in a crew who shares stats sends their own summary, so a co-op
// game is several rows. Since RunSummary version 3 they share a crew_key,
// so a game is one key. A crew row with no key (version 2, before it) is
// a game of its own: those counts run high by up to the crew's size.
//
// NOTE: a won run is an escape: 'Escaped' since RunSummary version 5, and
// 'Victory' (the tenth wave cleared) before it. Both count as a win.
const IS_WON = `outcome IN ('Escaped', 'Victory')`

const CREW_GAMES = `
  crew_games AS (
    SELECT coalesce(crew_key, 'row:' || id) AS game,
      min(mode) AS mode,
      min(difficulty) AS difficulty,
      max(crew_size) AS crew_size,
      max(wave) AS wave,
      max(run_ms) AS run_ms,
      min(received_day) AS received_day,
      max(${IS_WON}) AS won,
      max(outcome = 'GameOver') AND NOT max(${IS_WON}) AS lost
    FROM runs WHERE party = 'Crew'
    GROUP BY game
  )`

// NOTE: every game once: a solo run's row, and a co-op game once by its
// key, its length the longest any player saw and its day the first.
const GAMES = `
  games AS (
    SELECT mode, run_ms, received_day FROM runs WHERE party = 'Solo'
    UNION ALL
    SELECT mode, run_ms, received_day FROM crew_games
  )`

// NOTE: one co-op game's outcome, from its players' rows: won if anyone's
// summary says it escaped, lost if anyone's says Game Over, else everyone
// left. Its wave is the furthest any of them saw, its crew the largest.
const GAME_OUTCOMES = `
    count(*) AS runs,
    sum(won) AS wins,
    sum(lost) AS losses,
    sum(NOT won AND NOT lost) AS quits`

// NOTE: one row per solo run.
export const SOLO_WIN_RATE = `
  SELECT difficulty,
    count(*) AS runs,
    sum(${IS_WON}) AS wins,
    sum(outcome = 'GameOver') AS losses,
    sum(outcome = 'Quit') AS quits
  FROM runs WHERE mode = 'Campaign' AND party = 'Solo'
  GROUP BY difficulty ORDER BY difficulty`

// NOTE: per game, on the room's difficulty.
export const COOP_WIN_RATE = `
  WITH ${CREW_GAMES}
  SELECT difficulty, ${GAME_OUTCOMES}
  FROM crew_games WHERE mode = 'Campaign'
  GROUP BY difficulty ORDER BY difficulty`

export const DEATH_WAVES = `
  SELECT mode, wave, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver' AND party = 'Solo'
  GROUP BY mode, wave ORDER BY mode, wave`

// NOTE: per game: the wave a lost game ended on.
export const COOP_DEATH_WAVES = `
  WITH ${CREW_GAMES}
  SELECT mode, crew_size, wave, count(*) AS deaths FROM crew_games
  WHERE lost
  GROUP BY mode, crew_size, wave ORDER BY mode, crew_size, wave`

// NOTE: per game, by crew size.
export const COOP_GAMES = `
  WITH ${CREW_GAMES}
  SELECT crew_size, ${GAME_OUTCOMES}
  FROM crew_games
  GROUP BY crew_size ORDER BY crew_size`

// NOTE: per player: every row, each the player's own seat, averaged.
export const COOP_PLAYERS = `
  SELECT crew_size,
    count(*) AS players,
    avg(seat_kills) AS kills,
    avg(seat_downs) AS downs,
    avg(seat_revives) AS revives
  FROM runs WHERE party = 'Crew'
  GROUP BY crew_size ORDER BY crew_size`

export const DEADLIEST = `
  SELECT killed_by, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver' AND party = 'Solo'
  GROUP BY killed_by ORDER BY deaths DESC`

// NOTE: per game, so a co-op game counts once.
export const MEDIAN_LENGTH = `
  WITH ${CREW_GAMES}, ${GAMES}, ordered AS (
    SELECT mode, run_ms,
      row_number() OVER (PARTITION BY mode ORDER BY run_ms) AS position,
      count(*) OVER (PARTITION BY mode) AS runs
    FROM games
  )
  SELECT mode, max(runs) AS runs, avg(run_ms) AS median_ms FROM ordered
  WHERE position IN ((runs + 1) / 2, (runs + 2) / 2)
  GROUP BY mode ORDER BY mode`

// NOTE: per player: each player in a co-op game plays on their own device.
export const DEVICES = `
  SELECT device, screen_fit, count(*) AS runs FROM runs
  GROUP BY device, screen_fit ORDER BY runs DESC`

// NOTE: per player, from version 5 on (the skeleton keys, the display
// cases, and the dare, docs/ESCAPE_PLAN.md): keys spent, cases opened, and
// things on the dare's list found a run.
export const KEYS = `
  SELECT mode, count(*) AS runs, avg(keys_spent) AS keys_spent,
    avg(cases_opened) AS cases_opened,
    avg(dare_items_found) AS dare_items_found FROM runs
  WHERE summary_version >= 5
  GROUP BY mode ORDER BY mode`

// NOTE: per game, so a co-op game counts once.
export const RUNS_PER_DAY = `
  WITH ${CREW_GAMES}, ${GAMES}
  SELECT received_day, count(*) AS runs FROM games
  GROUP BY received_day ORDER BY received_day DESC LIMIT 30`

// NOTE: taps on SHARE by end screen, against the runs that ended
// there, so the share rate reads at a glance.
export const SHARES = `
  SELECT screen, path, count(*) AS shares, count(DISTINCT visit_id) AS visits
  FROM shares GROUP BY screen, path ORDER BY shares DESC`

// NOTE: the runs that ended at Game Over or a win: solo runs by row,
// co-op games by game, so a co-op end screen's shares read per game. A win
// reads as Victory, the share screen's name for it.
export const ENDS = `
  WITH ${CREW_GAMES}
  SELECT party, outcome, count(*) AS runs FROM (
    SELECT party,
      CASE WHEN ${IS_WON} THEN 'Victory' ELSE outcome END AS outcome
    FROM runs
    WHERE party = 'Solo' AND outcome IN ('GameOver', 'Escaped', 'Victory')
    UNION ALL
    SELECT 'Crew', CASE WHEN won THEN 'Victory' ELSE 'GameOver' END
    FROM crew_games WHERE won OR lost
  )
  GROUP BY party, outcome`
