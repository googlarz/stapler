-- Add scheduling support to eval_suites.
-- scheduleExpression: cron string (e.g. "0 9 * * 1" = every Monday at 09:00 UTC)
-- alertThreshold: if avgScore drops below this (0.0–1.0), log an alert
ALTER TABLE "eval_suites"
  ADD COLUMN "schedule_expression" text,
  ADD COLUMN "alert_threshold" real,
  ADD COLUMN "last_scheduled_run_at" timestamptz;
