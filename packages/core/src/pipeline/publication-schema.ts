/**
 * What a `publication.json` has to be.
 *
 * Books validate their configuration on the way in and out; issues did not,
 * and by Phase 5 there were tools mutating an issue from outside the run that
 * created it. A page with a string `n`, a `pages` key that became an object, a
 * truncated write — nothing caught any of it, and the first sign was a stage
 * throwing on `undefined` somewhere far from the cause.
 *
 * The line this draws is narrow, and it took two tries to find. The first
 * version required what `PublicationIssue` declares, and the first real issue
 * it met — made before `type`, a section's `question` and a page's `premise`
 * existed — would not load. The second still typed the optional fields, and
 * the same issue failed again on `density: null`, `pillar: null` and furniture
 * stored as bare strings. A schema that refuses the user's own back catalogue
 * is not validation; it is data loss with a good error message.
 *
 * So what is required is the spine and nothing else: an id, a list of sections,
 * a list of pages, and a page number that is a number. That still catches what
 * actually goes wrong — a truncated write, `pages` becoming an object, an `n`
 * arriving as a string, two pages claiming the same number — and it leaves the
 * shape of everything else to the stages, which already default around it.
 *
 * Passthrough is on so a field added by a newer version of the pipeline
 * survives a round trip through an older one instead of being silently
 * dropped — an issue is the user's, not ours to prune.
 */

import { z } from "zod";

import type { PublicationIssue } from "./publication-runner.js";

const PageSchema = z.object({
  n: z.number().int().min(1),
  // Three states, all meaningful: null is unwritten, "" is a written plate,
  // text is a written page. Collapsing them is how the counts drifted apart.
  body: z.string().nullable().optional(),
}).passthrough();

export const PublicationIssueSchema = z.object({
  id: z.string().min(1),
  sections: z.array(z.object({ n: z.number().int().min(1) }).passthrough()),
  pages: z.array(PageSchema),
}).passthrough();

/**
 * Check an issue, or say precisely where it is wrong.
 *
 * Returns the value unchanged rather than zod's output: nothing here would be
 * stripped (passthrough), but returning the parsed object would make the schema
 * the shape of the record, and `publication.json` is.
 */
export function validateIssue(value: unknown, where: string): PublicationIssue {
  const result = PublicationIssueSchema.safeParse(value);
  if (!result.success) {
    const problems = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${where} is not a valid publication: ${problems}`);
  }
  const issue = value as PublicationIssue;

  // One invariant zod cannot state, which every stage assumes: a page number
  // is a key. Two pages numbered 7 means a write lands on whichever comes
  // first in the array and the other silently never gets written.
  const seen = new Set<number>();
  for (const page of issue.pages) {
    if (seen.has(page.n)) throw new Error(`${where} has two pages numbered ${page.n}`);
    seen.add(page.n);
  }
  return issue;
}
