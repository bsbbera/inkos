import { fetchJson, useApi } from "../hooks/use-api";
import { useState } from "react";
import type { TFunction } from "../hooks/use-i18n";
import { Icon } from "../components/ui/icon";
import { Empty } from "../components/ui/states";
import { toast } from "../components/ui/vermilion";

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
  readonly legacy?: boolean;
  readonly readonly?: boolean;
  readonly readonlyReason?: string;
}

// Phase 5 hotfix: shim files are read-only — point users at the
// authoritative outline/* path so edits actually land where the runtime
// reads them.
export const SHIM_AUTHORITATIVE_PATH: Readonly<Record<string, string>> = {
  "story_bible.md": "outline/story_frame.md",
  "book_rules.md": "outline/story_frame.md",
};

/**
 * Phase hotfix 2: when the GET response carries `legacy: true`, the file is
 * a Phase 5 compat shim. The UI must hide the Edit button and surface a
 * warning pointing at the authoritative outline path. This helper centralizes
 * the rule so it's unit-testable without a DOM.
 */
export interface FilePresentation {
  readonly canEdit: boolean;
  readonly legacy: boolean;
  readonly authoritativePath: string | null;
  readonly readonly: boolean;
  readonly readonlyReason: string | null;
}

export function deriveFilePresentation(
  fileName: string | null,
  fileData: { content: string | null; legacy?: boolean; readonly?: boolean; readonlyReason?: string } | null | undefined,
): FilePresentation {
  const legacy = fileData?.legacy === true;
  const readonly = fileData?.readonly === true;
  const authoritativePath = fileName ? SHIM_AUTHORITATIVE_PATH[fileName] ?? null : null;
  // Edit only makes sense when we actually have content AND it's not a shim.
  const canEdit = !!fileName && !!fileData && fileData.content != null && !legacy && !readonly;
  return {
    canEdit,
    legacy,
    authoritativePath,
    readonly,
    readonlyReason: readonly ? fileData?.readonlyReason ?? "readonly" : null,
  };
}

/*
 * Authority order, which is the whole point of the screen.
 *
 * When two files disagree the higher tier decides, and the lower one is what
 * gets edited. The list used to be in whatever order the directory returned,
 * so nothing on screen said which file won an argument.
 */
export const TIERS = ["direction", "foundation", "rules", "runtime", "memory"] as const;
export type Tier = (typeof TIERS)[number];

const TIER_OF: Readonly<Record<string, Tier>> = {
  "direction.json": "direction",
  "people.json": "foundation",
  "places.json": "foundation",
  "timeline.json": "foundation",
  "voice.json": "rules",
  "continuity.json": "rules",
  "runtime.json": "runtime",
  "memory.json": "memory",
  "scratch.json": "memory",
};

/** An unlisted file counts as foundation: it is canon until something says otherwise. */
export function tierOf(name: string): Tier {
  return TIER_OF[name] ?? "foundation";
}

export function byAuthority<T extends { readonly name: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    const d = TIERS.indexOf(tierOf(a.name)) - TIERS.indexOf(tierOf(b.name));
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

export function TruthFiles({ bookId, t }: { readonly bookId: string; readonly t: TFunction }) {
  const { data } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const { data: fileData, refetch: refetchFile } = useApi<{
    file: string;
    content: string | null;
    legacy?: boolean;
    readonly?: boolean;
    readonlyReason?: string;
  }>(selected ? `/books/${bookId}/truth/${selected}` : "");

  const presentation = deriveFilePresentation(selected, fileData);
  const files = byAuthority(data?.files ?? []);

  const save = async () => {
    if (!selected) return;
    setSavingEdit(true);
    try {
      await fetchJson(`/books/${bookId}/truth/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText }),
      });
      setEditMode(false);
      refetchFile();
      toast("Saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save that file.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="head" style={{ marginBottom: 0 }}>
        <h2 className="h-page">
          {files.length === 0
            ? t("truth.title")
            : `${files.length} file${files.length === 1 ? "" : "s"}, listed by what wins`}
        </h2>
        <p>
          Every file here is on disk and nothing else is. When two files disagree, the higher
          tier decides, and the lower one is what gets edited.
        </p>
      </div>

      <section className="cols cols-b" style={{ alignItems: "start" }}>
        <div className="panel panel-flush">
          <div className="panel-head">
            <h3 className="h-panel grow">Files</h3>
          </div>
          <div className="panel-body" style={{ paddingTop: 2, paddingBottom: 10 }}>
            {files.length === 0 ? (
              <p className="hint">{t("truth.empty")}</p>
            ) : (
              <div className="rows">
                {files.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    className="row"
                    aria-current={selected === f.name}
                    onClick={() => {
                      setSelected(f.name);
                      setEditMode(false);
                    }}
                  >
                    <span className="grow">
                      <span className="name mono">{f.name}</span>
                      <span className="meta">
                        {f.size.toLocaleString()} {t("truth.chars")}
                      </span>
                    </span>
                    <span className={tierOf(f.name) === "direction" ? "pill pill-fill" : "pill"}>
                      {tierOf(f.name)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="panel panel-flush">
          <div className="panel-head">
            <h3 className="h-panel grow mono">{selected ?? "No file open"}</h3>
            {selected && presentation.canEdit && !editMode ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setEditText(fileData?.content ?? "");
                  setEditMode(true);
                }}
              >
                <Icon name="pencil" size={14} />
                Edit
              </button>
            ) : null}
            {editMode ? (
              <>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditMode(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-sm" disabled={savingEdit} onClick={() => void save()}>
                  <Icon name="check" size={14} />
                  {savingEdit ? t("truth.saving") : t("truth.save")}
                </button>
              </>
            ) : null}
          </div>
          <div className="panel-body">
            {presentation.legacy ? (
              <div data-testid="legacy-shim-warning" className="fail" style={{ marginBottom: 12 }}>
                <div>
                  <b>This file is a compatibility shim, and read-only.</b>
                  <p style={{ marginTop: 4 }}>
                    Edits belong in{" "}
                    <code className="mono">{SHIM_AUTHORITATIVE_PATH[selected ?? ""] ?? "outline/"}</code>
                    , which is what the runtime actually reads.
                  </p>
                </div>
              </div>
            ) : null}
            {presentation.readonlyReason === "runtime-diagnostic" ? (
              <div data-testid="runtime-diagnostic-warning" className="panel" style={{ marginBottom: 12 }}>
                <b>A runtime diagnostic, not a setting.</b>
                <p className="note" style={{ marginTop: 4, fontSize: 14 }}>
                  What the writer looked at for this chapter: the context it chose, what it
                  protected, what it was willing to compress, and the budget. Kept so a run can be
                  retraced; nothing here is editable.
                </p>
              </div>
            ) : null}

            {!selected ? (
              <Empty icon="file" title="Pick a file to see what it says.">
                The ones at the top of the list win arguments with the ones below them.
              </Empty>
            ) : fileData?.content == null ? (
              <p className="hint">{t("truth.notFound")}</p>
            ) : editMode ? (
              <textarea
                className="input mono"
                style={{ minHeight: 360, resize: "none" }}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
              />
            ) : (
              <pre
                className="mono scroll-y"
                style={{ whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.8, maxHeight: 520, margin: 0 }}
              >
                {fileData.content}
              </pre>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
