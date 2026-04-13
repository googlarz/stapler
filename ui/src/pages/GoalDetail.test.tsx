// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalPropertiesToggleButton, GoalProgressBar } from "./GoalDetail";
import type { GoalProgress } from "@paperclipai/shared";

describe("GoalPropertiesToggleButton", () => {
  it("shows the reopen control when the properties panel is hidden", () => {
    const html = renderToStaticMarkup(
      <GoalPropertiesToggleButton panelVisible={false} onShowProperties={() => {}} />,
    );

    expect(html).toContain('title="Show properties"');
    expect(html).toContain("opacity-100");
  });

  it("collapses the reopen control while the properties panel is already visible", () => {
    const html = renderToStaticMarkup(
      <GoalPropertiesToggleButton panelVisible onShowProperties={() => {}} />,
    );

    expect(html).toContain("opacity-0");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("w-0");
  });
});

describe("GoalProgressBar", () => {
  it("renders the done/total label when totalIssues > 0", () => {
    const progress: GoalProgress = { totalIssues: 7, doneIssues: 3, completionPct: 42 };
    const html = renderToStaticMarkup(<GoalProgressBar progress={progress} />);

    expect(html).toContain("3");
    expect(html).toContain("7");
    expect(html).toContain("42%");
  });

  it("renders the fill bar with a width matching completionPct", () => {
    const progress: GoalProgress = { totalIssues: 7, doneIssues: 3, completionPct: 42 };
    const html = renderToStaticMarkup(<GoalProgressBar progress={progress} />);

    expect(html).toContain("width:42%");
  });

  it("renders nothing when totalIssues is 0", () => {
    const progress: GoalProgress = { totalIssues: 0, doneIssues: 0, completionPct: 0 };
    const html = renderToStaticMarkup(<GoalProgressBar progress={progress} />);

    expect(html).toBe("");
  });

  it("renders nothing when progress is undefined", () => {
    const html = renderToStaticMarkup(<GoalProgressBar progress={undefined} />);

    expect(html).toBe("");
  });
});
