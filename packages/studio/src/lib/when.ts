/*
 * A moment, the way a person says it.
 *
 * Screens printed "9/16/2026" beside "11 hours ago", and Radar printed
 * "9/16/2026, 3:53:17 PM" down to the second. One rule now: the last day is
 * relative, this year is "16 Sep", and only an older year carries the year.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function when(iso: string | number | Date | undefined | null, now = Date.now()): string {
  if (iso === undefined || iso === null || iso === "") return "";
  const t = new Date(iso);
  const ms = t.getTime();
  if (Number.isNaN(ms)) return "";
  const ago = now - ms;
  if (ago >= 0 && ago < 60_000) return "just now";
  if (ago >= 0 && ago < 3_600_000) return `${Math.floor(ago / 60_000)} min ago`;
  if (ago >= 0 && ago < 86_400_000) {
    const h = Math.floor(ago / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const sameYear = t.getFullYear() === new Date(now).getFullYear();
  // A fixed table: the locale's short month is "Sept" on one ICU and "Sep" on the next.
  const day = `${t.getDate()} ${MONTHS[t.getMonth()]}`;
  return sameYear ? day : `${day} ${t.getFullYear()}`;
}

/** The same, with the time of day for anything older than a day: "16 Sep, 15:53". */
export function whenExact(iso: string | number | Date | undefined | null, now = Date.now()): string {
  const day = when(iso, now);
  if (!day || /ago|now/.test(day)) return day;
  const t = new Date(iso as string);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day}, ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
