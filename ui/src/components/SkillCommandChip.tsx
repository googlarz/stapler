import { CheckCircle2, Loader2, XCircle, Zap } from "lucide-react";
import type { SkillInvocation } from "../api/skills";

interface SkillCommandChipProps {
  invocation: SkillInvocation;
  /** When provided and status is "succeeded", clicking the chip scrolls to the result comment. */
  onResultClick?: (resultCommentId: string) => void;
}

/**
 * A small chip that shows the lifecycle status of a skill invocation in the
 * issue thread.
 *
 * - pending/running → spinner + skill name
 * - succeeded       → ✓ chip linking to result comment
 * - failed          → ✗ chip with truncated error
 * - cancelled       → greyed out
 */
export function SkillCommandChip({ invocation, onResultClick }: SkillCommandChipProps) {
  const { skillKey, status, resultCommentId, errorMessage } = invocation;

  const baseClass =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors select-none";

  if (status === "pending" || status === "running") {
    return (
      <span
        className={`${baseClass} border-border/50 bg-muted text-muted-foreground`}
        title={`Running skill: ${skillKey}`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <Zap className="h-3 w-3" />
        <span>/{skillKey}</span>
      </span>
    );
  }

  if (status === "succeeded") {
    const clickable = resultCommentId && onResultClick;
    return (
      <button
        type="button"
        className={`${baseClass} border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400 ${clickable ? "cursor-pointer hover:bg-green-500/20" : "cursor-default"}`}
        title={`Skill completed: ${skillKey}`}
        onClick={() => resultCommentId && onResultClick?.(resultCommentId)}
        disabled={!clickable}
      >
        <CheckCircle2 className="h-3 w-3" />
        <Zap className="h-3 w-3" />
        <span>/{skillKey}</span>
      </button>
    );
  }

  if (status === "failed") {
    const tip = errorMessage ? `${skillKey}: ${errorMessage}` : `Skill failed: ${skillKey}`;
    return (
      <span
        className={`${baseClass} border-destructive/30 bg-destructive/10 text-destructive`}
        title={tip}
      >
        <XCircle className="h-3 w-3" />
        <Zap className="h-3 w-3" />
        <span>/{skillKey}</span>
      </span>
    );
  }

  // cancelled or unknown
  return (
    <span
      className={`${baseClass} border-border/30 bg-muted/50 text-muted-foreground/60 line-through`}
      title={`Skill cancelled: ${skillKey}`}
    >
      <Zap className="h-3 w-3" />
      <span>/{skillKey}</span>
    </span>
  );
}
