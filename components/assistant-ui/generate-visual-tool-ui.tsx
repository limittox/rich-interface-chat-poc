"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { VisualArtifact } from "@/components/assistant-ui/visual-artifact";

type GenerateVisualArgs = {
  description: string;
  title?: string;
};

type GenerateVisualResult = {
  html?: string;
  error?: string;
};

/**
 * Standalone generative-UI renderer for the backend `generate_visual` tool.
 *
 * The tool's result HTML is produced by the NIM diffusion model and is
 * UNTRUSTED; `VisualArtifact` renders it inside the sandboxed, no-network
 * iframe. Mounting this component (see app/page.tsx) registers the renderer.
 */
export const GenerateVisualToolUI = makeAssistantToolUI<
  GenerateVisualArgs,
  GenerateVisualResult
>({
  toolName: "generate_visual",
  display: "standalone",
  render: ({ result, status }) => {
    if (status.type === "incomplete") {
      return (
        <div
          data-slot="generate-visual-error"
          className="my-2 w-full max-w-sm rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Couldn&apos;t generate the visual.
        </div>
      );
    }

    if (status.type === "running" || !result) {
      return (
        <div
          data-slot="generate-visual-loading"
          className="my-2 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span
            aria-hidden
            className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent [animation-duration:0.6s]"
          />
          <span>Building visual…</span>
        </div>
      );
    }

    if (result.error || !result.html) {
      return (
        <div
          data-slot="generate-visual-error"
          className="my-2 w-full max-w-sm rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Couldn&apos;t generate the visual.
        </div>
      );
    }

    return <VisualArtifact html={result.html} />;
  },
});
