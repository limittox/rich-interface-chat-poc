# Visual Comparison Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone `/compare` page that races the same prompt across DeepSeek (OpenRouter, autoregressive) and DiffusionGemma (NIM, diffusion), rendering each generated visual side by side with a live timer.

**Architecture:** `/compare` is a custom page (no assistant-ui runtime) with one prompt box and two panels. On submit it fires two concurrent POSTs to a new `/api/visual-compare` endpoint — one per provider — each returning `{ html | error, elapsedMs }`. Each panel shows a live wall-clock timer that freezes when its response arrives and renders the HTML in the existing sandboxed iframe.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vercel AI SDK v6 (`ai`), the existing `generateVisualHtml` (NIM) and `generateVisualWithModel` (OpenRouter) helpers, `VisualArtifact` sandboxed iframe, vitest.

## Global Constraints

- Both providers generate the **same task**: a self-contained HTML/CSS visual from the user's prompt sent verbatim as the description.
- Generated HTML is UNTRUSTED — rendered ONLY via the existing `VisualArtifact` component (sandboxed, no-network iframe). No other HTML injection.
- The NIM key and OpenRouter key stay server-side. The page calls only our own `/api/visual-compare`, never a provider directly.
- Fixed matchup, no model pickers: left = DeepSeek V4 Flash (OpenRouter), right = DiffusionGemma 26B (NIM). Model ids come from existing env (`OPENROUTER_MODEL`, `NVIDIA_NIM_MODEL`).
- The two requests fire concurrently from a single `t0` and resolve independently (the fast side renders while the slow side still counts up).
- `/api/visual-compare` never throws on generation failure — failures return `{ error, elapsedMs }`.
- No streaming the HTML; no comparison history. (v1 non-goals.)

## File Structure

- Create: `lib/model.ts` — `getModel()` (moved out of the chat route for reuse).
- Modify: `app/api/chat/route.ts` — import `getModel` from `lib/model`; drop the local copy and now-unused imports.
- Create: `lib/format-duration.ts` — `formatDuration(ms)` pure helper.
- Create: `lib/format-duration.test.ts` — unit tests.
- Create: `app/api/visual-compare/route.ts` — the race endpoint.
- Create: `components/comparison-panel.tsx` — one result panel (label, timer, visual/error).
- Create: `app/compare/page.tsx` — the split view (prompt box, timers, fetch orchestration).
- Modify: `app/page.tsx` — add a "Compare ↗" link in the header.

---

### Task 1: Extract `getModel()` into a shared module

**Files:**
- Create: `lib/model.ts`
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function getModel(): LanguageModel` in `lib/model.ts`.

- [ ] **Step 1: Create `lib/model.ts`**

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { type LanguageModel } from "ai";

// Prefer OpenRouter when its key is present; otherwise use Anthropic direct.
export function getModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    return openrouter(
      process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash",
    );
  }
  return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8");
}
```

- [ ] **Step 2: Update `app/api/chat/route.ts` imports**

Remove these two import lines near the top:
```ts
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
```
Remove `type LanguageModel,` from the `from "ai"` import block (leave the other named imports — `JSONSchema7`, `streamText`, `convertToModelMessages`, `UIMessage`, `tool`, `stepCountIs`, `zodSchema` — intact).

Add this import alongside the other `@/lib` imports:
```ts
import { getModel } from "@/lib/model";
```

- [ ] **Step 3: Remove the local `getModel` from `app/api/chat/route.ts`**

Delete the entire local function and its comment:
```ts
// Prefer OpenRouter when its key is present; otherwise use Anthropic direct.
function getModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    return openrouter(
      process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash",
    );
  }
  return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8");
}
```
The existing `const model = getModel();` call inside `POST` now resolves to the imported function — leave it unchanged.

- [ ] **Step 4: Typecheck and build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no type errors (no unused-import errors for `anthropic`/`createOpenRouter`/`LanguageModel`), build succeeds.

- [ ] **Step 5: Confirm existing unit tests still pass**

Run:
```bash
npm test
```
Expected: 9/9 passing (this task changes no tested logic).

- [ ] **Step 6: Commit**

```bash
git add lib/model.ts app/api/chat/route.ts
git commit -m "Extract getModel into shared lib/model for reuse"
```

---

### Task 2: `formatDuration` helper with unit tests

**Files:**
- Create: `lib/format-duration.ts`
- Create: `lib/format-duration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatDuration(ms: number): string`.

- [ ] **Step 1: Write the failing test**

Create `lib/format-duration.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("shows whole milliseconds under one second", () => {
    expect(formatDuration(920)).toBe("920ms");
  });

  it("rounds sub-millisecond fractions", () => {
    expect(formatDuration(919.6)).toBe("920ms");
  });

  it("shows seconds with one decimal at or above one second", () => {
    expect(formatDuration(1234)).toBe("1.2s");
  });

  it("formats larger durations in seconds", () => {
    expect(formatDuration(15000)).toBe("15.0s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("returns a dash for negative or non-finite input", () => {
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npm test -- format-duration
```
Expected: FAIL — `lib/format-duration.ts` does not exist / `formatDuration` not exported.

- [ ] **Step 3: Implement `lib/format-duration.ts`**

```ts
/**
 * Format a millisecond duration as a short human string:
 * under 1000ms → "920ms"; otherwise seconds with one decimal → "1.2s".
 * Returns "—" for negative or non-finite input.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm test -- format-duration
```
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/format-duration.ts lib/format-duration.test.ts
git commit -m "Add formatDuration helper with unit tests"
```

---

### Task 3: `/api/visual-compare` endpoint

**Files:**
- Create: `app/api/visual-compare/route.ts`

**Interfaces:**
- Consumes: `getModel` (`lib/model.ts`), `generateVisualHtml` (`lib/nim.ts`), `generateVisualWithModel` (`lib/visual.ts`).
- Produces: `POST /api/visual-compare` accepting `{ prompt: string, provider: "deepseek" | "nim" }`, returning JSON `{ html?: string; error?: string; elapsedMs: number }`.

- [ ] **Step 1: Create `app/api/visual-compare/route.ts`**

```ts
import { generateVisualHtml } from "@/lib/nim";
import { generateVisualWithModel } from "@/lib/visual";
import { getModel } from "@/lib/model";

// A single visual generation (DeepSeek autoregressive) can run well past the
// chat route's 30s; give the race endpoint more headroom.
export const maxDuration = 60;

type CompareRequest = { prompt?: string; provider?: string };

export async function POST(req: Request) {
  const { prompt, provider }: CompareRequest = await req.json();

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json({ error: "Missing prompt", elapsedMs: 0 }, {
      status: 400,
    });
  }

  const start = performance.now();
  const result =
    provider === "deepseek"
      ? await generateVisualWithModel({ description: prompt, model: getModel() })
      : await generateVisualHtml({ description: prompt });
  const elapsedMs = Math.round(performance.now() - start);

  return Response.json({ ...result, elapsedMs });
}
```

- [ ] **Step 2: Typecheck and build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no errors; the build output lists a new `ƒ /api/visual-compare` route.

- [ ] **Step 3: Commit**

```bash
git add app/api/visual-compare/route.ts
git commit -m "Add /api/visual-compare endpoint for the model race"
```

---

### Task 4: `ComparisonPanel` component

**Files:**
- Create: `components/comparison-panel.tsx`

**Interfaces:**
- Consumes: `VisualArtifact` (`components/assistant-ui/visual-artifact.tsx`), `formatDuration` (`lib/format-duration.ts`).
- Produces:
  - `export type PanelStatus = "idle" | "running" | "done" | "error"`
  - `export function ComparisonPanel(props: { title: string; subtitle: string; status: PanelStatus; wallMs: number; serverMs: number | null; html: string | null; error: string | null })`

- [ ] **Step 1: Create `components/comparison-panel.tsx`**

```tsx
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
```

- [ ] **Step 2: Typecheck and build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no errors (component compiles; not yet rendered anywhere).

- [ ] **Step 3: Commit**

```bash
git add components/comparison-panel.tsx
git commit -m "Add ComparisonPanel component"
```

---

### Task 5: `/compare` page + header link

**Files:**
- Create: `app/compare/page.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `ComparisonPanel`, `PanelStatus` (`components/comparison-panel.tsx`); the `/api/visual-compare` endpoint.
- Produces: the `/compare` route and a header link to it.

- [ ] **Step 1: Create `app/compare/page.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ComparisonPanel,
  type PanelStatus,
} from "@/components/comparison-panel";

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
        <Link
          href="/"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          ← Back to chat
        </Link>
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
```

- [ ] **Step 2: Add the header link in `app/page.tsx`**

Add the import near the other imports (after the `react` import line):
```tsx
import Link from "next/link";
```

Replace the existing header element:
```tsx
          <header className="flex items-center justify-end border-b border-border px-4 py-2">
            <VisualProviderToggle
              value={visualProvider}
              onChange={setVisualProvider}
            />
          </header>
```
with:
```tsx
          <header className="flex items-center justify-between border-b border-border px-4 py-2">
            <Link
              href="/compare"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Compare ↗
            </Link>
            <VisualProviderToggle
              value={visualProvider}
              onChange={setVisualProvider}
            />
          </header>
```

- [ ] **Step 3: Typecheck and build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no errors; build output lists the new static route `○ /compare`.

- [ ] **Step 4: Commit**

```bash
git add app/compare/page.tsx app/page.tsx
git commit -m "Add /compare split-view page and header link"
```

---

### Task 6: End-to-end headless verification

**Files:**
- Create: `verify-compare.mjs` (temporary; deleted after verification)

**Interfaces:**
- Consumes: the full running app (Tasks 1–5) and both provider keys.
- Produces: a one-off verification artifact (not committed).

- [ ] **Step 1: Start the dev server (both keys in env)**

Ensure `OPENROUTER_API_KEY` is exported and `NVIDIA_NIM_API_KEY` is available (it is in `.env.local`), then:
```bash
npm run dev
```
Wait for `✓ Ready` on `http://localhost:3000`.

- [ ] **Step 2: Write the verification script**

Create `verify-compare.mjs`:
```js
import { chromium } from "playwright-core";

const EXECUTABLE =
  "/home/yathu/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";
const SHOT = process.env.SHOT || "/tmp/compare-verify.png";

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });

await page.goto("http://localhost:3000/compare", { waitUntil: "networkidle" });

await page.locator('input').first().fill("Compare REST and GraphQL across 3 dimensions.");
await page.getByRole("button", { name: /compare/i }).click();

// Wait for BOTH panels to render a visual.
let rendered = 0;
try {
  await page.waitForFunction(
    () => document.querySelectorAll('iframe[data-slot="visual-artifact"]').length >= 2,
    { timeout: 120000 },
  );
  rendered = 2;
} catch {
  rendered = await page.$$eval(
    'iframe[data-slot="visual-artifact"]',
    (els) => els.length,
  );
}

await page.waitForTimeout(1500);

const panels = await page.$$eval('[data-slot="comparison-panel"]', (nodes) =>
  nodes.map((n) => ({
    title: n.querySelector("h2")?.textContent ?? "",
    wall: n.querySelector('[data-slot="panel-wall-time"]')?.textContent ?? "",
  })),
);

await page.screenshot({ path: SHOT, fullPage: true });
await browser.close();

console.log(JSON.stringify({ iframesRendered: rendered, panels }, null, 2));
```

- [ ] **Step 3: Run the verification**

Run (reinstall `playwright-core` first if it was pruned):
```bash
npm install --no-save playwright-core >/dev/null 2>&1
SHOT=/tmp/compare-verify.png node verify-compare.mjs
```
Expected: `iframesRendered: 2`, and two `panels` entries with non-empty `wall` times (e.g. DeepSeek "18.4s", DiffusionGemma "1.9s"). Open `/tmp/compare-verify.png` and confirm both panels rendered a visual side by side, each with its timer. The NIM (DiffusionGemma) panel's time should be visibly smaller — the core demonstration. Re-run once if a transient `Cannot connect to API` blip hits a side.

- [ ] **Step 4: Clean up**

```bash
rm -f verify-compare.mjs
# stop the dev server
```
Confirm `git status` shows no stray files (only the already-untracked `AGENTS.md`).

---

## Self-Review

**Spec coverage:**
- Standalone `/compare`, no assistant-ui runtime → Task 5. ✓
- Both sides generate a visual from the verbatim prompt → Task 3 (endpoint dispatch) + Task 5 (same prompt to both). ✓
- Left DeepSeek/OpenRouter, right DiffusionGemma/NIM → Task 5 panel props + Task 3 dispatch. ✓
- Concurrent fire, independent resolve, shared `t0` → Task 5 (`Promise.allSettled`, per-panel `setPanel`). ✓
- Live wall-clock timer + secondary server `elapsedMs` → Task 5 (tick) + Task 4 (display) + Task 3 (returns `elapsedMs`). ✓
- Render via sandboxed `VisualArtifact` → Task 4. ✓
- Endpoint never throws; `{ error, elapsedMs }` on failure → Task 3 (reuses `{ error }`-safe generators). ✓
- Error panel state → Task 4 + Task 5 (`status: "error"`). ✓
- Empty prompt disables submit → Task 5 (`disabled={!prompt.trim() || running}`). ✓
- Shared `getModel` reuse → Task 1. ✓
- Header link → Task 5 Step 2. ✓
- Unit test (formatter) → Task 2; E2E → Task 6. ✓
- Security: untrusted HTML in unchanged sandbox; keys server-side → Global Constraints + Tasks 3/4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `getModel(): LanguageModel` (Task 1) is called in Task 3 as `getModel()` passed to `generateVisualWithModel({ description, model })` (existing signature). `formatDuration(ms: number): string` (Task 2) is called in Task 4. `PanelStatus` and the `ComparisonPanel` prop shape (Task 4) match the props passed in Task 5. `generateVisualHtml({ description })` and `generateVisualWithModel({ description, model })` match their existing `lib/nim.ts` / `lib/visual.ts` signatures. Endpoint response `{ html?, error?, elapsedMs }` matches the client's parse in Task 5.
