-- Controllers (RunSummary version 6): device may now be 'Gamepad', beside
-- 'KeyboardMouse' and 'Touch', in the device column as it is (TEXT, no
-- check). Every row from before version 6 was played on a keyboard or by
-- touch. The index lets a report count runs by device without a scan.
CREATE INDEX IF NOT EXISTS runs_by_device ON runs (device);
