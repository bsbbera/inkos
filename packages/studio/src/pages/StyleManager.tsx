/*
 * Style. Where a piece of work is told whose voice to write in.
 *
 * The old page was a Tailwind island from before the Vermilion work: its own
 * card colours, its own spacing, `text-xl font-bold` numerals that lined up
 * with nothing else in the app. It also lied twice. It ran every sample
 * through the Chinese analyser, so an English paste came back as "1%
 * vocabulary diversity" with counts suffixed 次, and it offered the guide to
 * books alone, which is eight production types that could not be told to sound
 * like anybody.
 *
 * Both are fixed behind this screen. What is left for the screen itself is to
 * say what the numbers mean - a fingerprint is not self-explanatory, and
 * "sentence std dev" told nobody anything - and to be honest that importing
 * replaces whatever voice was there before.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { Empty } from "../components/ui/states";
import { Icon } from "../components/ui/icon";
import { isLive, type Job, type JobsView } from "../hooks/use-jobs";

interface StyleProfile {
  readonly sourceName: string;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly vocabularyDiversity: number;
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
  /** Which analyser actually ran. The old page could not say. */
  readonly language?: "zh" | "en";
}

interface StyleTarget {
  readonly type: string;
  readonly label: string;
  readonly id: string;
  readonly hasStyle: boolean;
  /** What the voice it carries is called, when it carries one. */
  readonly voice?: string;
}

/** A voice in the library, kept under the name somebody gave it. */
interface SavedStyle {
  readonly id: string;
  readonly name: string;
  readonly sourceName?: string;
  readonly language: "zh" | "en";
  readonly createdAt: string;
  readonly sampleChars: number;
  readonly deterministic: boolean;
}

export interface StyleStatusNotice {
  readonly tone: "error" | "success" | "info";
  readonly message: string;
}

export function buildStyleStatusNotice(analyzeStatus: string, importStatus: string): StyleStatusNotice | null {
  const message = analyzeStatus.trim() || importStatus.trim();
  if (!message) return null;
  if (message.startsWith("Error:")) {
    return { tone: "error", message };
  }
  if (message.endsWith("...")) {
    return { tone: "info", message };
  }
  return { tone: "success", message };
}

/**
 * What each number is, in words.
 *
 * A fingerprint is only useful to someone who can read it, and none of these
 * names read on their own. The unit differs by language and that is the whole
 * point of saying it: characters for Chinese, words for English.
 */
function statUnit(language: "zh" | "en" | undefined): string {
  return language === "en" ? "words" : "characters";
}

/**
 * What the screen says about a rewrite that may not have started here.
 *
 * Derived from the job rather than remembered, because the job outlives this
 * component: walk to the audit screen mid-rewrite and back, and the sentence
 * has to still be true.
 */
export function restyleLine(job: Job | null): string {
  if (!job) return "";
  if (isLive(job)) return job.message?.trim() || "Working…";
  if (job.status === "done") {
    return "Done. The draft is rewritten — the audit screen's Restore puts any file back.";
  }
  if (job.status === "cancelled") return "Stopped. Files already rewritten stay rewritten.";
  return `Error: ${job.error ?? "the rewrite failed"}`;
}

export function StyleManager({ jobs }: { readonly jobs: JobsView }) {
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");
  const [target, setTarget] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const [styleName, setStyleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState("");
  const { data: styleData, refetch: refetchStyles } =
    useApi<{ styles: ReadonlyArray<SavedStyle> }>("/styles");
  const styles = styleData?.styles ?? [];
  const [restyleError, setRestyleError] = useState("");
  const { data: targetData, refetch: refetchTargets } =
    useApi<{ targets: ReadonlyArray<StyleTarget> }>("/style/targets");
  const statusNotice = buildStyleStatusNotice(analyzeStatus, importStatus);
  const targets = targetData?.targets ?? [];
  const unit = statUnit(profile?.language);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setProfile(null);
    setAnalyzeStatus("");
    setImportStatus("");
    try {
      const data = await fetchJson<StyleProfile>("/style/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceName: sourceName || "sample" }),
      });
      setProfile(data);
    } catch (e) {
      setAnalyzeStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  /*
   * Keep the voice, under the name it was given.
   *
   * Separated from handing it to a work because they are different acts and
   * used to be one: importing studied the sample *and* wrote it into a folder,
   * so the same voice given to two pieces of work was studied twice and came
   * back as two different voices. Studied once, named, then handed out.
   */
  const handleSave = async () => {
    if (!styleName.trim() || !text.trim()) return;
    setSaving(true);
    setAnalyzeStatus("");
    setImportStatus("");
    try {
      const result = await postApi<{
        style: SavedStyle; deterministic?: boolean; note?: string;
      }>("/styles", { name: styleName.trim(), text, sourceName: sourceName || undefined });
      setImportStatus(
        result?.deterministic
          ? `Saved as "${result.style.name}" from the fingerprint alone. ${result.note ?? ""}`.trim()
          : `Saved as "${result.style.name}". Give it to any piece of work below.`,
      );
      setPicked(result.style.id);
      void refetchStyles();
    } catch (e) {
      setImportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  const handleApply = async () => {
    if (!target || !picked) return;
    const [type, ...rest] = target.split(":");
    const id = rest.join(":");
    setImporting(true);
    setImportStatus("");
    try {
      const result = await postApi<{ style: SavedStyle }>(
        `/productions/${type}/${encodeURIComponent(id)}/style/apply`,
        { styleId: picked },
      );
      setImportStatus(
        `${id} is now written in ${result.style.name}'s voice. New writing and revisions use it; `
        + "the draft already written does not change until you rewrite it.",
      );
      void refetchTargets();
    } catch (e) {
      setImportStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setImporting(false);
  };

  const handleForget = async (id: string) => {
    await fetchJson(`/styles/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (picked === id) setPicked("");
    void refetchStyles();
  };

  const chosen = targets.find((t) => `${t.type}:${t.id}` === target);
  const pickedVoice = styles.find((v) => v.id === picked) ?? null;

  /*
   * Rewriting the draft itself.
   *
   * Polled rather than streamed: the job queue already reports every step, the
   * page only needs the latest line of it, and a chapter takes long enough
   * that a second and a half of lag is invisible. Stopping is the point of
   * showing it at all - this is rewriting somebody's prose, and being able to
   * stop it halfway matters more than watching it.
   */
  const handleRestyle = async () => {
    if (!target) return;
    const [type, ...rest] = target.split(":");
    const id = rest.join(":");
    setRestyleError("");
    try {
      await postApi<{ job: string; files: number }>(
        `/productions/${type}/${encodeURIComponent(id)}/restyle`,
        {},
      );
      await jobs.refresh();
    } catch (e) {
      setRestyleError(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleStopRestyle = async () => {
    if (!restyle) return;
    await jobs.cancel(restyle.id);
  };

  /*
   * The rewrite in flight for the chosen work, whoever started it.
   *
   * This screen used to hold the job id in its own state and poll `/jobs`
   * every second and a half. Both died with the component: walking to the
   * audit screen and back left a rewrite running on the server with nothing on
   * any screen saying so. Looked up by what is being rewritten rather than by
   * an id this session happened to receive, so coming back to the page finds
   * it again.
   */
  const restyle = useMemo(() => {
    if (!target) return null;
    const [type, ...rest] = target.split(":");
    const id = rest.join(":");
    const mine = jobs.jobs.filter(
      (job) => job.stage === "restyle" && job.ref.type === type && job.ref.id === id,
    );
    return mine[mine.length - 1] ?? null;
  }, [jobs.jobs, target]);

  const running = Boolean(restyle && isLive(restyle));
  const restyleStatus = restyleError || restyleLine(restyle);

  /* A finished rewrite may have given the work its first voice. */
  useEffect(() => {
    if (restyle && !isLive(restyle)) void refetchTargets();
  }, [restyle, refetchTargets]);

  return (
    <div className="stack-lg">
      <section className="crop" style={{ paddingBottom: 0 }}>
        <span className="disc stroke" style={{ width: 190, height: 190, left: -88, top: -92, opacity: 0.3 }} />
        <div className="head">
          <h2 className="h-page">Write it in somebody else&rsquo;s hand</h2>
          <p>
            Paste a few pages by an author whose sentences you want. Quire measures how they are
            built, has a model describe the habits behind them, and hands the result to a piece of
            work as its voice. The craft rules stay underneath either way &mdash; this changes how
            the prose sounds, not what counts as good prose.
          </p>
        </div>
      </section>

      <section className="cols" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <div className="panel">
          <div className="panel-head">
            <span className="grow">
              <h3 className="h-panel">The sample</h3>
              <span className="dim" style={{ fontSize: 11 }}>
                A page or two reads better than a paragraph. Under 500 characters and only the
                measurements are taken.
              </span>
            </span>
          </div>
          <div className="panel-body stack">
            <div className="field">
              <label htmlFor="style-name">Call this voice</label>
              <input
                id="style-name"
                className="input"
                type="text"
                value={styleName}
                onChange={(e) => setStyleName(e.target.value)}
                placeholder="Cold Coastal, Mercer, House Voice…"
              />
              <span className="dim" style={{ fontSize: 11 }}>
                The name every screen will use for it. Saving under a name you have already used
                replaces that voice.
              </span>
            </div>
            <div className="field">
              <label htmlFor="style-source">Where the sample is from</label>
              <input
                id="style-source"
                className="input"
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Ursula K. Le Guin, Chapter 1 — optional"
              />
            </div>
            <div className="field">
              <label htmlFor="style-sample">The writing</label>
              <textarea
                id="style-sample"
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                placeholder="Paste the passage here."
                style={{ minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
            </div>
            <div className="rowflex">
              <button
                type="button"
                className="btn"
                onClick={handleAnalyze}
                disabled={!text.trim() || loading}
              >
                <Icon name="pulse" className="ico" />
                {loading ? "Measuring…" : "Measure this voice"}
              </button>
              <button
                type="button"
                className="btn btn-line"
                onClick={handleSave}
                disabled={!text.trim() || !styleName.trim() || saving}
                title={styleName.trim() ? undefined : "Give it a name first"}
              >
                <Icon name="send" className="ico" />
                {saving ? "Studying…" : "Save this voice"}
              </button>
              <span className="dim tnum" style={{ fontSize: 11 }}>
                {text.trim().length.toLocaleString()} characters
              </span>
            </div>
          </div>
        </div>

        <div className="stack">
          {!profile && !loading && (
            <Empty icon="drop" title="Nothing measured yet.">
              Paste a passage and press measure. You will get the shape of the prose &mdash;
              sentence length, rhythm, vocabulary, the openings the author reaches for &mdash;
              before you commit it to anything.
            </Empty>
          )}

          {profile && (
              <div className="panel">
                <div className="panel-head">
                  <span className="grow">
                    <h3 className="h-panel">{profile.sourceName}</h3>
                    <span className="dim" style={{ fontSize: 11 }}>
                      Read as {profile.language === "en" ? "English" : "Chinese"}, measured in {unit}
                    </span>
                  </span>
                </div>
                <div className="panel-body stack">
                  <div className="cols" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                    <div>
                      <span className="label">Sentence length</span>
                      <div className="numeral tnum">{profile.avgSentenceLength.toFixed(1)}</div>
                      <p className="dim" style={{ fontSize: 11 }}>{unit} per sentence, on average</p>
                    </div>
                    <div>
                      <span className="label">Sentence variety</span>
                      <div className="numeral tnum">{profile.sentenceLengthStdDev.toFixed(1)}</div>
                      <p className="dim" style={{ fontSize: 11 }}>
                        how far length swings. Low is even, high alternates long and short
                      </p>
                    </div>
                    <div>
                      <span className="label">Paragraph length</span>
                      <div className="numeral tnum">{profile.avgParagraphLength.toFixed(0)}</div>
                      <p className="dim" style={{ fontSize: 11 }}>{unit} per paragraph</p>
                    </div>
                    <div>
                      <span className="label">Vocabulary range</span>
                      <div className="numeral tnum">{(profile.vocabularyDiversity * 100).toFixed(0)}%</div>
                      <p className="dim" style={{ fontSize: 11 }}>
                        share of {unit} used only once. Higher means less repetition
                      </p>
                    </div>
                  </div>

                  {profile.topPatterns.length > 0 && (
                    <div className="stack-xs">
                      <span className="label">Openings they reach for</span>
                      <div className="rowflex">
                        {profile.topPatterns.map((p) => (
                          <span key={p} className="chip">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {profile.rhetoricalFeatures.length > 0 && (
                    <div className="stack-xs">
                      <span className="label">Figures of speech found</span>
                      <div className="rowflex">
                        {profile.rhetoricalFeatures.map((f) => (
                          <span key={f} className="chip">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
          )}

          {/*
            * The library.
            *
            * Outside the measured-profile block on purpose: the voices you
            * already have are the reason to open this screen most days, and
            * they used to be invisible until you pasted a fresh sample.
            */}
          <div className="panel">
            <div className="panel-head">
              <span className="grow">
                <h3 className="h-panel">Your voices</h3>
                <span className="dim" style={{ fontSize: 11 }}>
                  Studied once, kept under the name you gave, given to as many pieces of work as
                  you like
                </span>
              </span>
            </div>
            <div className="panel-body stack">
              {styles.length === 0 ? (
                <p className="dim" style={{ fontSize: 11 }}>
                  None yet. Paste a passage, name it, and press Save this voice.
                </p>
              ) : (
                <div className="rows">
                  {styles.map((v) => (
                    <div className="row" style={{ padding: "9px 4px", gap: 9 }} key={v.id}>
                      <label className="rowflex" style={{ gap: 9, cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="voice"
                          checked={picked === v.id}
                          onChange={() => setPicked(v.id)}
                        />
                        <b>{v.name}</b>
                      </label>
                      <span className="grow" />
                      <span className="meta">
                        {v.sourceName ? `${v.sourceName} · ` : ""}
                        {v.sampleChars.toLocaleString()} chars
                        {v.deterministic ? " · fingerprint only" : ""}
                      </span>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => void handleForget(v.id)}
                      >
                        Forget
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

              <div className="panel">
                <div className="panel-head">
                  <span className="grow">
                    <h3 className="h-panel">Give this voice to</h3>
                    <span className="dim" style={{ fontSize: 11 }}>
                      Every kind of work except magazines, which take their voice from their
                      series house style
                    </span>
                  </span>
                </div>
                <div className="panel-body stack">
                  <div className="field">
                    <label htmlFor="style-target">The work</label>
                    <select
                      id="style-target"
                      className="input"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Choose one…</option>
                      {targets.map((t) => (
                        <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>
                          {t.label} · {t.id}
                          {t.voice ? ` — ${t.voice}` : t.hasStyle ? " — has a voice" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {targets.length === 0 && (
                    <p className="dim" style={{ fontSize: 11 }}>
                      Nothing to give it to yet. Start a book, a short or a script first and it
                      will appear here.
                    </p>
                  )}

                  {chosen?.hasStyle && (
                    <p className="muted" style={{ fontSize: 11 }}>
                      {chosen.id} is already in {chosen.voice ? `${chosen.voice}'s` : "a"} voice.
                      Giving it another replaces that — a guide holds one voice, not two.
                    </p>
                  )}

                  <div className="rowflex">
                    <button
                      type="button"
                      className="btn btn-line"
                      onClick={handleApply}
                      disabled={!target || !picked || importing}
                      title={picked ? undefined : "Choose a voice above first"}
                    >
                      <Icon name="send" className="ico" />
                      {importing
                        ? "Handing it over…"
                        : pickedVoice
                          ? `Give ${pickedVoice.name} to this work`
                          : "Give a voice to this work"}
                    </button>
                  </div>
                </div>
              </div>

              {chosen?.hasStyle && (
                <div className="panel">
                  <div className="panel-head">
                    <span className="grow">
                      <h3 className="h-panel">Rewrite what is already written</h3>
                      <span className="dim" style={{ fontSize: 11 }}>
                        Every page of {chosen.id}, put through
                        {chosen.voice ? ` ${chosen.voice}'s voice` : " the voice it now has"}
                      </span>
                    </span>
                  </div>
                  <div className="panel-body stack">
                    <p className="muted" style={{ fontSize: 14, maxWidth: "56ch" }}>
                      Events, names, numbers and what every line of dialogue means stay exactly as
                      they are. Only the prose changes. Each file is copied first, so the audit
                      screen&rsquo;s Restore puts any of it back.
                    </p>
                    <p className="dim" style={{ fontSize: 11, maxWidth: "56ch" }}>
                      Files you have signed off are left alone. A rewrite that comes back much
                      shorter than the original is refused rather than saved.
                    </p>
                    <div className="rowflex">
                      <button
                        type="button"
                        className="btn"
                        onClick={handleRestyle}
                        disabled={running}
                      >
                        <Icon name="redo" className="ico" />
                        {running
                          ? "Rewriting…"
                          : chosen.voice
                            ? `Rewrite the draft in ${chosen.voice}'s voice`
                            : "Rewrite the draft in this voice"}
                      </button>
                      {running && (
                        <button type="button" className="btn btn-bad" onClick={handleStopRestyle}>
                          <Icon name="stop" className="ico" />
                          Stop
                        </button>
                      )}
                    </div>
                    {restyleStatus && (
                      <p
                        role="status"
                        className={restyleStatus.startsWith("Error:") ? "fail" : "muted"}
                        style={{ fontSize: 14 }}
                      >
                        {restyleStatus}
                      </p>
                    )}
                  </div>
                </div>
              )}
        </div>
      </section>

      {statusNotice && (
        <div
          role="status"
          className={statusNotice.tone === "error" ? "fail" : "note"}
          style={{ fontSize: 14 }}
        >
          {statusNotice.message}
        </div>
      )}
    </div>
  );
}
