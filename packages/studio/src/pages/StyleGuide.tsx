/*
 * The style guide. Mock 26-styleguide.
 *
 * Not documentation - a living reference rendered from the same stylesheet the
 * app uses, so a token that drifts is visible here the same day. If something
 * on this page looks wrong, the app is wrong, not the page.
 */
import { useState } from "react";
import { Icon, ICONS, type IconName } from "../components/ui/icon";
import { Seg, Tabs, toast, toastError } from "../components/ui/vermilion";
import { Bar, Ring, Spinner, Working } from "../components/ui/working";
import { Empty, Failed, Loading } from "../components/ui/states";
import { TYPE_STEPS } from "../lib/utils";
import { useTheme, type ThemeMode } from "../hooks/use-theme";
import { ask } from "../components/ConfirmDialog";

const SWATCHES: readonly { readonly token: string; readonly what: string }[] = [
  { token: "--putty", what: "The page behind everything. No other background wash." },
  { token: "--paper", what: "Light panels, tiles, inputs." },
  { token: "--char", what: "The dark card. The work itself: manuscript, run threads." },
  { token: "--vermilion", what: "The one accent. Discs, primary buttons, focus, progress." },
  { token: "--ok", what: "State only. Never decorative." },
  { token: "--warn", what: "State only." },
  { token: "--bad", what: "State only." },
];

const MOTION: readonly { readonly token: string; readonly ms: string; readonly what: string }[] = [
  { token: "--fast", ms: "150ms", what: "A control answering the pointer: hover, press, focus." },
  { token: "--med", ms: "300ms", what: "Anything that moves layout: a panel, a drawer, a route." },
  { token: "--slow", ms: "640ms", what: "The one moment meant to be noticed." },
];

export function StyleGuide() {
  const { mode, setMode } = useTheme();
  const [tab, setTab] = useState("colour");

  return (
    <div className="stack-lg">
      <section className="crop">
        <span className="disc fill w-52.5 h-52.5 -right-26 -top-29 opacity-13" />
        <div className="spread items-end">
          <div>
            <h2 className="h-page">The system, as it actually renders</h2>
            <p className="muted text-body mt-2.5 max-w-measure">
              Every element below is drawn by the shared stylesheet with no local styles. One
              accent, four workers, three states; eleven type sizes and no others; three radii;
              one easing and three durations.
            </p>
          </div>
          <Seg<ThemeMode>
            options={[
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </section>

      <Tabs
        items={[
          { value: "colour", label: "Colour" },
          { value: "type", label: "Type" },
          { value: "controls", label: "Controls" },
          { value: "motion", label: "Motion" },
          { value: "states", label: "States" },
          { value: "icons", label: `Icons (${Object.keys(ICONS).length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "colour" ? (
        <section className="panel">
          <table className="spec">
            <thead>
              <tr>
                <th className="w-22.5">Swatch</th>
                <th className="w-37.5">Token</th>
                <th>What it is for</th>
              </tr>
            </thead>
            <tbody>
              {SWATCHES.map((s) => (
                <tr key={s.token}>
                  <td>
                    <span className="sw" style={{ background: `var(${s.token})` }} />
                  </td>
                  <td className="mono">{s.token}</td>
                  <td>{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "type" ? (
        <section className="panel stack">
          {[...TYPE_STEPS].reverse().map((step) => (
            <div className="rowflex gap-4 items-baseline flex-nowrap" key={step}>
              <span className="mono dim w-22 shrink-0 text-cap">text-{step}</span>
              <span className="trunc" style={{ fontSize: `var(--fs-${step})` }}>
                The keeper counts the oil
              </span>
            </div>
          ))}
          <p className="read mt-2">
            Prose is Literata and only Literata. This paragraph is the reading face at reading
            size, which is the one job in this app that lasts hours.
          </p>
        </section>
      ) : null}

      {tab === "controls" ? (
        <section className="stack">
          <div className="panel stack">
            <h3 className="h-panel">Buttons</h3>
            <div className="rowflex gap-2.5">
              <button type="button" className="btn" onClick={() => toast("That is the toast.")}>
                Primary
              </button>
              <button type="button" className="btn btn-line">Outline</button>
              <button type="button" className="btn btn-quiet">Quiet</button>
              <button
                type="button"
                className="btn btn-bad"
                onClick={async () => {
                  if (await ask({ title: "Delete this draft?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true })) {
                    toastError(new Error("page-8: antigravity: rate-limit — Individual quota reached. Resets in 2h30m50s."), "Not deleted.");
                  }
                }}
              >
                Destructive
              </button>
              <button type="button" className="btn btn-sm">Small</button>
            </div>
          </div>

          <div className="panel stack">
            <h3 className="h-panel">Pills and state</h3>
            <div className="rowflex gap-2.5">
              <span className="pill">neutral</span>
              <span className="pill pill-fill">drafting</span>
              <span className="pill pill-ok">approved</span>
              <span className="pill pill-warn">needs a read</span>
              <span className="pill pill-bad">blocked</span>
              <span className="pill mono">claude · sonnet-4.6</span>
            </div>
          </div>

          <div className="panel stack">
            <h3 className="h-panel">Fields</h3>
            <div className="field">
              <label htmlFor="sg-in">A label says what, not how</label>
              <input id="sg-in" className="input" placeholder="The Lamp Room" />
            </div>
          </div>

          <div className="fail">
            <div>
              <b>Failure states what stopped, what survived, and the way forward.</b>
              <p className="mt-1">
                “Error occurred” is banned here, and so is a dead end.
              </p>
            </div>
          </div>

          <div className="empty">
            <Icon name="book" size={22} />
            <h3>Empty says what goes here.</h3>
            <p>Not that there is nothing.</p>
          </div>
        </section>
      ) : null}

      {tab === "motion" ? (
        <section className="stack">
          <div className="panel">
            <table className="spec">
              <thead>
                <tr><th className="w-22.5">Token</th><th className="w-22.5">Time</th><th>What it is for</th></tr>
              </thead>
              <tbody>
                {MOTION.map((m) => (
                  <tr key={m.token}><td className="mono">{m.token}</td><td className="mono">{m.ms}</td><td>{m.what}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="note mt-3">
              One easing, <span className="mono">--ease</span>. Transform and opacity only. With
              reduced motion every animation ends where it was going.
            </p>
          </div>
          <div className="panel stack">
            <h3 className="h-panel">The four working states</h3>
            <p className="note">
              The only movement beyond hover and press. Each has one shape on every screen, and a
              word beside it. Never in or beside the reading column.
            </p>
            <div className="stack-xs">
              <Working kind="searching" label="Searching the web…" />
              <Working kind="planning" label="Planning the issue…" />
              <Working kind="thinking" label="Thinking…" />
              <span className="ws">Writing page 4<span className="caret" aria-hidden="true" /></span>
              <Working kind="generating" label="Generating pictures…" />
              <Working kind="generating" value={0.6} label="Generating pictures · 6 of 10" />
            </div>
          </div>
          <div className="panel stack">
            <h3 className="h-panel">Progress</h3>
            <div className="rowflex gap-4">
              <Ring value={0.4} size="sm" />
              <Ring value={0.4} />
              <Ring value={0.4} size="lg" />
              <Spinner />
              <Bar value={0.4} className="w-40" />
            </div>
          </div>
        </section>
      ) : null}

      {tab === "states" ? (
        <section className="stack">
          <div className="panel"><Loading what="Reading your truth files…" /></div>
          <Failed what="The audit stopped at page 7." detail="429 Too Many Requests" kept="Pages 1–6 are saved." retry={() => toast("Trying again.")} />
          <Empty icon="book" title="Your books go here." action={<button type="button" className="btn btn-sm">Start a book</button>}>
            Start one from a sentence, a folder, or a book you already have.
          </Empty>
        </section>
      ) : null}

      {tab === "icons" ? (
        <section className="panel">
          <div className="tiles grid-cols-[repeat(auto-fill,minmax(--spacing(30),1fr))]">
            {(Object.keys(ICONS) as IconName[]).map((name) => (
              <div
                key={name}
                className="rowflex gap-2.5 py-2.5 px-1 flex-nowrap"
              >
                <Icon name={name} size={20} />
                <span className="mono dim trunc text-cap">{name}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
