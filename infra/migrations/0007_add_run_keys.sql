-- Skeleton keys and display cases (RunSummary version 5, the escape stack's
-- layer 7): the keys the crew spent on boards and fridge pulls, and the
-- cases the run opened. NULL for a row from before them, which bought from
-- the shop (`purchases`); a version 5 row has 0 purchases.
ALTER TABLE runs ADD COLUMN keys_spent INTEGER;
ALTER TABLE runs ADD COLUMN cases_opened INTEGER;
