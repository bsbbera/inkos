/**
 * Which of the Doctor page's three states is showing.
 *
 * A state machine rather than a chain of ternaries in the view, because the
 * bug this exists to prevent was a missing state, not a wrong one: the page
 * rendered a spinner whenever it had no data and never consulted `error`, so
 * the one screen a person opens *because* something is broken sat spinning
 * forever when its own backend was the broken thing — indistinguishable from
 * a slow probe.
 *
 * `error` wins over `loading` deliberately. A refetch after a failure sets
 * both, and showing the spinner again would hide the reason the person is
 * still here.
 */
export type DoctorViewState = "error" | "loading" | "ready";

export function doctorViewState(input: {
  readonly error: string | null;
  readonly data: unknown;
}): DoctorViewState {
  if (input.error) return "error";
  return input.data ? "ready" : "loading";
}
