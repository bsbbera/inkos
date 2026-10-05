import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { toast, toastError } from "../components/ui/vermilion";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Plus, Pencil, Trash2 } from "../components/ui/glyphs";

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
  const validSelected = selected && filteredGenres.some((g) => g.id === selected) ? selected : null;
  const selectedGenre = filteredGenres.find((g) => g.id === validSelected) ?? null;

  const { data: detail } = useApi<GenreDetail>(validSelected ? `/genres/${validSelected}` : "");

  const handleCopy = async (id: string) => {
    await postApi(`/genres/${id}/copy`);
    toast(`Copied ${id} to project genres/`);
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="h-page">{t("create.genre")}</h1>
        <button
          onClick={openCreateForm}
          className="btn btn-sm flex items-center gap-1.5"
        >
          <Plus size={16} />
          {t("genre.createNew")}
        </button>
      </div>

      {formMode !== "hidden" && (
        <div className="panel">
          <h2 className="h-panel mb-4">
            {formMode === "create" ? t("genre.createNew") : `${t("common.edit")}: ${form.id}`}
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

      <div className="grid grid-cols-[250px_1fr] gap-6">
        {/* Genre list */}
        <div className="panel panel-flush overflow-hidden">
          {filteredGenres.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelected(g.id)}
              className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors ${
                validSelected === g.id ? "bg-primary/10 text-primary" : "hover:bg-muted/30"
              }`}
            >
              <div className="text-sm font-medium">{g.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {g.id} · {g.language} · {g.source}
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        <div className="panel min-h-100">
          {validSelected && detail ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="h-panel">{detail.profile.name}</h2>
                  <div className="text-sm text-muted-foreground mt-1">
                    {detail.profile.id} · {detail.profile.language} ·
                    {detail.profile.numericalSystem ? " Numerical" : ""}
                    {detail.profile.powerScaling ? " Power" : ""}
                    {detail.profile.eraResearch ? " Era" : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={openEditForm}
                    className="btn btn-line btn-sm flex items-center gap-1.5"
                  >
                    <Pencil size={14} />
                    {t("common.edit")}
                  </button>
                  {selectedGenre?.source === "project" && (
                    <button
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="btn btn-bad btn-sm flex items-center gap-1.5"
                    >
                      <Trash2 size={14} />
                      {t("common.delete")}
                    </button>
                  )}
                  <button
                    onClick={() => validSelected && handleCopy(validSelected)}
                    className="btn btn-line btn-sm"
                  >
                    {t("genre.copyToProject")}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("genre.chapterTypes")}</div>
                <div className="flex gap-2 flex-wrap">
                  {detail.profile.chapterTypes.map((ct) => (
                    <span key={ct} className="pill">{ct}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("genre.fatigueWords")}</div>
                <div className="flex gap-2 flex-wrap">
                  {detail.profile.fatigueWords.slice(0, 15).map((w) => (
                    <span key={w} className="pill">{w}</span>
                  ))}
                  {detail.profile.fatigueWords.length > 15 && (
                    <span className="text-xs text-muted-foreground">+{detail.profile.fatigueWords.length - 15}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("genre.pacingRule")}</div>
                <div className="text-sm">{detail.profile.pacingRule || "—"}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t("genre.rules")}</div>
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-foreground/80 bg-muted/30 p-4 rounded-md max-h-75 overflow-y-auto">
                  {detail.body || "—"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic flex items-center justify-center h-full">
              {t("genre.selectHint")}
            </div>
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
