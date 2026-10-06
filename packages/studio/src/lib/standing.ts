/*
 * Where a piece of work stands, in the one vocabulary every screen uses.
 *
 * Home raised "7 files need a read" over an issue the Magazines shelf called
 * "drafting, none waiting", and The Lamp Room was "blocked" on Home but "needs
 * a read" on Books. Both screens counted the same files and ranked them their
 * own way. This is the ranking Home's gates use, so a tile and a gate can no
 * longer disagree: a blocking finding outranks reading, reading outranks the
 * signature, and nothing is done until it is signed off.
 */

export type Standing = "drafting" | "waiting" | "done";

export interface StandingBadge {
  readonly state: Standing;
  readonly label: string;
  /** Component classes for the pill. */
  readonly tone: string;
}

export interface Counted {
  readonly files: number;
  readonly read: number;
  readonly signedOff: number;
  readonly blocking: number;
}

export function standingOf(c: Counted | undefined, stoppedAtGate = false): StandingBadge {
  if (c && c.blocking > 0) return { state: "waiting", label: "blocked", tone: "pill pill-bad" };
  if (stoppedAtGate) return { state: "waiting", label: "ready to sign", tone: "pill pill-warn" };
  if (!c || c.files === 0) return { state: "drafting", label: "drafting", tone: "pill" };
  if (c.read < c.files) return { state: "waiting", label: "needs a read", tone: "pill pill-warn" };
  if (c.signedOff < c.files) return { state: "waiting", label: "ready to sign", tone: "pill pill-warn" };
  return { state: "done", label: "signed off", tone: "pill pill-ok" };
}
