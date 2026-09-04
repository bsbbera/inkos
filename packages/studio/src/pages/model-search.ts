/**
 * Searching a model list.
 *
 * A `<select>` was fine for four models and useless for the 194 one CLI
 * reports: the list is longer than the screen and the only way through it is
 * scrolling. The match is on the service label and the model id together, so
 * "devin glm" finds what "glm" alone would find in four different providers.
 */

export interface SearchModel {
  readonly id: string;
  readonly name?: string;
}

export interface SearchGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<SearchModel>;
}

/** Every term must appear somewhere in "<service label> <model>", in any order. */
export function filterGroups(
  groups: ReadonlyArray<SearchGroup>,
  query: string,
): ReadonlyArray<SearchGroup> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return groups;
  const out: SearchGroup[] = [];
  for (const group of groups) {
    const models = group.models.filter((model) => {
      const hay = `${group.label} ${group.service} ${model.name ?? ""} ${model.id}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
    if (models.length > 0) out.push({ ...group, models });
  }
  return out;
}

export function countModels(groups: ReadonlyArray<SearchGroup>): number {
  return groups.reduce((n, group) => n + group.models.length, 0);
}
