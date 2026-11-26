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
      max(outcome = 'GameOver') AND NOT max(${IS_WON}) AS lost,
      max(outcome = 'LeftEarly') AS left_early
    FROM runs WHERE party = 'Crew'
    GROUP BY game
  )`

const GAMES = `
  games AS (
    SELECT mode, run_ms, received_day FROM runs WHERE party = 'Solo'
    UNION ALL
    SELECT mode, run_ms, received_day FROM crew_games
  )`

const GAME_OUTCOMES = `
    count(*) AS runs,
    sum(won) AS wins,
    sum(lost) AS losses,
    sum(NOT won AND NOT lost) AS quits`

export const SOLO_WIN_RATE = `
  SELECT difficulty,
    count(*) AS runs,
    sum(${IS_WON}) AS wins,
    sum(outcome = 'GameOver') AS losses,
    sum(outcome = 'Quit') AS quits
  FROM runs WHERE mode = 'Campaign' AND party = 'Solo'
  GROUP BY difficulty ORDER BY difficulty`

export const COOP_WIN_RATE = `
  WITH ${CREW_GAMES}
  SELECT difficulty, ${GAME_OUTCOMES}
  FROM crew_games WHERE mode = 'Campaign'
  GROUP BY difficulty ORDER BY difficulty`

export const DEATH_WAVES = `
  SELECT mode, wave, count(*) AS deaths FROM runs
  WHERE outcome = 'GameOver' AND party = 'Solo'
  GROUP BY mode, wave ORDER BY mode, wave`

export const COOP_DEATH_WAVES = `
  WITH ${CREW_GAMES}
  SELECT mode, crew_size, wave, count(*) AS deaths FROM crew_games
  WHERE lost
  GROUP BY mode, crew_size, wave ORDER BY mode, crew_size, wave`

export const COOP_GAMES = `
  WITH ${CREW_GAMES}
  SELECT crew_size, ${GAME_OUTCOMES}
  FROM crew_games
  GROUP BY crew_size ORDER BY crew_size`

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
  WITH ${CREW_GAMES}, ${GAMES}, ordered AS (
    SELECT mode, run_ms,
      row_number() OVER (PARTITION BY mode ORDER BY run_ms) AS position,
      count(*) OVER (PARTITION BY mode) AS runs
    FROM games
  )
  SELECT mode, max(runs) AS runs, avg(run_ms) AS median_ms FROM ordered
  WHERE position IN ((runs + 1) / 2, (runs + 2) / 2)
  GROUP BY mode ORDER BY mode`

export const DEVICES = `
  SELECT device, screen_fit, count(*) AS runs FROM runs
  GROUP BY device, screen_fit ORDER BY runs DESC`

export const KEYS = `
  SELECT mode, count(*) AS runs, avg(keys_spent) AS keys_spent,
    avg(cases_opened) AS cases_opened,
    avg(dare_items_found) AS dare_items_found FROM runs
  WHERE summary_version >= 5
  GROUP BY mode ORDER BY mode`

export const RUNS_PER_DAY = `
  WITH ${CREW_GAMES}, ${GAMES}
  SELECT received_day, count(*) AS runs FROM games
  GROUP BY received_day ORDER BY received_day DESC LIMIT 30`

export const SHARES = `
  SELECT screen, path, count(*) AS shares, count(DISTINCT visit_id) AS visits
  FROM shares GROUP BY screen, path ORDER BY shares DESC`

export const ENDS = `
  WITH ${CREW_GAMES}
  SELECT party, outcome, count(*) AS runs FROM (
    SELECT party,
      CASE WHEN ${IS_WON} THEN 'Escaped' ELSE outcome END AS outcome
    FROM runs
    WHERE party = 'Solo'
      AND outcome IN ('GameOver', 'Escaped', 'Victory', 'LeftEarly')
    UNION ALL
    SELECT 'Crew', CASE
      WHEN won THEN 'Escaped'
      WHEN left_early THEN 'LeftEarly'
      ELSE 'GameOver' END
    FROM crew_games WHERE won OR lost OR left_early
  )
  GROUP BY party, outcome`

export const LEFT_EARLY = `
  SELECT party, difficulty,
    count(DISTINCT coalesce(crew_key, 'row:' || id)) AS runs,
    avg(wave) AS wave,
    avg(dare_items_found) AS dare_items_found
  FROM runs WHERE outcome = 'LeftEarly'
  GROUP BY party, difficulty ORDER BY party, difficulty`

export const DARE_MARKS = `
  SELECT difficulty, dare_mark,
    count(DISTINCT coalesce(crew_key, 'row:' || id)) AS runs,
    count(DISTINCT CASE WHEN ${IS_WON}
      THEN coalesce(crew_key, 'row:' || id) END) AS escapes
  FROM runs WHERE summary_version >= 9 AND mode = 'Campaign'
  GROUP BY difficulty, dare_mark ORDER BY difficulty, dare_mark`

export const COOP_NETWORK = `
  WITH recent AS (
    SELECT crew_key, max(received_at) AS last_at FROM runs
    WHERE party = 'Crew' AND crew_key IS NOT NULL
      AND net_rtt_p50_ms IS NOT NULL
    GROUP BY crew_key ORDER BY last_at DESC LIMIT 20
  )
  SELECT runs.crew_key AS crew_key, runs.crew_size AS crew_size,
    runs.device AS device,
    runs.net_rtt_p50_ms AS rtt_p50_ms, runs.net_rtt_p95_ms AS rtt_p95_ms,
    runs.net_jitter_ms AS jitter_ms, runs.net_snapshots AS snapshots,
    runs.net_late_snapshots AS late_snapshots,
    runs.net_late_ms_mean AS late_ms_mean, runs.net_late_ms_max AS late_ms_max,
    runs.net_reconnects AS reconnects, runs.net_corrections AS corrections,
    runs.net_correction_px_max AS correction_px_max
  FROM runs JOIN recent ON runs.crew_key = recent.crew_key
  WHERE runs.party = 'Crew' AND runs.net_rtt_p50_ms IS NOT NULL
  ORDER BY recent.last_at DESC, runs.crew_key, runs.id`
