import { cn } from "@/lib/utils";

interface RunScoreBadgeProps {
  /** 0.0–1.0; null when the run hasn't been judged yet. */
  score: number | null | undefined;
  /** Judge reasoning rendered in the native title tooltip. */
  reasoning?: string | null;
  className?: string;
  /** Compact (no label) or full ("Quality: 87%"). */
  variant?: "compact" | "full";
}

function colorFor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20";
  if (score >= 0.5) return "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20";
  return "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20";
}

/**
 * Small pill that renders a Quality Flywheel run score (Pillar 1).
 * Shows "—" when the run hasn't been judged yet.
 */
export function RunScoreBadge({ score, reasoning, className, variant = "compact" }: RunScoreBadgeProps) {
  if (score == null || !Number.isFinite(score)) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-muted text-muted-foreground ring-border",
          className,
        )}
        title="Not yet scored"
      >
        {variant === "full" ? "Quality: —" : "—"}
      </span>
    );
  }
  const pct = Math.round(score * 100);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        colorFor(score),
        className,
      )}
      title={reasoning ?? undefined}
    >
      {variant === "full" ? `Quality: ${pct}%` : `${pct}%`}
    </span>
  );
}
