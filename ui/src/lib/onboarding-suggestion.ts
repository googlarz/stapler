export interface OnboardingSuggestion {
  adapterType: string;
  adapterHint: string; // short explanation shown next to the adapter grid
  taskTitle: string;
  taskDescription: string;
}

export function suggestFromGoal(goal: string): OnboardingSuggestion | null {
  const trimmed = goal.trim();
  if (!trimmed) return null;
  const g = trimmed.toLowerCase();

  // Adapter selection
  let adapterType = "claude_local";
  let adapterHint = "Claude handles complex reasoning and long tasks well.";

  if (/\b(local|private|offline|self.host|ollama)\b/.test(g)) {
    adapterType = "ollama_local";
    adapterHint = "Ollama runs models fully locally — good fit for private workflows.";
  } else if (/\b(gemini|google|search|browse|web)\b/.test(g)) {
    adapterType = "gemini_local";
    adapterHint = "Gemini has strong research and web-grounded capabilities.";
  }

  // Task title — use the first line of the goal, truncated to 60 chars
  const firstLine = trimmed.split(/\r?\n/)[0].trim();
  const titleSuffix =
    firstLine.length === 0
      ? ""
      : firstLine.length <= 60
        ? firstLine
        : `${firstLine.slice(0, 57)}…`;
  const taskTitle = titleSuffix
    ? `Plan the first milestone toward: ${titleSuffix}`
    : "Plan the first milestone";

  // Task description — keyword templates.
  // Note: trailing \b is intentionally omitted on stems like "automat" so that
  // "automate", "automation", "automated" all match correctly.
  let taskDescription: string;

  if (/\b(saas|product|app|software|platform|mvp)\b/.test(g)) {
    taskDescription = `Goal: ${firstLine}\n\n- Research existing solutions and identify the gap\n- Define the core user persona and their main pain point\n- Outline the MVP feature set (must-have only)\n- Propose a technical stack and rough architecture\n- Identify the first concrete task for the engineering team`;
  } else if (/\b(market|sell|sales|growth|customer|revenue|gtm)\b/.test(g)) {
    taskDescription = `Goal: ${firstLine}\n\n- Profile 3 target customer segments\n- Research top 5 competitors: pricing, positioning, weaknesses\n- Draft a go-to-market strategy with a 90-day action plan\n- Suggest initial acquisition channels ranked by expected ROI`;
  } else if (/\b(research|analys|report|study|survey|data)/.test(g)) {
    taskDescription = `Goal: ${firstLine}\n\n- Define the research question and success criteria\n- Identify primary and secondary sources\n- Gather and synthesize findings\n- Produce a structured report with actionable recommendations`;
  } else if (/\b(automat|workflow|process|pipeline|integrat)/.test(g)) {
    taskDescription = `Goal: ${firstLine}\n\n- Map the current process end-to-end\n- Identify the top 3 bottlenecks and automation opportunities\n- Propose tooling and implementation approach\n- Define success metrics`;
  } else if (/\b(content|blog|write|publish|media|brand)\b/.test(g)) {
    taskDescription = `Goal: ${firstLine}\n\n- Define the target audience and content pillars\n- Audit existing content (if any)\n- Produce the first content piece\n- Plan a 4-week content calendar`;
  } else {
    taskDescription = `Goal: ${firstLine}\n\n- Break the goal into concrete milestones\n- Identify dependencies and risks\n- Propose a 30/60/90-day plan\n- List the first 3 concrete actions to take`;
  }

  return { adapterType, adapterHint, taskTitle, taskDescription };
}
