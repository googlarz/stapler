-- Pillar 2 of the Quality Flywheel: self-critique gate before a run finalises
-- as "succeeded". When a run's output scores below selfCritiqueThreshold it
-- transitions to "needs_review" instead and waits for human approval.
--
-- heartbeat_runs.status is text so no enum change needed — "needs_review" is
-- just a new valid value understood by the server.
ALTER TABLE "agents"
  ADD COLUMN "self_critique_threshold" real;
