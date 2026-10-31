-- Who played a run: 'Solo', or 'Crew' for an online co-op run, sent by
-- each player's own client from its own seat (RunSummary version 2). A
-- crew row has the crew's size and the seat's own kills, downs, and
-- revives; its kills column is the crew's. Rows from before it were all
-- solo. Nothing here names a teammate or a room.
ALTER TABLE runs ADD COLUMN party TEXT NOT NULL DEFAULT 'Solo';
ALTER TABLE runs ADD COLUMN crew_size INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN seat_kills INTEGER;
ALTER TABLE runs ADD COLUMN seat_downs INTEGER;
ALTER TABLE runs ADD COLUMN seat_revives INTEGER;

CREATE INDEX runs_by_party ON runs (party, mode, difficulty, outcome);
