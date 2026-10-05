/**
 * Several voices at once, without turning into none of them.
 *
 * What people actually want is "mostly Chandler, some Didion for description,
 * a touch of my own dialogue" — not a fourth writer who is the average of
 * three. Averaging is what a naive mix produces and it reliably sounds
 * generic, which is the opposite of the point.
 *
 * So a blend has owners: exactly one voice is responsible for each facet, and
 * for that facet its answer is taken outright rather than mixed. The weights
 * decide everything nobody claimed (05 §4).
 */

/** The parts of a voice that can be owned by one member of a blend. */
export const FACETS = [
  "sentence", "rhythm", "openers", "description", "imagery",
  "dialogue", "humour", "pacing", "punctuation",
] as const;

export type Facet = (typeof FACETS)[number];

export interface BlendEntry {
  readonly id: string;
  readonly weight: number;
  readonly facets: ReadonlyArray<Facet>;
}

/** At five, a blend stops being a choice and starts being an average. */
export const MAX_BLEND = 5;

/**
 * Clean a blend from whatever the client sent.
 *
 * Returns `null` for "no blend, just the one voice", so the caller can leave
 * `style.json` as it was rather than writing a one-entry blend that means the
 * same thing and has to be special-cased everywhere else.
 *
 * Three rules are enforced rather than validated, because a blend that half
 * applies is worse than one that was corrected: at most five entries, weights
 * summing to 1, and one owner per facet — a facet claimed twice goes to the
 * heavier voice, which is also what the UI shows as the dropped rule.
 */
export function normaliseBlend(
  raw: unknown,
  dominant: string,
): ReadonlyArray<BlendEntry> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const seen = new Set<string>();
  const rows: Array<{ id: string; weight: number; facets: Facet[] }> = [];
  for (const item of raw) {
    const row = item as { id?: unknown; weight?: unknown; facets?: unknown };
    const id = String(row.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const weight = Number(row.weight);
    rows.push({
      id,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 0,
      facets: (Array.isArray(row.facets) ? row.facets : [])
        .map((f) => String(f) as Facet)
        .filter((f) => (FACETS as ReadonlyArray<string>).includes(f)),
    });
    if (rows.length >= MAX_BLEND) break;
  }
  if (!rows.length) return null;

  // The applied voice is the dominant one whether or not it was listed: it is
  // the guide that was copied into the work, so a blend that omitted it would
  // compile against a guide nobody is mixing.
  if (!rows.some((r) => r.id === dominant)) {
    rows.unshift({ id: dominant, weight: Math.max(...rows.map((r) => r.weight), 0.5), facets: [] });
    rows.splice(MAX_BLEND);
  }

  const total = rows.reduce((n, r) => n + r.weight, 0);
  const weights = total > 0
    ? rows.map((r) => r.weight / total)
    : rows.map(() => 1 / rows.length);

  const heaviest = [...rows.keys()].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const owner = new Map<Facet, number>();
  for (const index of heaviest) {
    for (const facet of rows[index]!.facets) {
      if (!owner.has(facet)) owner.set(facet, index);
    }
  }

  return rows.map((row, i) => ({
    id: row.id,
    weight: Math.round((weights[i] ?? 0) * 1000) / 1000,
    facets: row.facets.filter((f) => owner.get(f) === i),
  }));
}

/** The facets a lighter voice asked for and did not get, for the UI to show. */
export function droppedFacets(
  raw: unknown,
  applied: ReadonlyArray<BlendEntry> | null,
): ReadonlyArray<{ id: string; facet: Facet; wonBy: string }> {
  if (!Array.isArray(raw) || !applied) return [];
  const out: Array<{ id: string; facet: Facet; wonBy: string }> = [];
  for (const item of raw) {
    const row = item as { id?: unknown; facets?: unknown };
    const id = String(row.id ?? "").trim();
    const kept = applied.find((a) => a.id === id);
    if (!kept) continue;
    for (const facet of (Array.isArray(row.facets) ? row.facets : []).map((f) => String(f) as Facet)) {
      if (kept.facets.includes(facet)) continue;
      const wonBy = applied.find((a) => a.facets.includes(facet))?.id;
      if (wonBy) out.push({ id, facet, wonBy });
    }
  }
  return out;
}
