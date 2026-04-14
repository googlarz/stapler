import { Clock3, Pencil, RefreshCw, Trash2, Webhook, Zap } from "lucide-react";
import type { RoutineTrigger } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { describeSchedule } from "./ScheduleEditor";
import { timeAgo } from "../lib/timeAgo";

interface TriggerListCardProps {
  trigger: RoutineTrigger;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRotateSecret?: () => void;
  togglePending?: boolean;
}

export function TriggerListCard({
  trigger,
  onEdit,
  onDelete,
  onToggleEnabled,
  onRotateSecret,
  togglePending,
}: TriggerListCardProps) {
  const isSchedule = trigger.kind === "schedule";
  const isWebhook = trigger.kind === "webhook";
  const Icon = isSchedule ? Clock3 : isWebhook ? Webhook : Zap;

  const summary = isSchedule && trigger.cronExpression
    ? describeSchedule(trigger.cronExpression)
    : isWebhook
      ? `Webhook${trigger.publicId ? ` · ${trigger.publicId}` : ""}`
      : "API trigger";

  const nextRun = isSchedule && trigger.enabled && trigger.nextRunAt
    ? new Date(trigger.nextRunAt).toLocaleString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    : trigger.enabled ? "—" : "Disabled";

  const lastFired = trigger.lastFiredAt ? timeAgo(trigger.lastFiredAt) : "Never";

  const resultIsError = typeof trigger.lastResult === "string" && /error|fail/i.test(trigger.lastResult);

  return (
    <div
      className={`rounded-lg border border-border p-4 transition-colors ${trigger.enabled ? "bg-card" : "bg-muted/40"}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${trigger.enabled ? "" : "text-muted-foreground"}`}>
              {trigger.label || (isSchedule ? "Schedule" : isWebhook ? "Webhook" : "Trigger")}
            </span>
            <Badge variant="outline" className="text-[11px]">
              {trigger.kind}
            </Badge>
            {!trigger.enabled && (
              <Badge variant="secondary" className="text-[11px] text-muted-foreground">
                paused
              </Badge>
            )}
          </div>
          <div className="text-sm mt-1.5">{summary}</div>
          {isSchedule && trigger.cronExpression && (
            <div className="text-xs text-muted-foreground mt-1 font-mono">
              {trigger.cronExpression}
              {trigger.timezone ? ` · ${trigger.timezone}` : ""}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3 mt-4 text-xs">
            <div>
              <div className="text-muted-foreground mb-0.5">Next run</div>
              <div>{nextRun}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5">Last fired</div>
              <div>{lastFired}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5">Last result</div>
              <div>
                {trigger.lastResult ? (
                  <Badge
                    variant={resultIsError ? "destructive" : "secondary"}
                    className="text-[11px] max-w-full truncate"
                    title={trigger.lastResult}
                  >
                    {trigger.lastResult}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <ToggleSwitch
            checked={trigger.enabled}
            onCheckedChange={onToggleEnabled}
            disabled={togglePending}
            aria-label={trigger.enabled ? "Disable trigger" : "Enable trigger"}
          />
          <div className="flex gap-1">
            {isWebhook && onRotateSecret && (
              <Button variant="ghost" size="xs" onClick={onRotateSecret} title="Rotate secret">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={onEdit} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={onDelete}
              title="Delete"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
