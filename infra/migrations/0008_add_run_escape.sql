-- The escape (RunSummary version 5, beside 0007's keys and cases): a won
-- run ends 'Escaped' in place of 'Victory', in the outcome column as it is,
-- and dare_items_found counts the things on the dare's list the run found.
-- Every row from before the escape found none.
ALTER TABLE runs ADD COLUMN dare_items_found INTEGER NOT NULL DEFAULT 0;
