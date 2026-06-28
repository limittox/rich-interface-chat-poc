"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ComparisonPanel,
  type PanelStatus,
} from "@/components/comparison-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { OutputModeToggle } from "@/components/output-mode-toggle";

type Provider = "deepseek" | "nim";

type PanelState = {
  status: PanelStatus;
  wallMs: number;
  serverMs: number | null;
  html: string | null;
  text: string | null;
  error: string | null;
};

const INITIAL: PanelState = {
  status: "idle",
  wallMs: 0,
  serverMs: null,
  html: null,
  text: null,
  error: null,
};

export default function ComparePage() {
  const [prompt, setPrompt] = useState("");
  const [left, setLeft] = useState<PanelState>(INITIAL); // deepseek
  const [right, setRight] = useState<PanelState>(INITIAL); // nim
  const [visualsEnabled, setVisualsEnabled] = useState(true);
  const tickRef = useRef<number | null>(null);

  // Clear the live-timer interval if the component unmounts mid-race.
  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const running = left.status === "running" || right.status === "running";

  function handleVisualsChange(next: boolean) {
    setVisualsEnabled(next);
    // Clear stale results so the panels match the newly selected mode.
    setLeft(INITIAL);
    setRight(INITIAL);
  }

  async function runProvider(
    provider: Provider,
    p: string,
    t0: number,
    visuals: boolean,
    setPanel: React.Dispatch<React.SetStateAction<PanelState>>,
  ) {
    try {
      const res = await fetch("/api/visual-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p, provider, visuals }),
      });
      const wallMs = performance.now() - t0;
      const data = (await res.json()) as {
        html?: string;
        text?: string;
        error?: string;
        elapsedMs?: number;
      };
      const ok = Boolean(data.html || data.text);
      setPanel({
        status: ok ? "done" : "error",
        wallMs,
        serverMs: typeof data.elapsedMs === "number" ? data.elapsedMs : null,
        html: data.html ?? null,
        text: data.text ?? null,
        error: data.error ?? (ok ? null : "Generation failed."),
      });
    } catch {
      setPanel({
        status: "error",
        wallMs: performance.now() - t0,
        serverMs: null,
        html: null,
        text: null,
        error: "Request failed.",
      });
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const p = prompt.trim();
    if (!p || running) return;

    const t0 = performance.now();
    setLeft({ ...INITIAL, status: "running" });
    setRight({ ...INITIAL, status: "running" });

    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      const now = performance.now();
      setLeft((s) => (s.status === "running" ? { ...s, wallMs: now - t0 } : s));
      setRight((s) =>
        s.status === "running" ? { ...s, wallMs: now - t0 } : s,
      );
    }, 80);

    void Promise.allSettled([
      runProvider("deepseek", p, t0, visualsEnabled, setLeft),
      runProvider("nim", p, t0, visualsEnabled, setRight),
    ]).finally(() => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">
          Diffusion vs Autoregressive — visual generation race
        </h1>
        <div className="flex items-center gap-3">
          <OutputModeToggle
            value={visualsEnabled}
            onChange={handleVisualsChange}
            disabled={running}
          />
          <Link
            href="/"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            ← Back to chat
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 p-4">
        <ComparisonPanel
          title="DeepSeek V4 Flash"
          subtitle="OpenRouter · autoregressive"
          status={left.status}
          wallMs={left.wallMs}
          serverMs={left.serverMs}
          html={left.html}
          text={left.text}
          error={left.error}
        />
        <ComparisonPanel
          title="DiffusionGemma 26B"
          subtitle="NVIDIA NIM · diffusion"
          status={right.status}
          wallMs={right.wallMs}
          serverMs={right.serverMs}
          html={right.html}
          text={right.text}
          error={right.error}
        />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-center gap-2 border-t border-border bg-background p-4"
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to send to both models…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!prompt.trim() || running}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {running ? "Racing…" : "Compare"}
        </button>
      </form>
    </div>
  );
}
