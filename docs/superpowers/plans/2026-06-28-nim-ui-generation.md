# NIM Diffusion-Model UI Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move visual-artifact HTML generation off the OpenRouter chat model and onto an NVIDIA NIM diffusion model, which the OpenRouter model invokes via a server-side `generate_visual` tool.

**Architecture:** The OpenRouter model writes prose and, when a visual helps, calls `generate_visual({ description, title? })`. The tool's server-side `execute` calls NIM's OpenAI-compatible endpoint, repairs the returned HTML, and hands it back. A standalone tool-UI renders that HTML in the existing sandboxed, no-network iframe — exactly like the weather card.

**Tech Stack:** Next.js 16 (Turbopack), React 19, TypeScript, Vercel AI SDK v6 (`ai`), `@assistant-ui/react`, NVIDIA NIM (`google/diffusiongemma-26b-a4b-it`) via plain `fetch`, vitest (new, for unit tests).

## Global Constraints

- NIM key read from `process.env.NVIDIA_NIM_API_KEY` (server only); never written to a committed file, never sent to the client.
- NIM model from `process.env.NVIDIA_NIM_MODEL`, default `google/diffusiongemma-26b-a4b-it`.
- NIM base URL constant: `https://integrate.api.nvidia.com/v1`.
- NIM-generated HTML is UNTRUSTED — rendered only inside the existing `sandbox="allow-scripts"` + strict-CSP, no-network iframe (`components/assistant-ui/visual-artifact.tsx`, unchanged).
- The OpenRouter model must NOT write HTML; it only describes the visual. NIM is the only HTML source.
- `execute` never throws — every failure path returns `{ error: string }` so the chat turn continues.
- NIM request params: `max_tokens` 3000, `temperature` 0.2, ~25s timeout.

## File Structure

- Create: `lib/nim.ts` — NIM client: `repairVisualHtml` (pure) + `generateVisualHtml` (fetch). Server-only.
- Create: `lib/nim.test.ts` — vitest unit tests for `repairVisualHtml`.
- Create: `components/assistant-ui/generate-visual-tool-ui.tsx` — standalone tool-UI for `generate_visual`.
- Modify: `app/api/chat/route.ts` — add `generate_visual` tool; replace `VISUAL_SYSTEM_PROMPT`.
- Modify: `app/page.tsx` — mount `<GenerateVisualToolUI />`.
- Modify: `components/assistant-ui/markdown-text.tsx` — remove the inline ` ```visual ` registration.
- Modify: `components/assistant-ui/visual-artifact.tsx` — drop the now-unused `VisualArtifactHighlighter` export.
- Modify: `.env.example` — document `NVIDIA_NIM_API_KEY` / `NVIDIA_NIM_MODEL`.
- Modify: `README.md` — document the two-model flow.
- Modify: `package.json` — add `vitest` devDependency and `test` script.

---

### Task 1: NIM client module (`lib/nim.ts`) with repair unit tests

**Files:**
- Create: `lib/nim.ts`
- Create: `lib/nim.test.ts`
- Modify: `package.json` (add `vitest` devDependency + `test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export function repairVisualHtml(raw: string): string`
  - `export type VisualResult = { html: string } | { error: string }`
  - `export async function generateVisualHtml(input: { description: string; title?: string }): Promise<VisualResult>`

- [ ] **Step 1: Install vitest and add the test script**

Run:
```bash
npm install -D vitest
```

Then edit `package.json` `"scripts"` to add a `test` entry so the block reads:
```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Write the failing test for `repairVisualHtml`**

Create `lib/nim.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { repairVisualHtml } from "./nim";

describe("repairVisualHtml", () => {
  it("leaves clean HTML untouched", () => {
    expect(repairVisualHtml("<div>hi</div>")).toBe("<div>hi</div>");
  });

  it("trims surrounding whitespace", () => {
    expect(repairVisualHtml("   <div>hi</div> \n")).toBe("<div>hi</div>");
  });

  it("strips ```html code fences", () => {
    expect(repairVisualHtml("```html\n<div>hi</div>\n```")).toBe(
      "<div>hi</div>",
    );
  });

  it("strips bare ``` fences", () => {
    expect(repairVisualHtml("```\n<section>x</section>\n```")).toBe(
      "<section>x</section>",
    );
  });

  it("prepends a missing leading < on a bare root tag", () => {
    expect(repairVisualHtml('div style="x">hi</div>')).toBe(
      '<div style="x">hi</div>',
    );
  });

  it("drops leading prose before the first tag", () => {
    expect(repairVisualHtml("Here you go: <section>x</section>")).toBe(
      "<section>x</section>",
    );
  });

  it("returns empty string for empty input", () => {
    expect(repairVisualHtml("   ")).toBe("");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npm test
```
Expected: FAIL — `repairVisualHtml` is not exported / `lib/nim.ts` does not exist.

- [ ] **Step 4: Implement `lib/nim.ts`**

Create `lib/nim.ts`:
```ts
const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NIM_MODEL = "google/diffusiongemma-26b-a4b-it";
const NIM_TIMEOUT_MS = 25_000;
const NIM_MAX_TOKENS = 3000;

const NIM_SYSTEM_PROMPT = `You generate a single self-contained block of HTML and CSS to be rendered inline inside a chat message.

Strict rules:
- Output ONLY raw HTML. Start your output with a "<" character.
- No markdown, no code fences, no explanation, no commentary.
- Do not include <html>, <head>, or <body> tags; output only the content.
- Fully self-contained: inline CSS or a single <style> block. No external resources of any kind — no remote scripts, stylesheets, fonts, or images — and no network access (no fetch, XHR, WebSocket).
- Use data: URIs only if an image is essential.
- Make the layout responsive to its container width.
- If a chart is needed, draw it with inline SVG or a <canvas> plus an inline <script>. No chart libraries are available.`;

// Root tags we expect a visual to start with; used to detect a dropped leading "<".
const ROOT_TAG_START =
  /^(div|section|span|p|style|table|ul|ol|li|svg|canvas|article|main|header|footer|nav|figure|figcaption|button|h[1-6])\b/i;

export type VisualResult = { html: string } | { error: string };

/**
 * Repair common diffusion-output artifacts into clean inline HTML:
 * surrounding whitespace, wrapping ``` fences, leading prose, and a dropped
 * leading "<" on the root element. Pure and unit-testable.
 */
export function repairVisualHtml(raw: string): string {
  let html = raw.trim();
  if (html === "") return "";

  // Strip a wrapping ```html / ``` fence.
  html = html
    .replace(/^```(?:html)?[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?```[ \t]*$/i, "")
    .trim();

  if (html.startsWith("<")) return html;

  // Lost the leading "<" on a bare root tag (e.g. `div style="x">…`).
  if (ROOT_TAG_START.test(html)) return `<${html}`;

  // Leading prose before the markup (e.g. `Here you go: <section>…`).
  const firstAngle = html.indexOf("<");
  if (firstAngle > 0) return html.slice(firstAngle).trim();

  return html;
}

/**
 * Call the NVIDIA NIM diffusion model to generate inline visual HTML from a
 * natural-language description. Never throws — returns { error } on any failure
 * so the chat turn can continue with prose only.
 */
export async function generateVisualHtml(input: {
  description: string;
  title?: string;
}): Promise<VisualResult> {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) return { error: "NVIDIA_NIM_API_KEY is not set" };

  const model = process.env.NVIDIA_NIM_MODEL ?? DEFAULT_NIM_MODEL;
  const userPrompt = input.title
    ? `Title: ${input.title}\n\n${input.description}`
    : input.description;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NIM_TIMEOUT_MS);

  try {
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: NIM_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: NIM_MAX_TOKENS,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { error: `NIM request failed: ${res.status}` };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || raw.trim() === "") {
      return { error: "NIM returned empty output" };
    }

    const html = repairVisualHtml(raw);
    if (html === "") return { error: "NIM returned empty output" };
    return { html };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timed out"
        : "network error";
    return { error: `NIM request ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
npm test
```
Expected: PASS — all 7 `repairVisualHtml` cases green.

- [ ] **Step 6: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: (Manual, optional) live NIM smoke check**

Only if `NVIDIA_NIM_API_KEY` is exported in the shell. Confirms the real endpoint still returns `<`-leading HTML:
```bash
node --input-type=module -e '
import { generateVisualHtml } from "./lib/nim.ts";
const r = await generateVisualHtml({ description: "A small styled card that says Hello", title: "Smoke test" });
console.log(JSON.stringify(r).slice(0, 200));
'
```
Note: requires a TS-capable loader; if `node` cannot import `.ts` directly, skip — Task 4's headless E2E exercises the live path end-to-end. Do not block on this step.

- [ ] **Step 8: Commit**

```bash
git add lib/nim.ts lib/nim.test.ts package.json package-lock.json
git commit -m "Add NIM client with HTML repair and unit tests"
```

---

### Task 2: Wire the `generate_visual` tool into the chat route

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `generateVisualHtml` from `lib/nim.ts` (Task 1).
- Produces: a backend tool named `generate_visual` whose result is `VisualResult` (`{ html }` or `{ error }`), consumed by the tool-UI in Task 3.

- [ ] **Step 1: Import the NIM client**

In `app/api/chat/route.ts`, add after the existing imports (below the `import { z } from "zod";` line):
```ts
import { generateVisualHtml } from "@/lib/nim";
```

- [ ] **Step 2: Replace `VISUAL_SYSTEM_PROMPT`**

Replace the entire `VISUAL_SYSTEM_PROMPT` constant (currently lines 32–49, the prose + fenced `visual` example) with:
```ts
const VISUAL_SYSTEM_PROMPT = `When a response would materially benefit from a custom visual — a styled card, a side-by-side comparison, a simple diagram, a timeline, or a simple chart — call the \`generate_visual\` tool.

Pass a clear, detailed \`description\` of exactly what the visual should show: its content, structure, and every data value to display. A separate model turns your description into rendered HTML, so be specific — it sees only your description, not the conversation. Optionally pass a short \`title\`.

Do NOT write HTML yourself. Prefer normal prose and markdown for ordinary answers; only request a visual when custom layout adds real value. You may write prose before and after requesting a visual.`;
```

- [ ] **Step 3: Register the `generate_visual` tool**

In the `tools: { ... }` object passed to `streamText`, add this entry immediately after the `get_current_weather` tool (after its closing `}),`):
```ts
      generate_visual: tool({
        description:
          "Render a custom visual (styled card, comparison, diagram, timeline, or simple chart) from a natural-language description. A separate model generates the HTML/CSS; do not pass HTML.",
        inputSchema: zodSchema(
          z.object({
            description: z
              .string()
              .describe(
                "Detailed description of the visual's content, structure, and all data values to display.",
              ),
            title: z
              .string()
              .optional()
              .describe("Optional short title for the visual."),
          }),
        ),
        execute: async ({ description, title }) =>
          generateVisualHtml({ description, title }),
      }),
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (`generateVisualHtml` returns `VisualResult`, which `execute` may return directly.)

- [ ] **Step 5: Production build**

Run:
```bash
npm run build
```
Expected: build succeeds with no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "Delegate visual generation to NIM via generate_visual tool"
```

---

### Task 3: Render the tool result + remove the dead inline visual path

**Files:**
- Create: `components/assistant-ui/generate-visual-tool-ui.tsx`
- Modify: `app/page.tsx`
- Modify: `components/assistant-ui/markdown-text.tsx`
- Modify: `components/assistant-ui/visual-artifact.tsx`

**Interfaces:**
- Consumes: the `generate_visual` tool result `{ html?: string; error?: string }` (Task 2); `VisualArtifact` from `components/assistant-ui/visual-artifact.tsx`.
- Produces: `export const GenerateVisualToolUI` (a component to mount).

- [ ] **Step 1: Create the tool-UI component**

Create `components/assistant-ui/generate-visual-tool-ui.tsx`:
```tsx
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
```

- [ ] **Step 2: Mount the tool-UI in `app/page.tsx`**

Add the import alongside the existing `WeatherToolUI` import (after line 5):
```tsx
import { GenerateVisualToolUI } from "@/components/assistant-ui/generate-visual-tool-ui";
```

Then mount it next to `<WeatherToolUI />` inside `AssistantRuntimeProvider`. Replace:
```tsx
        {/* Registers the standalone weather card for the get_current_weather tool */}
        <WeatherToolUI />
```
with:
```tsx
        {/* Registers the standalone weather card for the get_current_weather tool */}
        <WeatherToolUI />
        {/* Registers the standalone NIM-generated visual for the generate_visual tool */}
        <GenerateVisualToolUI />
```

- [ ] **Step 3: Remove the inline `visual` registration from `markdown-text.tsx`**

In `components/assistant-ui/markdown-text.tsx`:

Delete the import (line 15):
```tsx
import { VisualArtifactHighlighter } from "@/components/assistant-ui/visual-artifact";
```

Delete the `VisualCodeHeader` declaration and the `componentsByLanguage` object (lines 19–26):
```tsx
const VisualCodeHeader: FC<CodeHeaderProps> = () => null;

const componentsByLanguage = {
  visual: {
    SyntaxHighlighter: VisualArtifactHighlighter,
    CodeHeader: VisualCodeHeader,
  },
};
```

Remove the `componentsByLanguage={componentsByLanguage}` prop from `MarkdownTextPrimitive` so the element reads:
```tsx
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
      defer
    />
```

Note: `CodeHeaderProps` and `FC` are still used elsewhere in the file (the real `CodeHeader` at the bottom), so leave those imports intact.

- [ ] **Step 4: Drop the unused `VisualArtifactHighlighter` export from `visual-artifact.tsx`**

In `components/assistant-ui/visual-artifact.tsx`, remove the now-unused export at the bottom:
```tsx
export function VisualArtifactHighlighter({ code }: SyntaxHighlighterProps) {
  return <VisualArtifact html={code} />;
}
```
and remove its now-unused type import near the top:
```tsx
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
```
Leave the `VisualArtifact` component and everything else unchanged.

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (No remaining references to `VisualArtifactHighlighter`, `VisualCodeHeader`, or `componentsByLanguage`.)

- [ ] **Step 6: Production build**

Run:
```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add components/assistant-ui/generate-visual-tool-ui.tsx app/page.tsx components/assistant-ui/markdown-text.tsx components/assistant-ui/visual-artifact.tsx
git commit -m "Render NIM visuals via standalone tool-UI; remove inline visual path"
```

---

### Task 4: Config docs + end-to-end headless verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `verify-nim-visual.mjs` (temporary; deleted after verification)

**Interfaces:**
- Consumes: the full running app (Tasks 1–3).
- Produces: documentation and a one-off verification artifact (not committed).

- [ ] **Step 1: Document env vars in `.env.example`**

Append to `.env.example`:
```bash

# NVIDIA NIM — generates the HTML/CSS for inline visuals (the generate_visual tool).
# Read server-side only; never commit a real key.
NVIDIA_NIM_API_KEY=
# NVIDIA_NIM_MODEL=google/diffusiongemma-26b-a4b-it
```

- [ ] **Step 2: Document the two-model flow in `README.md`**

Add a section to `README.md` (place it after the existing setup/usage content) describing the split:
```markdown
## Visual artifacts (two-model pipeline)

Ordinary answers come from the OpenRouter chat model. When a response benefits
from a custom visual, that model calls the `generate_visual` tool with a
natural-language description instead of writing HTML itself. The tool runs an
**NVIDIA NIM diffusion model** (`google/diffusiongemma-26b-a4b-it`) server-side
to generate the HTML/CSS, which is rendered in a sandboxed, no-network iframe.

Set `NVIDIA_NIM_API_KEY` (an `nvapi-` key from build.nvidia.com) in your
environment to enable visuals. Optionally override `NVIDIA_NIM_MODEL`. If the
key is absent, the app still answers in prose — visuals are skipped gracefully.
```

- [ ] **Step 3: Commit the docs**

```bash
git add .env.example README.md
git commit -m "Document NIM env vars and the two-model visual pipeline"
```

- [ ] **Step 4: Start the dev server (with both keys in env)**

Ensure `OPENROUTER_API_KEY` and `NVIDIA_NIM_API_KEY` are exported in the shell, then:
```bash
npm run dev
```
Wait for `✓ Ready` on `http://localhost:3000`.

- [ ] **Step 5: Write the headless verification script**

Create `verify-nim-visual.mjs`:
```js
import { chromium } from "playwright-core";

const EXECUTABLE =
  "/home/yathu/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";
const SHOT = process.env.SHOT || "/tmp/nim-visual-verify.png";

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

const composer = page.locator('textarea, [contenteditable="true"]').first();
await composer.click();
await composer.fill(
  "Compare React and Vue across 3 dimensions, present it as a visual.",
);
await page.keyboard.press("Enter");

let iframeFound = false;
try {
  await page.waitForSelector('iframe[data-slot="visual-artifact"]', {
    timeout: 90000,
  });
  iframeFound = true;
} catch {
  iframeFound = false;
}

let inner = null;
if (iframeFound) {
  await page.waitForTimeout(2500);
  const frameEl = await page.$('iframe[data-slot="visual-artifact"]');
  const box = await frameEl.boundingBox();
  const frame = await frameEl.contentFrame();
  const contentLen = frame ? (await frame.content()).length : 0;
  inner = { elementHeight: box?.height, contentLen };
}

await page.screenshot({ path: SHOT, fullPage: true });
await browser.close();

console.log(JSON.stringify({ iframeFound, inner }, null, 2));
```

- [ ] **Step 6: Run the verification**

Run:
```bash
SHOT=/tmp/nim-visual-verify.png node verify-nim-visual.mjs
```
Expected: `{ "iframeFound": true, "inner": { "elementHeight": <number > 100>, "contentLen": <number > 200> } }`. Then open `/tmp/nim-visual-verify.png` and confirm a rendered visual (not an error note) appears in the thread. This proves the OpenRouter model called `generate_visual`, NIM produced HTML, and it rendered in the sandboxed iframe.

- [ ] **Step 7: Clean up**

```bash
rm -f verify-nim-visual.mjs
# stop the dev server (Ctrl-C, or kill the background process)
```
Confirm `git status` shows no stray files (only the already-untracked `AGENTS.md`, if present).

---

## Self-Review

**Spec coverage:**
- OpenRouter writes prose + decides → Task 2 (system prompt + tool). ✓
- NIM generates HTML via OpenAI-compatible endpoint → Task 1 (`generateVisualHtml`). ✓
- Server-side tool handoff (`generate_visual`) → Task 2. ✓
- Standalone tool-UI renders in sandboxed iframe → Task 3. ✓
- Output repair (missing `<`, fences, prose) → Task 1 (`repairVisualHtml` + tests). ✓
- `max_tokens` 3000 / temp 0.2 / 25s timeout → Task 1 constants. ✓
- Config `NVIDIA_NIM_API_KEY` / `NVIDIA_NIM_MODEL`, graceful missing-key → Task 1 (`generateVisualHtml`) + Task 4 (`.env.example`). ✓
- Error handling returns `{ error }`, never throws → Task 1; tool-UI error state → Task 3. ✓
- Remove dead inline `visual` path → Task 3 (markdown-text + visual-artifact). ✓
- Testing: unit (repair) → Task 1; E2E headless → Task 4. ✓
- Security: untrusted HTML in unchanged sandbox; key server-only → Global Constraints + Task 1/3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only "optional" step (Task 1 Step 7) is an explicitly-skippable manual smoke check, not a placeholder — the live path is fully verified by Task 4.

**Type consistency:** `generateVisualHtml(input: { description; title? }) → VisualResult` (Task 1) is called identically in Task 2's `execute`. The tool result shape `{ html?; error? }` in Task 3's `GenerateVisualResult` is the structural read of `VisualResult` (`{ html } | { error }`) — compatible. `VisualArtifact` consumed with the `html: string` prop matches its existing signature. `repairVisualHtml`/`ROOT_TAG_START` names consistent across module and tests.
