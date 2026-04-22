/**
 * useRunStream — consume the SSE run event stream.
 *
 * Opens `GET /api/heartbeat-runs/:runId/stream` as a Server-Sent Events
 * connection and accumulates events into a stateful array. Closes
 * automatically when the server sends a `stream_end` event (terminal status).
 *
 * Usage:
 *   const { events, streamStatus } = useRunStream(runId);
 *   // streamStatus: "connecting" | "streaming" | "done" | "error"
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { HeartbeatRunEvent } from "@stapler/shared";

export type StreamStatus = "connecting" | "streaming" | "done" | "error";

export interface StreamEndEvent {
  type: "stream_end";
  status: string;
}

export type StreamedEvent = HeartbeatRunEvent | StreamEndEvent;

export interface UseRunStreamResult {
  events: HeartbeatRunEvent[];
  streamStatus: StreamStatus;
  terminalStatus: string | null;
}

export function useRunStream(runId: string | null | undefined): UseRunStreamResult {
  const [events, setEvents] = useState<HeartbeatRunEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;

    setEvents([]);
    setStreamStatus("connecting");
    setTerminalStatus(null);
    cleanup();

    const es = new EventSource(`/api/heartbeat-runs/${runId}/stream`);
    esRef.current = es;

    es.onopen = () => {
      setStreamStatus("streaming");
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as StreamedEvent;
        if ("type" in parsed && parsed.type === "stream_end") {
          setTerminalStatus(parsed.status);
          setStreamStatus("done");
          cleanup();
          return;
        }
        setEvents((prev) => [...prev, parsed as HeartbeatRunEvent]);
      } catch {
        // malformed event — ignore
      }
    };

    es.onerror = () => {
      setStreamStatus("error");
      cleanup();
    };

    return cleanup;
  }, [runId, cleanup]);

  return { events, streamStatus, terminalStatus };
}
