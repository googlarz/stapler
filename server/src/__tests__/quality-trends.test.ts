/**
 * Unit tests for the quality-trends service (Pillar 5 of the Quality Flywheel).
 *
 * Mocks the DB and logActivity to keep tests fast and side-effect-free.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockLogActivity = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

// ── DB factory ────────────────────────────────────────────────────────────────

/**
 * Build a fake DB that returns window results in call order.
 * getWindowAvg calls db.select().from().where() once per window.
 */
function makeDb(windows: Array<{ avgScore: number | null; sampleSize: number }>, agentRow?: unknown) {
  let windowCallIdx = 0;
  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const w = windows[windowCallIdx++];
          if (w !== undefined) {
            return Promise.resolve([{ avgScore: w.avgScore, sampleSize: w.sampleSize }]);
          }
          // agent lookup
          return Promise.resolve(agentRow ? [agentRow] : []);
        },
        limit: (_n?: number) => {
          return Promise.resolve(agentRow ? [agentRow] : []);
        },
      }),
    }),
  } as any;
}

function makeDbWithAgent(
  windows: Array<{ avgScore: number | null; sampleSize: number }>,
  agentRow: unknown,
) {
  let windowCallIdx = 0;
  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          if (windowCallIdx < windows.length) {
            const w = windows[windowCallIdx++];
            return Promise.resolve([{ avgScore: w!.avgScore, sampleSize: w!.sampleSize }]);
          }
          return {
            limit: () => Promise.resolve(agentRow ? [agentRow] : []),
          };
        },
      }),
    }),
  } as any;
}

// ── Tests: getAgentQualityTrends ──────────────────────────────────────────────

describe("getAgentQualityTrends", () => {
  it("returns nulls when no data is present", async () => {
    const { getAgentQualityTrends } = await import("../services/quality-trends.js");
    const db = makeDb([
      { avgScore: null, sampleSize: 0 },
      { avgScore: null, sampleSize: 0 },
      { avgScore: null, sampleSize: 0 },
    ]);

    const trends = await getAgentQualityTrends(db, "agent-1", "company-1");
    expect(trends.agentId).toBe("agent-1");
    expect(trends.companyId).toBe("company-1");
    expect(trends.windows.d7.avgScore).toBeNull();
    expect(trends.windows.d30.avgScore).toBeNull();
    expect(trends.windows.d90.avgScore).toBeNull();
  });

  it("returns populated windows when data is present", async () => {
    const { getAgentQualityTrends } = await import("../services/quality-trends.js");
    const db = makeDb([
      { avgScore: 0.82, sampleSize: 10 },
      { avgScore: 0.75, sampleSize: 25 },
      { avgScore: 0.71, sampleSize: 50 },
    ]);

    const trends = await getAgentQualityTrends(db, "agent-1", "company-1");
    expect(trends.windows.d7.avgScore).toBe(0.82);
    expect(trends.windows.d7.windowDays).toBe(7);
    expect(trends.windows.d7.sampleSize).toBe(10);
    expect(trends.windows.d30.avgScore).toBe(0.75);
    expect(trends.windows.d90.avgScore).toBe(0.71);
  });
});

// ── Tests: checkDrift ─────────────────────────────────────────────────────────

describe("checkDrift", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.STAPLER_DRIFT_THRESHOLD;
  });

  it("does nothing when current window has null avgScore", async () => {
    const { checkDrift } = await import("../services/quality-trends.js");
    // DB returns sequential window results; first (current 7d) is null
    let call = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            call++;
            if (call === 1) return Promise.resolve([{ avgScore: null, sampleSize: 0 }]);
            return Promise.resolve([{ avgScore: 0.9, sampleSize: 5 }]);
          },
        }),
      }),
    } as any;

    await checkDrift(db, "agent-1", "co-1");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does nothing when current window has < 3 samples", async () => {
    const { checkDrift } = await import("../services/quality-trends.js");
    let call = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            call++;
            if (call === 1) return Promise.resolve([{ avgScore: 0.7, sampleSize: 2 }]);
            return Promise.resolve([{ avgScore: 0.9, sampleSize: 5 }]);
          },
        }),
      }),
    } as any;

    await checkDrift(db, "agent-1", "co-1");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does nothing when previous window lacks data", async () => {
    const { checkDrift } = await import("../services/quality-trends.js");
    let call = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            call++;
            if (call === 1) return Promise.resolve([{ avgScore: 0.7, sampleSize: 5 }]);
            if (call === 2) return Promise.resolve([{ avgScore: null, sampleSize: 0 }]);
            return Promise.resolve([]);
          },
        }),
      }),
    } as any;

    await checkDrift(db, "agent-1", "co-1");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does NOT log when drift is within threshold", async () => {
    const { checkDrift } = await import("../services/quality-trends.js");
    let call = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: (_cond: unknown) => {
            call++;
            if (call === 1) return Promise.resolve([{ avgScore: 0.78, sampleSize: 5 }]); // current
            if (call === 2) return Promise.resolve([{ avgScore: 0.8, sampleSize: 5 }]);  // previous
            return { limit: () => Promise.resolve([{ companyId: "co-1" }]) };
          },
          limit: () => Promise.resolve([{ companyId: "co-1" }]),
        }),
      }),
    } as any;

    // drop = 0.8 - 0.78 = 0.02, default threshold = 0.1 → no drift
    await checkDrift(db, "agent-1", "co-1");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("logs quality.drift when drop exceeds threshold", async () => {
    const { checkDrift } = await import("../services/quality-trends.js");
    let call = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: (_cond: unknown) => {
            call++;
            if (call === 1) return Promise.resolve([{ avgScore: 0.5, sampleSize: 5 }]); // current
            if (call === 2) return Promise.resolve([{ avgScore: 0.8, sampleSize: 5 }]);  // previous
            return {
              limit: () => Promise.resolve([{ companyId: "co-1" }]),
            };
          },
          limit: () => Promise.resolve([{ companyId: "co-1" }]),
        }),
      }),
    } as any;

    // drop = 0.8 - 0.5 = 0.3, default threshold = 0.1 → drift!
    await checkDrift(db, "agent-1", "co-1");
    expect(mockLogActivity).toHaveBeenCalledOnce();
    const call_ = mockLogActivity.mock.calls[0]![1];
    expect(call_.action).toBe("quality.drift");
    expect(call_.entityId).toBe("agent-1");
  });
});
