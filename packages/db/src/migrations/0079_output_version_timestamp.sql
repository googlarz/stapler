-- Add latest_version_released_at to outputs so the list view can display
-- when the last full-cycle version was released without a join.
ALTER TABLE outputs
  ADD COLUMN IF NOT EXISTS latest_version_released_at timestamptz;
