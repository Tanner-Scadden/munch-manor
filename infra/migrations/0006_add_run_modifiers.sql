-- The run modifiers that bit in a run (RunSummary version 4), as a mask with
-- a bit for each: Friendly Fire 1, Big Crowd 2, Broke 4, Glass 8. 0 is none,
-- and every row from before them was none.
ALTER TABLE runs ADD COLUMN modifiers INTEGER NOT NULL DEFAULT 0;

CREATE INDEX runs_by_modifiers ON runs (modifiers, mode, difficulty, outcome);
