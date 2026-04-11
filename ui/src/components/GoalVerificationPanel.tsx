import { useState } from "react";
import type { Goal } from "@paperclipai/shared";
import { MAX_GOAL_VERIFICATION_ATTEMPTS } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertCircle, XCircle, RefreshCw } from "lucide-react";
import { api } from "../api/client";

interface Props {
  goal: Goal;
  onVerificationRequested?: () => void;
}

/**
 * Small panel on the goal detail page that surfaces verification state
 * and exposes a "Verify now" button that calls
 * `POST /goals/:id/verify`.
 *
 * The panel renders nothing if the goal has no acceptance criteria,
 * because verification is a no-op in that case.
 */
export function GoalVerificationPanel({ goal, onVerificationRequested }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasCriteria = (goal.acceptanceCriteria ?? []).length > 0;
  if (!hasCriteria) return null;

  const status = goal.verificationStatus;
  const attempts = goal.verificationAttempts;
  const max = MAX_GOAL_VERIFICATION_ATTEMPTS;

  async function triggerVerification() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post<{ verificationIssueId: string }>(`/goals/${goal.id}/verify`, {});
      onVerificationRequested?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed to start");
    } finally {
      setSubmitting(false);
    }
  }

  const statusIcon = () => {
    switch (status) {
      case "passed":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "pending":
        return <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusLabel = () => {
    switch (status) {
      case "passed":
        return "Verified";
      case "failed":
        return "Verification failed";
      case "pending":
        return "Verification in progress";
      default:
        return "Not verified";
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {statusIcon()}
          <div>
            <p className="text-xs font-medium">{statusLabel()}</p>
            <p className="text-[11px] text-muted-foreground">
              Attempts: {attempts}/{max}
              {goal.verifiedAt && status === "passed"
                ? ` · ${new Date(goal.verifiedAt).toLocaleDateString()}`
                : null}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          onClick={() => void triggerVerification()}
          disabled={submitting || status === "pending"}
          title={
            !goal.ownerAgentId
              ? "Set an owner agent first"
              : status === "pending"
                ? "Verification already in progress"
                : "Start a verification run"
          }
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${submitting ? "animate-spin" : ""}`} />
          {status === "not_started" ? "Verify" : "Re-verify"}
        </Button>
      </div>
      {!goal.ownerAgentId && (
        <p className="text-[11px] text-muted-foreground">
          Set an owner agent on this goal to enable verification.
        </p>
      )}
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
