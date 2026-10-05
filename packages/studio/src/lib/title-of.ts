/**
 * A folder name, read as a title.
 *
 * Every creation is stored under a slug because a slug is a safe filename, and
 * the screen printed the slug: `the-lamp-room`, `the-kolam-drawn-at-dawn`.
 * That is the disk's business, not the reader's. File names are left alone
 * where they identify a file - only the name of a piece of work is dressed up,
 * and the slug stays in the tooltip so the folder is still findable.
 *
 * Small words stay small unless they open the title, which is the difference
 * between a title and a shouted one.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of",
  "on", "or", "the", "to", "up", "via", "with",
]);

export function titleOf(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim().split(/[ ]+/).filter(Boolean);
  if (words.length === 0) return slug;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      // A word already carrying capitals is somebody's spelling, not a slug's.
      if (word !== lower && word !== word.toUpperCase()) return word;
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
