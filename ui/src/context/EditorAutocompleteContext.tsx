import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildSkillMentionHref } from "@stapler/shared";
import { instanceSkillsApi } from "../api/skills";
import { queryKeys } from "../lib/queryKeys";

export interface SkillCommandOption {
  id: string;
  kind: "skill";
  skillId: string;
  key: string;
  name: string;
  slug: string;
  description: string | null;
  href: string;
  aliases: string[];
}

interface EditorAutocompleteContextValue {
  slashCommands: SkillCommandOption[];
}

const EditorAutocompleteContext = createContext<EditorAutocompleteContextValue>({
  slashCommands: [],
});

export function EditorAutocompleteProvider({ children }: { children: ReactNode }) {
  const { data: skills = [] } = useQuery({
    queryKey: queryKeys.instanceSkills.list,
    queryFn: () => instanceSkillsApi.list(),
  });

  const value = useMemo<EditorAutocompleteContextValue>(() => ({
    slashCommands: skills.map((skill) => ({
      id: `skill:${skill.id}`,
      kind: "skill",
      skillId: skill.id,
      key: skill.key,
      name: skill.name,
      slug: skill.slug,
      description: skill.description ?? null,
      href: buildSkillMentionHref(skill.id, skill.slug),
      aliases: [skill.slug, skill.name, skill.key],
    })),
  }), [skills]);

  return (
    <EditorAutocompleteContext.Provider value={value}>
      {children}
    </EditorAutocompleteContext.Provider>
  );
}

export function useEditorAutocomplete() {
  return useContext(EditorAutocompleteContext);
}
