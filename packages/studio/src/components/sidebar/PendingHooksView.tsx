import { Empty } from "../ui/states";
import { cn } from "../../lib/utils";
import { tr } from "../../lib/app-language";
import { parsePendingHooks } from "../../lib/truth-display";

interface PendingHooksViewProps {
  readonly content: string;
}

const HOOK_TYPE_COLOR: Record<string, string> = {
  "主线伏笔": "bg-warning/15 text-warning text-warning",
  "角色前置": "bg-success/15 text-success text-success",
  "情感线伏笔": "bg-(--bad)/15 text-(--bad) ",
  "次要伏笔": "bg-(--putty-2) text-(--ink-2) ",
};

function hookTypeColor(type: string): string {
  return HOOK_TYPE_COLOR[type] ?? "bg-(--putty-2) text-(--ink-3) ";
}

// Renders pending_hooks.md (a 13-column tracking table) as browsable cards: the
// actual foreshadow text up front, with type / core / payoff as small tags.
// Bookkeeping columns (half-life, dependencies, …) are intentionally dropped.
export function PendingHooksView({ content }: PendingHooksViewProps) {
  const hooks = parsePendingHooks(content);
  if (hooks.length === 0) {
    return (
      <Empty compact icon="bulb" title={tr("埋下的伏笔会在这里跟踪。", "Foreshadowing is tracked here once a chapter plants it.")} />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {hooks.map((hook) => (
        <div key={hook.id} className="rounded-lg bg-secondary/30 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            {hook.promoted === false && (
              <span className="text-small px-1.5 py-0.5 rounded-full bg-(--putty-2) text-muted-foreground">
                {tr("种子", "Seed")}
              </span>
            )}
            {hook.promoted === true && (
              <span className="text-small px-1.5 py-0.5 rounded-full bg-success/15 text-success text-success">
                {tr("活跃", "Active")}
              </span>
            )}
            {hook.type && (
              <span className={cn("text-small px-1.5 py-0.5 rounded-full", hookTypeColor(hook.type))}>
                {hook.type}
              </span>
            )}
            {hook.core && (
              <span className="text-small px-1.5 py-0.5 rounded-full bg-warning/15 text-warning text-warning">
                {tr("核心", "Core")}
              </span>
            )}
            {hook.payoff && (
              <span className="text-small text-muted-foreground/50 ml-auto">{tr("回收", "Payoff")} · {hook.payoff}</span>
            )}
          </div>
          <p className="text-body text-foreground leading-7 font-serif">
            {hook.content}
          </p>
        </div>
      ))}
    </div>
  );
}
