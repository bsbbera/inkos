/*
 * The one way a screen names itself.
 *
 * Four patterns had grown up: a sentence with a lede, an eyebrow over a
 * title, an icon ring beside a Title Case name, and a centred column. Each
 * read as a different app. This is the sentence-with-lede one, because the
 * screens people use most already spoke that way; the actions sit on its
 * right, bottom-aligned with the title.
 */
import type { ReactNode } from "react";

export function PageHead({
  title,
  lede,
  actions,
}: {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="min-w-0">
        <h2 className="h-page">{title}</h2>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </header>
  );
}
