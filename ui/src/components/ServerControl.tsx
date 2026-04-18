import { useState, useEffect, useCallback, useRef } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstanceSchedulerHeartbeatAgent } from "@stapler/shared";

// localStorage key used to remember which agents THIS control paused, so the
// matching resume only touches the agents it paused itself — never agents
// that were already paused manually or by budget controls.
const PAUSED_SET_KEY = "stapler.serverControl.pausedAgentIds";

function loadPausedSet(): string[] {
  try {
    const raw = localStorage.getItem(PAUSED_SET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function savePausedSet(ids: string[]): void {
  try {
    localStorage.setItem(PAUSED_SET_KEY, JSON.stringify(ids));
  } catch {
    // quota / private mode — non-fatal
  }
}

export function ServerControl() {
  const [agents, setAgents] = useState<InstanceSchedulerHeartbeatAgent[]>([]);
  const [busy, setBusy] = useState(false);
  const pausedByUsRef = useRef<string[]>(loadPausedSet());

  const refresh = useCallback(async () => {
    try {
      // includePaused=true so resume() can find agents whose status is paused.
      const res = await fetch("/api/instance/scheduler-heartbeats?includePaused=true");
      if (res.ok) setAgents(await res.json());
    } catch {
      // server unreachable — keep last known state
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  // Use schedulerActive (status-aware) instead of raw heartbeatEnabled,
  // because pausing sets status=paused but leaves runtimeConfig.heartbeat.enabled
  // unchanged. Basing the toggle on heartbeatEnabled would make the button
  // keep issuing pause requests after agents are already paused.
  const anyActive = agents.some((a) => a.schedulerActive);

  const toggle = async () => {
    setBusy(true);
    try {
      if (anyActive) {
        // Pause: target currently-active agents, remember them so the
        // matching resume only re-activates THIS set.
        const targets = agents.filter((a) => a.schedulerActive).map((a) => a.id);
        pausedByUsRef.current = targets;
        savePausedSet(targets);
        await Promise.all(
          targets.map((id) =>
            fetch(`/api/agents/${id}/pause`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
          )
        );
      } else {
        // Resume: ONLY agents this control previously paused, and only if
        // they are still paused. Never revive agents paused by other means.
        const stillPaused = new Set(
          agents.filter((a) => a.status === "paused").map((a) => a.id),
        );
        const targets = pausedByUsRef.current.filter((id) => stillPaused.has(id));
        await Promise.all(
          targets.map((id) =>
            fetch(`/api/agents/${id}/resume`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
          )
        );
        pausedByUsRef.current = [];
        savePausedSet([]);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const Icon = anyActive ? PauseCircle : PlayCircle;
  const canResume = !anyActive && pausedByUsRef.current.length > 0;
  const label = busy
    ? "…"
    : anyActive
    ? "Pause all agents"
    : canResume
    ? "Resume paused agents"
    : "No active agents";

  return (
    <div className="px-3 pb-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2 text-xs"
        onClick={toggle}
        disabled={busy || (!anyActive && !canResume)}
      >
        <Icon className={`h-3.5 w-3.5 ${anyActive ? "text-green-500" : "text-muted-foreground"}`} />
        {label}
      </Button>
    </div>
  );
}
