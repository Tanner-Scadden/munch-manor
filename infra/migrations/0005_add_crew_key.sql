-- One online co-op game's key (RunSummary version 3): every player's own
-- summary of the same run carries the same key, so the report counts the
-- game once. The clients make it alike as a hash of the room's lobby, so
-- it names no room or player. NULL for solo rows, and for crew rows from
-- version 2, which came before it: the report counts each of those as a
-- game of its own.
ALTER TABLE runs ADD COLUMN crew_key TEXT;

CREATE INDEX runs_by_crew_key ON runs (party, crew_key);
