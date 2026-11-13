-- The dare ladder (RunSummary version 9): the mark a run was played at, 0
-- for none and for every summary before version 9. Marks 1 to 4 also show
-- in the modifiers mask, as the modifiers they turn on; marks 5 to 8 are
-- house rules only this column holds. The index lets the report count the
-- escapes at each mark by difficulty without a scan.
ALTER TABLE runs ADD COLUMN dare_mark INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS runs_by_dare_mark ON runs (difficulty, dare_mark, outcome);
