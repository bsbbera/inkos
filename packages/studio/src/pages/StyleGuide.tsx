/*
 * The style guide. Mock 26-styleguide.
 *
 * Not documentation - a living reference rendered from the same stylesheet the
 * app uses, so a token that drifts is visible here the same day. If something
 * on this page looks wrong, the app is wrong, not the page.
 */
import { useState } from "react";
import { Icon, ICONS, type IconName } from "../components/ui/icon";
import { Seg, Tabs, toast } from "../components/ui/vermilion";
import { useTheme, type ThemeMode } from "../hooks/use-theme";

const SWATCHES: readonly { readonly token: string; readonly what: string }[] = [
  { token: "--putty", what: "The page behind everything. No other background wash." },
  { token: "--paper", what: "Light panels, tiles, inputs." },
  { token: "--char", what: "The dark card. The work itself: manuscript, run threads." },
  { token: "--vermilion", what: "The one accent. Discs, primary buttons, focus, progress." },
  { token: "--ok", what: "State only. Never decorative." },
  { token: "--warn", what: "State only." },
  { token: "--bad", what: "State only." },
];

const TYPE = [68, 54, 43, 34, 27.5, 22, 17.5, 14, 11];

export function StyleGuide() {
  const { mode, setMode } = useTheme();
  const [tab, setTab] = useState("colour");

  return (
    <div className="stack-lg">
      <section className="crop">
        <span className="disc fill" style={{ width: 210, height: 210, right: -104, top: -116, opacity: 0.13 }} />
        <div className="spread" style={{ alignItems: "flex-end" }}>
          <div>
            <h2 className="h-page">The system, as it actually renders</h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 10, maxWidth: "56ch" }}>
              Every element below is drawn by the shared stylesheet with no local styles. One
              accent, four workers, three states; nine type sizes and no others; four radii.
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
                <th style={{ width: 90 }}>Swatch</th>
                <th style={{ width: 150 }}>Token</th>
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
          {TYPE.map((px) => (
            <div className="rowflex" key={px} style={{ gap: 16, alignItems: "baseline" }}>
              <span className="mono dim" style={{ width: 56, fontSize: 11 }}>{px}px</span>
              <span style={{ fontSize: px, letterSpacing: px > 22 ? "-.025em" : undefined }}>
                The keeper counts the oil
              </span>
            </div>
          ))}
          <p className="read" style={{ marginTop: 8 }}>
            Prose is Literata and only Literata. This paragraph is the reading face at reading
            size, which is the one job in this app that lasts hours.
          </p>
        </section>
      ) : null}

      {tab === "controls" ? (
        <section className="stack">
          <div className="panel stack">
            <h3 className="h-panel">Buttons</h3>
            <div className="rowflex" style={{ gap: 9 }}>
              <button type="button" className="btn" onClick={() => toast("That is the toast.")}>
                Primary
              </button>
              <button type="button" className="btn btn-line">Outline</button>
              <button type="button" className="btn btn-quiet">Quiet</button>
              <button type="button" className="btn btn-bad">Destructive</button>
              <button type="button" className="btn btn-sm">Small</button>
            </div>
          </div>

          <div className="panel stack">
            <h3 className="h-panel">Pills and state</h3>
            <div className="rowflex" style={{ gap: 9 }}>
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
              <p style={{ marginTop: 4 }}>
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

      {tab === "icons" ? (
        <section className="panel">
          <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
            {(Object.keys(ICONS) as IconName[]).map((name) => (
              <div
                key={name}
                className="rowflex"
                style={{ gap: 9, padding: "10px 4px", flexWrap: "nowrap" }}
              >
                <Icon name={name} size={20} />
                <span className="mono dim trunc" style={{ fontSize: 11 }}>{name}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
