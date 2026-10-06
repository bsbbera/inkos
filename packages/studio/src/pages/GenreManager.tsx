import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { toast, toastError } from "../components/ui/vermilion";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Plus, Pencil, Trash2 } from "../components/ui/glyphs";
import { PageHead } from "../components/ui/page-head";
import { Empty } from "../components/ui/states";
import { manuscriptBlocks } from "../lib/manuscript-md";

/* A genre's rules file, drawn the way the reader draws a manuscript. Lists
   stay lines: each "- " rule is its own block-level line. */
function Rules({ text }: { readonly text: string }) {
  if (!text.trim()) return <p className="dim">No rules written.</p>;
  return (
    <div className="read read-quiet">
      {manuscriptBlocks(text).map((b, i) => {
        const shown = b.runs.filter((r) => !r.hidden).map((r, j) => {
          const t = text.slice(r.from, r.to);
          return r.bold ? <b key={j}>{t}</b> : r.italic ? <em key={j}>{t}</em> : <span key={j}>{t}</span>;
        });
        if (b.kind === "rule") return <hr key={i} />;
        if (b.kind === "h") return <h3 key={i}>{shown}</h3>;
        return <p key={i} className="whitespace-pre-line">{shown}</p>;
      })}
    </div>
  );
}

interface GenreInfo {
  readonly id: string;
  readonly name: string;
  readonly source: "project" | "builtin";
  readonly language: "zh" | "en";
}

interface GenreDetail {
  readonly profile: {
    readonly name: string;
    readonly id: string;
    readonly language: string;
    readonly chapterTypes: ReadonlyArray<string>;
    readonly fatigueWords: ReadonlyArray<string>;
    readonly numericalSystem: boolean;
    readonly powerScaling: boolean;
    readonly eraResearch: boolean;
    readonly pacingRule: string;
    readonly auditDimensions: ReadonlyArray<number>;
  };
  readonly body: string;
}

interface GenreFormData {
  readonly id: string;
  readonly name: string;
  readonly language: "zh" | "en";
  readonly chapterTypes: string;
  readonly fatigueWords: string;
  readonly numericalSystem: boolean;
  readonly powerScaling: boolean;
  readonly eraResearch: boolean;
  readonly pacingRule: string;
  readonly body: string;
}

const EMPTY_FORM: GenreFormData = {
  id: "",
  name: "",
  language: "zh",
  chapterTypes: "",
  fatigueWords: "",
  numericalSystem: false,
  powerScaling: false,
  eraResearch: false,
  pacingRule: "",
  body: "",
};

function parseCommaSeparated(value: string): ReadonlyArray<string> {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function GenreForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  isEdit,
  c,
  t,
}: {
  readonly form: GenreFormData;
  readonly onChange: (next: GenreFormData) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly isEdit: boolean;
  readonly c: ReturnType<typeof useColors>;
  readonly t: TFunction;
}) {
  const set = <K extends keyof GenreFormData>(key: K, value: GenreFormData[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">ID</label>
          <input
            type="text"
            value={form.id}
            onChange={(e) => set("id", e.target.value)}
            disabled={isEdit}
            className="input mt-1 w-full"
          />
        </div>
        <div>
          <label className="label">{t("genre.name")}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="input mt-1 w-full"
          />
        </div>
      </div>

      <div>
        <label className="label">{t("create.language")}</label>
        <select
          value={form.language}
          onChange={(e) => set("language", e.target.value as "zh" | "en")}
          className="input mt-1 w-full"
        >
          <option value="zh">zh</option>
          <option value="en">en</option>
        </select>
      </div>

      <div>
        <label className="label">
          {t("genre.chapterTypes")} ({t("genre.commaSeparated")})
        </label>
        <input
          type="text"
          value={form.chapterTypes}
          onChange={(e) => set("chapterTypes", e.target.value)}
          className="input mt-1 w-full"
        />
      </div>

      <div>
        <label className="label">
          {t("genre.fatigueWords")} ({t("genre.commaSeparated")})
        </label>
        <input
          type="text"
          value={form.fatigueWords}
          onChange={(e) => set("fatigueWords", e.target.value)}
          className="input mt-1 w-full"
        />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.numericalSystem}
            onChange={(e) => set("numericalSystem", e.target.checked)}
          />
          {t("genre.numericalSystem")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.powerScaling}
            onChange={(e) => set("powerScaling", e.target.checked)}
          />
          {t("genre.powerScaling")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.eraResearch}
            onChange={(e) => set("eraResearch", e.target.checked)}
          />
          {t("genre.eraResearch")}
        </label>
      </div>

      <div>
        <label className="label">{t("genre.pacingRule")}</label>
        <input
          type="text"
          value={form.pacingRule}
          onChange={(e) => set("pacingRule", e.target.value)}
          className="input mt-1 w-full"
        />
      </div>

      <div>
        <label className="label">{t("genre.rulesMd")}</label>
        <textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          rows={6}
          className="input mt-1 w-full font-mono"
        />
      </div>

      <div className="flex gap-2">
        <button onClick={onSubmit} className="btn">
          {isEdit ? t("genre.saveChanges") : t("genre.createNew")}
        </button>
        <button onClick={onCancel} className="btn btn-line">
          {t("genre.cancel")}
        </button>
      </div>
    </div>
  );
}

interface Nav {
  toDashboard: () => void;
}

export function GenreManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data, refetch } = useApi<{ genres: ReadonlyArray<GenreInfo> }>("/genres");
  const [selected, setSelected] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"hidden" | "create" | "edit">("hidden");
  const [form, setForm] = useState<GenreFormData>(EMPTY_FORM);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Only show genres matching current language, plus custom project genres
  const filteredGenres = data?.genres.filter((g) => g.language === lang || g.source === "project") ?? [];
  // Open on the first genre rather than an empty pane that asks to be filled.
  const validSelected = (selected && filteredGenres.some((g) => g.id === selected) ? selected : null)
    ?? filteredGenres[0]?.id ?? null;
  const selectedGenre = filteredGenres.find((g) => g.id === validSelected) ?? null;

  const { data: detail } = useApi<GenreDetail>(validSelected ? `/genres/${validSelected}` : "");

  const handleCopy = async (id: string) => {
    await postApi(`/genres/${id}/copy`);
    toast("Copied into this project. Edit it there.");
    refetch();
  };

  const openCreateForm = () => {
    setForm(EMPTY_FORM);
    setFormMode("create");
  };

  const openEditForm = () => {
    if (!detail) return;
    setForm({
      id: detail.profile.id,
      name: detail.profile.name,
      language: detail.profile.language as "zh" | "en",
      chapterTypes: detail.profile.chapterTypes.join(", "),
      fatigueWords: detail.profile.fatigueWords.join(", "),
      numericalSystem: detail.profile.numericalSystem,
      powerScaling: detail.profile.powerScaling,
      eraResearch: detail.profile.eraResearch ?? false,
      pacingRule: detail.profile.pacingRule,
      body: detail.body,
    });
    setFormMode("edit");
  };

  const closeForm = () => {
    setFormMode("hidden");
  };

  const handleCreate = async () => {
    try {
      await postApi("/genres/create", {
        id: form.id,
        name: form.name,
        language: form.language,
        chapterTypes: parseCommaSeparated(form.chapterTypes),
        fatigueWords: parseCommaSeparated(form.fatigueWords),
        numericalSystem: form.numericalSystem,
        powerScaling: form.powerScaling,
        eraResearch: form.eraResearch,
        pacingRule: form.pacingRule,
        body: form.body,
      });
      setFormMode("hidden");
      setSelected(form.id);
      await refetch();
    } catch (e) {
      toastError(e, "Failed to create genre.");
    }
  };

  const handleEdit = async () => {
    if (!validSelected) return;
    try {
      await fetchJson(`/genres/${validSelected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            id: form.id,
            name: form.name,
            language: form.language,
            chapterTypes: parseCommaSeparated(form.chapterTypes),
            fatigueWords: parseCommaSeparated(form.fatigueWords),
            numericalSystem: form.numericalSystem,
            powerScaling: form.powerScaling,
            eraResearch: form.eraResearch,
            pacingRule: form.pacingRule,
          },
          body: form.body,
        }),
      });
      setFormMode("hidden");
      await refetch();
    } catch (e) {
      toastError(e, "Failed to update genre.");
    }
  };

  const handleDelete = async () => {
    if (!validSelected) return;
    setConfirmDeleteOpen(false);
    try {
      await fetchJson(`/genres/${validSelected}`, { method: "DELETE" });
      setSelected(null);
      await refetch();
    } catch (e) {
      toastError(e, "Failed to delete genre.");
    }
  };

  return (
    <div className="stack-lg">
      <PageHead
        title="Genres"
        lede="What a genre tells the writer: the kinds of chapter it is built from, the words it wears out, and the rules it keeps. A copy in this project can be edited; the ones that come with Quire stay as they are."
        actions={
          <button type="button" onClick={openCreateForm} className="btn btn-sm">
            <Plus size={15} />
            New genre
          </button>
        }
      />

      {formMode !== "hidden" && (
        <div className="panel fade-in">
          <h2 className="h-panel mb-4">
            {formMode === "create" ? "A new genre" : `Editing ${form.name || form.id}`}
          </h2>
          <GenreForm
            form={form}
            onChange={setForm}
            onSubmit={formMode === "create" ? handleCreate : handleEdit}
            onCancel={closeForm}
            isEdit={formMode === "edit"}
            c={c}
            t={t}
          />
        </div>
      )}

      <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
        <div className="panel panel-flush overflow-hidden">
          <div className="rows px-5 py-1.5 stagger">
            {filteredGenres.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelected(g.id)}
                className="row py-2.5"
                aria-current={validSelected === g.id ? "true" : undefined}
              >
                <span className="grow min-w-0">
                  <span className="name trunc">{g.name}</span>
                  <span className="meta">{g.source === "project" ? "In this project" : "Comes with Quire"}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          {validSelected && detail ? (
            <div key={validSelected} className="stack-lg fade-in">
              <div className="spread items-start gap-4">
                <h2 className="h-panel">{detail.profile.name}</h2>
                <div className="rowflex gap-2">
                  <button type="button" onClick={openEditForm} className="btn btn-line btn-sm">
                    <Pencil size={14} />
                    Edit
                  </button>
                  {selectedGenre?.source === "project" ? (
                    <button type="button" onClick={() => setConfirmDeleteOpen(true)} className="btn btn-bad btn-sm">
                      <Trash2 size={14} />
                      Delete
                    </button>
                  ) : (
                    <button type="button" onClick={() => validSelected && handleCopy(validSelected)} className="btn btn-line btn-sm">
                      Copy into this project
                    </button>
                  )}
                </div>
              </div>

              <section>
                <div className="label mb-2.5">Chapters it is built from</div>
                <div className="rowflex gap-2 flex-wrap">
                  {detail.profile.chapterTypes.map((ct) => <span key={ct} className="pill">{ct}</span>)}
                </div>
              </section>

              <section>
                <div className="label mb-2.5">Words it wears out</div>
                <div className="rowflex gap-2 flex-wrap">
                  {detail.profile.fatigueWords.slice(0, 15).map((w) => <span key={w} className="pill">{w}</span>)}
                  {detail.profile.fatigueWords.length > 15 ? (
                    <span className="dim text-cap">and {detail.profile.fatigueWords.length - 15} more</span>
                  ) : null}
                </div>
              </section>

              <section>
                <div className="label mb-2.5">Pace</div>
                <p className="text-body max-w-measure">{detail.profile.pacingRule || "No rule; the writer sets its own pace."}</p>
              </section>

              <section>
                <div className="label mb-2.5">The rules</div>
                {/* Read as a page, not as source: the same reader the
                    manuscript uses, so "## Genre Prohibitions" is a heading. */}
                <div className="well genre-rules">
                  <Rules text={detail.body || ""} />
                </div>
              </section>
            </div>
          ) : (
            <Empty icon="layers" title="Pick a genre to read it." />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("genre.deleteGenre")}
        message={`${t("genre.confirmDelete")} "${validSelected}"`}
        confirmLabel={t("common.delete") ?? "Delete"}
        cancelLabel={t("genre.cancel") ?? "Cancel"}
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
