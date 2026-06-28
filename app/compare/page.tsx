"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ComparisonPanel,
  type PanelStatus,
} from "@/components/comparison-panel";
import { ThemeToggle } from "@/components/theme-toggle";

type Provider = "deepseek" | "nim";

type PanelState = {
  status: PanelStatus;
  wallMs: number;
  serverMs: number | null;
  html: string | null;
  error: string | null;
};

const INITIAL: PanelState = {
  status: "idle",
  wallMs: 0,
  serverMs: null,
  html: null,
  error: null,
};

export default function ComparePage() {
  const [prompt, setPrompt] = useState("");
  const [left, setLeft] = useState<PanelState>(INITIAL); // deepseek
  const [right, setRight] = useState<PanelState>(INITIAL); // nim
  const tickRef = useRef<number | null>(null);

  // Clear the live-timer interval if the component unmounts mid-race.
  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const running = left.status === "running" || right.status === "running";

  async function runProvider(
    provider: Provider,
    p: string,
    t0: number,
    setPanel: React.Dispatch<React.SetStateAction<PanelState>>,
  ) {
    try {
      const res = await fetch("/api/visual-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p, provider }),
      });
      const wallMs = performance.now() - t0;
      const data = (await res.json()) as {
        html?: string;
        error?: string;
        elapsedMs?: number;
      };
      setPanel({
        status: data.html ? "done" : "error",
        wallMs,
        serverMs: typeof data.elapsedMs === "number" ? data.elapsedMs : null,
        html: data.html ?? null,
        error: data.error ?? (data.html ? null : "Generation failed."),
      });
    } catch {
      setPanel({
        status: "error",
        wallMs: performance.now() - t0,
        serverMs: null,
        html: null,
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
      runProvider("deepseek", p, t0, setLeft),
      runProvider("nim", p, t0, setRight),
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
          <Link
            href="/"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            ← Back to chat
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-4">
        <ComparisonPanel
          title="DeepSeek V4 Flash"
          subtitle="OpenRouter · autoregressive"
          status={left.status}
          wallMs={left.wallMs}
          serverMs={left.serverMs}
          html={left.html}
          error={left.error}
        />
        <ComparisonPanel
          title="DiffusionGemma 26B"
          subtitle="NVIDIA NIM · diffusion"
          status={right.status}
          wallMs={right.wallMs}
          serverMs={right.serverMs}
          html={right.html}
          error={right.error}
        />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-border p-4"
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a visual to generate on both models…"
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
