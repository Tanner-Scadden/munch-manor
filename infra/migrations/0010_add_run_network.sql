-- A co-op player's link to the room over the run (RunSummary version 7),
-- measured on their own client: the median and 95th percentile round trip
-- of the socket's pings and how many came back, the mean jitter in the
-- spacing of the room's snapshots, the snapshots timed and those a whole
-- send or more late (with the mean and most milliseconds late), the
-- reconnects, and the times the room corrected the player's predicted
-- position (and the biggest move, in world pixels). NULL for solo rows and
-- for crew rows from version 6 and older, which had none. The index lets
-- the report put one game's players side by side by crew_key.
ALTER TABLE runs ADD COLUMN net_rtt_p50_ms INTEGER;
ALTER TABLE runs ADD COLUMN net_rtt_p95_ms INTEGER;
ALTER TABLE runs ADD COLUMN net_rtt_samples INTEGER;
ALTER TABLE runs ADD COLUMN net_jitter_ms INTEGER;
ALTER TABLE runs ADD COLUMN net_snapshots INTEGER;
ALTER TABLE runs ADD COLUMN net_late_snapshots INTEGER;
ALTER TABLE runs ADD COLUMN net_late_ms_mean INTEGER;
ALTER TABLE runs ADD COLUMN net_late_ms_max INTEGER;
ALTER TABLE runs ADD COLUMN net_reconnects INTEGER;
ALTER TABLE runs ADD COLUMN net_corrections INTEGER;
ALTER TABLE runs ADD COLUMN net_correction_px_max INTEGER;

CREATE INDEX IF NOT EXISTS runs_by_received_at ON runs (party, received_at);
