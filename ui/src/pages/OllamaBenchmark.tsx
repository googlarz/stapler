import { useState, useEffect, useRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { DEFAULT_OLLAMA_BASE_URL } from "@stapler/adapter-ollama-local";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

const BENCH_PROMPT =
  "Explain the difference between a process and a thread in one short paragraph.";

interface InstalledModel {
  name: string;
}

type BenchmarkStatus = "idle" | "running" | "done";

interface BenchmarkResult {
  model: string;
  responseTimeMs: number | null;
  output: string | null;
  error: string | null;
}

export function OllamaBenchmark() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Ollama Benchmark" }]);
  }, [setBreadcrumbs]);

  const [baseUrl, setBaseUrl] = useState(DEFAULT_OLLAMA_BASE_URL);

  // Model fetching state
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [fetchTick, setFetchTick] = useState(0);

  // Checkbox selection: model name -> checked
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Benchmark state
  const [status, setStatus] = useState<BenchmarkStatus>("idle");
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);

  // AbortController ref for chat requests
  const abortRef = useRef<AbortController | null>(null);

  // Fetch installed models
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);

    (async () => {
      try {
        const res = await fetch("/api/instance/settings/ollama-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl, action: "tags" }),
          signal: AbortSignal.timeout(8000),
        });
        if (cancelled) return;
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Ollama responded with ${res.status}`);
        }
        const body = (await res.json()) as { models: { name: string }[] };
        if (cancelled) return;
        const fetched = Array.isArray(body.models)
          ? body.models.filter((m) => typeof m.name === "string")
          : [];
        setModels(fetched);
        // Default all to checked
        const newChecked: Record<string, boolean> = {};
        for (const m of fetched) {
          newChecked[m.name] = true;
        }
        setChecked(newChecked);
        setModelsLoading(false);
      } catch (err) {
        if (cancelled) return;
        setModelsError(
          err instanceof Error ? err.message : "Failed to connect to Ollama",
        );
        setModelsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetchTick]);

  function handleRetry() {
    setFetchTick((n) => n + 1);
  }

  function toggleModel(name: string) {
    setChecked((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const selectedModels = models.filter((m) => checked[m.name]);
  const checkedCount = selectedModels.length;

  async function runBenchmark() {
    if (checkedCount === 0 || status === "running") return;

    const toRun = selectedModels.map((m) => m.name);

    setResults([]);
    setCompleted(0);
    setTotal(toRun.length);
    setStatus("running");

    const controller = new AbortController();
    abortRef.current = controller;

    for (let i = 0; i < toRun.length; i++) {
      const modelName = toRun[i];
      const start = performance.now();

      try {
        const res = await fetch("/api/instance/settings/ollama-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseUrl,
            action: "chat",
            payload: {
              model: modelName,
              messages: [{ role: "user", content: BENCH_PROMPT }],
              stream: false,
            },
          }),
          signal: controller.signal,
        });

        const elapsed = Math.round(performance.now() - start);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          message: { content: string };
          total_duration: number;
        };

        const responseTimeMs =
          data.total_duration != null
            ? Math.round(data.total_duration / 1_000_000)
            : elapsed;

        const rawOutput = data.message?.content ?? "";
        const truncated =
          rawOutput.length > 200
            ? rawOutput.slice(0, 200) + "\u2026"
            : rawOutput;

        setResults((prev) => [
          ...prev,
          { model: modelName, responseTimeMs, output: truncated, error: null },
        ]);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // User navigated away — stop processing
          setStatus("idle");
          return;
        }
        setResults((prev) => [
          ...prev,
          {
            model: modelName,
            responseTimeMs: null,
            output: null,
            error: err instanceof Error ? err.message : "Unknown error",
          },
        ]);
      }

      setCompleted(i + 1);
    }

    setStatus("done");
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Find fastest successful result
  const fastestMs = results.reduce<number | null>((best, r) => {
    if (r.responseTimeMs == null) return best;
    return best == null || r.responseTimeMs < best ? r.responseTimeMs : best;
  }, null);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Benchmark Ollama Models</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send a fixed prompt to each selected model and compare response times
          and outputs side-by-side. Helps you pick the best local model without
          trial-and-error across agent runs.
        </p>
      </div>

      {/* Base URL input */}
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="baseUrl">
          Ollama Base URL
        </label>
        <input
          id="baseUrl"
          type="text"
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>

      {/* Model list */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Installed Models</p>

        {modelsLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading models from Ollama…
          </div>
        )}

        {!modelsLoading && modelsError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{modelsError}</span>
            <button
              type="button"
              onClick={handleRetry}
              className="shrink-0 text-xs underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {!modelsLoading && !modelsError && models.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No models found. Make sure Ollama is running and has models
            installed.
          </p>
        )}

        {!modelsLoading && !modelsError && models.length > 0 && (
          <ul className="space-y-1.5">
            {models.map((m) => (
              <li key={m.name}>
                <label className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm cursor-pointer hover:bg-muted/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={!!checked[m.name]}
                    onChange={() => toggleModel(m.name)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className="font-mono">{m.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Run button */}
      <div className="space-y-2">
        <button
          type="button"
          disabled={checkedCount === 0 || status === "running"}
          onClick={() => void runBenchmark()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
        >
          {status === "running" && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Run Benchmark ({checkedCount} model{checkedCount !== 1 ? "s" : ""})
        </button>

        {status === "running" && (
          <p className="text-sm text-muted-foreground">
            Running… {completed}/{total}
          </p>
        )}
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Results</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Response Time</th>
                  <th className="px-4 py-2.5 font-medium">Output</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => {
                  const isFastest =
                    r.responseTimeMs != null &&
                    r.responseTimeMs === fastestMs &&
                    fastestMs != null;
                  return (
                    <tr
                      key={r.model + idx}
                      className="border-b border-border last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-mono align-top">
                        <div className="flex items-center gap-2">
                          {r.model}
                          {isFastest && (
                            <span className="text-[11px] font-semibold text-green-600 dark:text-green-400">
                              Fastest
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {r.error ? (
                          <span className="text-destructive font-medium">
                            Error
                          </span>
                        ) : r.responseTimeMs != null ? (
                          `${r.responseTimeMs.toLocaleString()} ms`
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 align-top max-w-sm">
                        {r.error ? (
                          <span className="text-muted-foreground text-xs">
                            {r.error}
                          </span>
                        ) : (
                          <span className="text-xs leading-relaxed whitespace-pre-wrap">
                            {r.output}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
