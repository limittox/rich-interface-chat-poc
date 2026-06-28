"use client";

import { VisualArtifact } from "@/components/assistant-ui/visual-artifact";
import { formatDuration } from "@/lib/format-duration";

export type PanelStatus = "idle" | "running" | "done" | "error";

/**
 * One side of the comparison race: model label, the wall-clock timer (live while
 * running, frozen on done/error) with the server-measured model time underneath,
 * and the generated visual (rendered in the sandboxed iframe) or an error note.
 */
export function ComparisonPanel({
  title,
  subtitle,
  status,
  wallMs,
  serverMs,
  html,
  error,
}: {
  title: string;
  subtitle: string;
  status: PanelStatus;
  wallMs: number;
  serverMs: number | null;
  html: string | null;
  error: string | null;
}) {
  return (
    <div
      data-slot="comparison-panel"
      className="flex min-w-0 flex-1 flex-col rounded-xl border border-border"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="text-right">
          <div
            data-slot="panel-wall-time"
            className="text-lg font-bold tabular-nums"
          >
            {status === "idle" ? "—" : formatDuration(wallMs)}
          </div>
          {serverMs !== null && (
            <div className="text-[11px] tabular-nums text-muted-foreground">
              model {formatDuration(serverMs)}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {status === "idle" && (
          <p className="text-sm text-muted-foreground">Awaiting prompt…</p>
        )}
        {status === "running" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              aria-hidden
              className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent [animation-duration:0.6s]"
            />
            <span>Generating…</span>
          </div>
        )}
        {status === "error" && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error ?? "Generation failed."}
          </div>
        )}
        {status === "done" && html && <VisualArtifact html={html} />}
      </div>
    </div>
  );
}
