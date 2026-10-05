import { useEffect, useState } from "react";
import { fetchJson, invalidateApiPaths, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { tr } from "../lib/app-language";
import { FileInput, BookCopy, Feather, BookMarked, Upload, Wand2 } from "../components/ui/glyphs";
import { waitForStudioBookReady } from "../lib/book-ready";
import { Failed } from "../components/ui/states";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav { toDashboard: () => void; toBook: (bookId: string) => void }

type Tab = "chapters" | "canon" | "fanfic" | "spinoff" | "imitation";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function ImportManager({ nav, theme, t, initialTab }: { nav: Nav; theme: Theme; t: TFunction; initialTab?: Tab }) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [tab, setTab] = useState<Tab>(initialTab ?? "chapters");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Chapters state
  const [chText, setChText] = useState("");
  const [chBookId, setChBookId] = useState("");
  const [chSplitRegex, setChSplitRegex] = useState("");

  // Canon state
  const [canonTarget, setCanonTarget] = useState("");
  const [canonFrom, setCanonFrom] = useState("");
  const [canonSourceType, setCanonSourceType] = useState<"book" | "file">("book");
  const [canonFile, setCanonFile] = useState<File | null>(null);

  // Fanfic state
  const [ffTitle, setFfTitle] = useState("");
  const [ffText, setFfText] = useState("");
  const [ffMode, setFfMode] = useState("canon");
  const [ffGenre, setFfGenre] = useState("other");
  const [ffLang, setFfLang] = useState(lang);

  // Spinoff (番外) state
  const [spTitle, setSpTitle] = useState("");
  const [spParent, setSpParent] = useState("");
  const [spDirection, setSpDirection] = useState("");

  // Imitation (仿写) state
  const [imTitle, setImTitle] = useState("");
  const [imRef, setImRef] = useState("");
  const [imIdea, setImIdea] = useState("");
  const [imGenre, setImGenre] = useState("other");
  const [imLang, setImLang] = useState(lang);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
      setStatus("");
    }
  }, [initialTab]);

  const handleImportChapters = async () => {
    if (!chText.trim() || !chBookId) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ importedCount?: number }>(`/books/${chBookId}/import/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chText, splitRegex: chSplitRegex || undefined }),
      });
      setStatus(`Imported ${data.importedCount} chapters`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImportCanon = async () => {
    if (!canonTarget || (canonSourceType === "book" ? !canonFrom : !canonFile)) return;
    setLoading(true);
    setStatus("");
    try {
      if (canonSourceType === "book") {
        await postApi(`/books/${canonTarget}/import/canon`, { fromBookId: canonFrom });
      } else if (canonFile) {
        const uploaded = await fetchJson<{ storedPath: string }>("/import/canon/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: canonFile.name, dataUrl: await fileToDataUrl(canonFile) }),
        });
        await postApi(`/books/${canonTarget}/import/canon-file`, {
          filePath: uploaded.storedPath,
          filename: canonFile.name,
        });
      }
      setStatus(tr("母本导入成功", "Canon imported successfully"));
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleFanficInit = async () => {
    if (!ffTitle.trim() || !ffText.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ bookId?: string }>("/fanfic/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ffTitle, sourceText: ffText, mode: ffMode,
          genre: ffGenre, language: ffLang,
        }),
      });
      if (data.bookId) {
        setStatus(`${t("import.creating")}: ${data.bookId}`);
        await waitForStudioBookReady(data.bookId);
        setStatus(`${t("import.fanficDone")}: ${data.bookId}`);
        invalidateApiPaths(["/api/v1/books", `/api/v1/books/${data.bookId}`]);
        nav.toBook(data.bookId);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleSpinoffInit = async () => {
    if (!spTitle.trim() || !spParent) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await postApi<{ bookId?: string }>("/spinoff/init", { title: spTitle, parentBookId: spParent, direction: spDirection || undefined });
      if (data.bookId) {
        setStatus(`${t("import.creating")}: ${data.bookId}`);
        await waitForStudioBookReady(data.bookId);
        setStatus(`${t("import.spinoffDone")}: ${data.bookId}`);
        invalidateApiPaths(["/api/v1/books", `/api/v1/books/${data.bookId}`]);
        nav.toBook(data.bookId);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImitationInit = async () => {
    if (!imTitle.trim() || !imRef.trim() || !imIdea.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await postApi<{ bookId?: string }>("/imitation/init", { title: imTitle, referenceText: imRef, storyIdea: imIdea, genre: imGenre, language: imLang });
      if (data.bookId) {
        setStatus(`${t("import.creating")}: ${data.bookId}`);
        await waitForStudioBookReady(data.bookId);
        setStatus(`${t("import.imitationDone")}: ${data.bookId}`);
        invalidateApiPaths(["/api/v1/books", `/api/v1/books/${data.bookId}`]);
        nav.toBook(data.bookId);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chapters", label: t("import.chapters"), icon: <FileInput size={14} /> },
    { id: "canon", label: t("import.canon"), icon: <BookCopy size={14} /> },
    { id: "fanfic", label: t("import.fanfic"), icon: <Feather size={14} /> },
    { id: "spinoff", label: t("import.spinoff"), icon: <BookMarked size={14} /> },
    { id: "imitation", label: t("import.imitation"), icon: <Wand2 size={14} /> },
  ];

  return (
    <div className="space-y-8">
      <h1 className="h-page flex items-center gap-3">
        <span className="icon-ring icon-ring-lg" aria-hidden="true"><FileInput size={19} /></span>
        {t("import.title")}
      </h1>

      {/* Tabs */}
      <div className="tabs" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => { setTab(tb.id); setStatus(""); }}
            className="tab"
          >
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="panel space-y-4">
        {tab === "chapters" && (
          <>
            <select value={chBookId} onChange={(e) => setChBookId(e.target.value)}
              className="input w-full">
              <option value="">{t("import.selectTarget")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <input
              type="text" value={chSplitRegex} onChange={(e) => setChSplitRegex(e.target.value)}
              placeholder={t("import.splitRegex")}
              className="input w-full font-mono"
            />
            <textarea value={chText} onChange={(e) => setChText(e.target.value)} rows={10}
              placeholder={t("import.pasteChapters")}
              className="input w-full resize-none font-mono"
            />
            <button onClick={handleImportChapters} disabled={loading || !chBookId || !chText.trim()}
              className="btn">
              {loading ? t("import.importing") : t("import.chapters")}
            </button>
          </>
        )}

        {tab === "canon" && (
          <>
            <p className="text-sm text-muted-foreground">
              {tr("母本可以来自已有 Quire 书籍，也可以直接上传外部 TXT、Markdown 或 PDF 小说。", "Use an existing Quire book or upload an external TXT, Markdown, or PDF novel as canon.")}
            </p>
            <div className="seg">
              {(["book", "file"] as const).map((sourceType) => (
                <button
                  key={sourceType}
                  type="button"
                  aria-pressed={canonSourceType === sourceType}
                  onClick={() => setCanonSourceType(sourceType)}
                >
                  {sourceType === "book" ? tr("已有书籍", "Existing book") : tr("上传外部母本", "Upload external canon")}
                </button>
              ))}
            </div>
            {canonSourceType === "book" ? (
              <select value={canonFrom} onChange={(e) => setCanonFrom(e.target.value)}
                className="input w-full">
                <option value="">{t("import.selectSource")}</option>
                {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
            ) : (
              <label className="well flex cursor-pointer items-center gap-3 border-dashed">
                <Upload size={18} className="text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  {canonFile?.name ?? tr("选择 TXT、Markdown 或 PDF 文件", "Choose a TXT, Markdown, or PDF file")}
                </span>
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
                  className="sr-only"
                  onChange={(event) => setCanonFile(event.target.files?.[0] ?? null)}
                />
              </label>
            )}
            <select value={canonTarget} onChange={(e) => setCanonTarget(e.target.value)}
              className="input w-full">
              <option value="">{t("import.selectDerivative")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <button onClick={handleImportCanon} disabled={loading || !canonTarget || (canonSourceType === "book" ? !canonFrom : !canonFile)}
              className="btn">
              {loading ? t("import.importing") : t("import.canon")}
            </button>
          </>
        )}

        {tab === "fanfic" && (
          <>
            <input type="text" value={ffTitle} onChange={(e) => setFfTitle(e.target.value)}
              placeholder={t("import.fanficTitle")}
              className="input w-full"
            />
            <div className="grid grid-cols-3 gap-3">
              <select value={ffMode} onChange={(e) => setFfMode(e.target.value)}
                className="input">
                <option value="canon">{tr("原著向", "Canon-compliant")}</option>
                <option value="au">{tr("架空 AU", "Alternate Universe (AU)")}</option>
                <option value="ooc">{tr("性格偏离 OOC", "Out of Character (OOC)")}</option>
                <option value="cp">{tr("配对 CP", "Pairing (CP)")}</option>
              </select>
              <select value={ffGenre} onChange={(e) => setFfGenre(e.target.value)}
                className="input">
                <option value="other">{tr("其他", "Other")}</option>
                <option value="xuanhuan">{tr("玄幻", "Xuanhuan Fantasy")}</option>
                <option value="urban">{tr("都市", "Urban")}</option>
                <option value="xianxia">{tr("仙侠", "Xianxia")}</option>
              </select>
              <select value={ffLang} onChange={(e) => setFfLang(e.target.value as "zh" | "en")}
                className="input">
                <option value="zh">{tr("中文", "Chinese")}</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea value={ffText} onChange={(e) => setFfText(e.target.value)} rows={10}
              placeholder={t("import.pasteMaterial")}
              className="input w-full resize-none font-mono"
            />
            <button onClick={handleFanficInit} disabled={loading || !ffTitle.trim() || !ffText.trim()}
              className="btn">
              {loading ? t("import.creating") : t("import.fanfic")}
            </button>
          </>
        )}

        {tab === "spinoff" && (
          <>
            <p className="text-xs text-muted-foreground">{t("import.spinoffHint")}</p>
            <input type="text" value={spTitle} onChange={(e) => setSpTitle(e.target.value)}
              placeholder={t("import.spinoffTitle")}
              className="input w-full"
            />
            <select value={spParent} onChange={(e) => setSpParent(e.target.value)}
              className="input w-full">
              <option value="">{t("import.selectParent")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <textarea value={spDirection} onChange={(e) => setSpDirection(e.target.value)} rows={5}
              placeholder={t("import.spinoffDirection")}
              className="input w-full resize-none"
            />
            <button onClick={handleSpinoffInit} disabled={loading || !spTitle.trim() || !spParent}
              className="btn">
              {loading ? t("import.creating") : t("import.spinoff")}
            </button>
          </>
        )}

        {tab === "imitation" && (
          <>
            <p className="text-xs text-muted-foreground">{t("import.imitationHint")}</p>
            <input type="text" value={imTitle} onChange={(e) => setImTitle(e.target.value)}
              placeholder={t("import.imitationTitle")}
              className="input w-full"
            />
            <div className="grid grid-cols-2 gap-3">
              <select value={imGenre} onChange={(e) => setImGenre(e.target.value)}
                className="input">
                <option value="other">{tr("其他", "Other")}</option>
                <option value="xuanhuan">{tr("玄幻", "Xuanhuan Fantasy")}</option>
                <option value="urban">{tr("都市", "Urban")}</option>
                <option value="xianxia">{tr("仙侠", "Xianxia")}</option>
              </select>
              <select value={imLang} onChange={(e) => setImLang(e.target.value as "zh" | "en")}
                className="input">
                <option value="zh">{tr("中文", "Chinese")}</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea value={imIdea} onChange={(e) => setImIdea(e.target.value)} rows={4}
              placeholder={t("import.imitationIdea")}
              className="input w-full resize-none"
            />
            <textarea value={imRef} onChange={(e) => setImRef(e.target.value)} rows={8}
              placeholder={t("import.imitationRef")}
              className="input w-full resize-none font-mono"
            />
            <button onClick={handleImitationInit} disabled={loading || !imTitle.trim() || !imRef.trim() || !imIdea.trim()}
              className="btn">
              {loading ? t("import.creating") : t("import.imitation")}
            </button>
          </>
        )}

        {status && (
          status.startsWith("Error")
            ? <Failed what="The import stopped." detail={status.replace(/^Error:?\s*/, "")} />
            : <div className="pass block">{status}</div>
        )}
      </div>
    </div>
  );
}
