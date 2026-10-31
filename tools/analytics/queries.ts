// The report's SQL over the analytics D1 database (infra/migrations), apart
// from report.ts so infra's Worker tests run it on the real migrations
// (infra/worker/report.test.ts). Plain SQL strings, nothing else, so infra
// reads this file with no Effect of the game's.

// NOTE: a row's party is 'Solo' or 'Crew' (an online co-op run). Every
// player in a crew who shares stats sends their own summary, so a co-op
// game is several rows. Since RunSummary version 3 they share a crew_key,
// so a game is one key. A crew row with no key (version 2, before it) is
// a game of its own: those counts run high by up to the crew's size.
const CREW_GAMES = `
  crew_games AS (
    SELECT coalesce(crew_key, 'row:' || id) AS game,
      min(mode) AS mode,
      min(difficulty) AS difficulty,
      max(crew_size) AS crew_size,
      max(wave) AS wave,
      max(outcome = 'Victory') AS won,
      max(outcome = 'GameOver') AND NOT max(outcome = 'Victory') AS lost
    FROM runs WHERE party = 'Crew'
    GROUP BY game
  )`

// NOTE: one co-op game's outcome, from its players' rows: won if anyone's
// summary says Victory, lost if anyone's says Game Over, else everyone
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
    sum(outcome = 'Victory') AS wins,
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

export const MEDIAN_LENGTH = `
  WITH ordered AS (
    SELECT mode, run_ms,
      row_number() OVER (PARTITION BY mode ORDER BY run_ms) AS position,
      count(*) OVER (PARTITION BY mode) AS runs
    FROM runs
  )
  SELECT mode, max(runs) AS runs, avg(run_ms) AS median_ms FROM ordered
  WHERE position IN ((runs + 1) / 2, (runs + 2) / 2)
  GROUP BY mode ORDER BY mode`

export const DEVICES = `
  SELECT device, screen_fit, count(*) AS runs FROM runs
  GROUP BY device, screen_fit ORDER BY runs DESC`

export const RUNS_PER_DAY = `
  SELECT received_day, count(*) AS runs FROM runs
  GROUP BY received_day ORDER BY received_day DESC LIMIT 30`

// NOTE: taps on SHARE by end screen, against the runs that ended
// there, so the share rate reads at a glance.
export const SHARES = `
  SELECT screen, path, count(*) AS shares, count(DISTINCT visit_id) AS visits
  FROM shares GROUP BY screen, path ORDER BY shares DESC`

// NOTE: the runs that ended at Game Over or Victory: solo runs by row,
// co-op games by game, so a co-op end screen's shares read per game.
export const ENDS = `
  WITH ${CREW_GAMES}
  SELECT party, outcome, count(*) AS runs FROM (
    SELECT party, outcome FROM runs
    WHERE party = 'Solo' AND outcome IN ('GameOver', 'Victory')
    UNION ALL
    SELECT 'Crew', CASE WHEN won THEN 'Victory' ELSE 'GameOver' END
    FROM crew_games WHERE won OR lost
  )
  GROUP BY party, outcome`
