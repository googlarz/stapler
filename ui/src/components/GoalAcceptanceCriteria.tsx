import { useState } from "react";
import type { GoalAcceptanceCriterion } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  criteria: GoalAcceptanceCriterion[];
  onUpdate: (next: GoalAcceptanceCriterion[]) => void;
}

/**
 * Editable list of acceptance criteria for a goal. Read-only on each
 * criterion until the user clicks it; then the text becomes editable.
 * Order is preserved by the `order` field, which we reassign on
 * add/remove/reorder to stay dense (0, 1, 2, ...).
 */
export function GoalAcceptanceCriteria({ criteria, onUpdate }: Props) {
  const [draft, setDraft] = useState("");
  const sorted = [...criteria].sort((a, b) => a.order - b.order);

  function reindex(list: GoalAcceptanceCriterion[]): GoalAcceptanceCriterion[] {
    return list.map((c, i) => ({ ...c, order: i }));
  }

  function addCriterion() {
    const text = draft.trim();
    if (!text) return;
    const next = reindex([
      ...sorted,
      { id: crypto.randomUUID(), text, required: true, order: sorted.length },
    ]);
    onUpdate(next);
    setDraft("");
  }

  function updateText(id: string, text: string) {
    const next = sorted.map((c) => (c.id === id ? { ...c, text } : c));
    onUpdate(next);
  }

  function toggleRequired(id: string) {
    const next = sorted.map((c) => (c.id === id ? { ...c, required: !c.required } : c));
    onUpdate(next);
  }

  function remove(id: string) {
    const next = reindex(sorted.filter((c) => c.id !== id));
    onUpdate(next);
  }

  return (
    <div className="space-y-2">
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No acceptance criteria yet. Add one below to define what "done" looks like for this goal.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((c) => (
            <li key={c.id} className="flex items-start gap-2 rounded-md border border-border p-2">
              <input
                type="checkbox"
                checked={c.required}
                onChange={() => toggleRequired(c.id)}
                className="mt-1"
                title={c.required ? "Required" : "Optional"}
              />
              <input
                type="text"
                value={c.text}
                onChange={(e) => updateText(c.id, e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => remove(c.id)}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCriterion();
            }
          }}
          placeholder="Add an acceptance criterion..."
          className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/40"
        />
        <Button size="sm" variant="outline" onClick={addCriterion} disabled={!draft.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
