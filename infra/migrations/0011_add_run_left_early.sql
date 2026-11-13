-- Leaving early (RunSummary version 8): a run the crew left by the
-- kitchen's back door in a break ends 'LeftEarly', in the outcome column as
-- it is, beside 'Escaped' and 'GameOver'; its share event's screen is
-- 'LeftEarly' or 'CoopLeftEarly'. No column changes. The index lets the
-- report count the runs that left early, and how much of the dare they had
-- found, by difficulty without a scan.
CREATE INDEX IF NOT EXISTS runs_by_outcome_found ON runs (outcome, difficulty, dare_items_found);
