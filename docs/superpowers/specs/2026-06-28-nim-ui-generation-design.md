# Design: Delegate visual-artifact UI generation to an NVIDIA NIM diffusion model

**Date:** 2026-06-28
**Status:** Approved

## Summary

Split the work of answering a chat turn across two models:

- The **OpenRouter model** (autoregressive) writes the prose answer and *decides*
  when a visual would help. It no longer writes HTML itself.
- An **NVIDIA NIM diffusion model** (`google/diffusiongemma-26b-a4b-it`)
  generates the actual HTML/CSS for the visual.

The OpenRouter model hands NIM a natural-language *description* of the visual via
a server-side tool call; the tool runs NIM and returns the HTML, which is rendered
in the existing sandboxed, no-network iframe.

## Motivation

We want to test whether a **diffusion LLM** generates UI markup meaningfully faster
than an autoregressive model. Diffusion LLMs decode many tokens in parallel rather
than left-to-right, so emitting a bulk blob of HTML/CSS can be lower-latency. Keeping
the orchestration/prose on a capable autoregressive model and delegating only the
markup burst to the diffusion model isolates that speed question.

## Verified facts (pre-design probe)

Confirmed by direct `curl` against `https://integrate.api.nvidia.com/v1/chat/completions`
with the real key and model:

- NIM is **OpenAI-compatible** (`/v1/chat/completions`); the `model` field takes
  `google/diffusiongemma-26b-a4b-it`. HTTP 200.
- Latency is reasonable and scales roughly linearly: ~0.67s for 148 tokens; ~2.3s for
  900 tokens (~400 tok/s after a small base cost).
- With a system prompt instructing "output ONLY raw HTML starting with a `<`", the
  model reliably emits HTML beginning with `<`. A weaker prompt occasionally dropped
  the leading `<` of the root element — a diffusion artifact to repair defensively.
- A 900-token cap **truncated** a richer comparison card, so the call needs a generous
  `max_tokens` (~3000).

## Architecture & data flow

```
User → POST /api/chat  (OpenRouter model, autoregressive)
         │  writes prose; when a visual helps, calls the tool:
         │     generate_visual({ description, title? })
         ▼
   tool.execute (server)  ──HTTP──▶  NIM /v1/chat/completions
         │                           google/diffusiongemma-26b-a4b-it
         │  ◀── raw HTML/CSS ────────┘   (fast diffusion emit)
         │  repair + return { html, title }   (or { error })
         ▼
   tool result streams back to client
         ▼
   GenerateVisualToolUI (standalone tool-UI, mirrors the weather card)
         → <VisualArtifact html> → sandboxed no-network iframe
```

Only the *source* of the HTML changes (NIM instead of the OpenRouter model). The
rendering/security layer is unchanged: NIM output is untrusted and is rendered inside
the existing `sandbox="allow-scripts"` + strict-CSP, no-network iframe.

## Components

### `lib/nim.ts` (new)
Server-only module. Exports `generateVisualHtml({ description, title })`.

- Plain `fetch` to NIM's OpenAI-compatible endpoint — no new AI-SDK provider
  dependency. The tool is calling an HTTP API and returning a string; it does not
  need to be modeled as an AI-SDK `LanguageModel`.
- Owns the **NIM system prompt** for UI generation: produce one self-contained block
  of HTML + inline/`<style>` CSS, no external resources (no network, no CDNs), no
  markdown, no code fences, start the output with `<`. Mirrors the security
  constraints the iframe enforces (so the model aims inside the sandbox).
- Request params: `model` from `NVIDIA_NIM_MODEL`, `max_tokens` ~3000,
  `temperature` 0.2, ~25s timeout (AbortController).
- **Output repair** (pure, unit-testable): strip wrapping ``` / ```html fences;
  trim any leading prose before the first `<`; if the content looks like it lost a
  leading `<` (starts with a tag name such as `div`/`style`/`section`), prepend `<`.
- Returns `{ html: string }` on success, throws/propagates a typed error on failure
  for the tool to convert into `{ error }`.

### `app/api/chat/route.ts` (modified)
- Add the `generate_visual` tool: Zod input
  `{ description: string, title?: string }`, server-side `execute` calling
  `generateVisualHtml`. On failure (missing key, non-200, timeout, empty), `execute`
  returns `{ error: string }` rather than throwing, so the turn continues.
- Replace `VISUAL_SYSTEM_PROMPT`: instruct the model to **call `generate_visual`**
  with a clear description (and optional title) when a custom visual materially helps,
  and to keep using normal prose/markdown otherwise. Remove the old instruction to
  emit ` ```visual ` HTML inline.
- Keep the existing `get_current_weather` tool and OpenRouter/Anthropic model
  selection as-is.

### `components/assistant-ui/generate-visual-tool-ui.tsx` (new)
`makeAssistantToolUI({ toolName: "generate_visual", display: "standalone" })`,
mirroring `weather-tool-ui.tsx`:
- `status.type === "running"` → "Building visual…" spinner.
- result has `error` → unobtrusive "Couldn't generate the visual" note.
- result has `html` → `<VisualArtifact html={result.html} />`.

### `components/assistant-ui/visual-artifact.tsx` (unchanged)
Reused as-is, including the `MAX_HEIGHT = 2000` fix. It already renders arbitrary,
possibly-partial HTML safely.

### `app/page.tsx` (modified)
Mount `<GenerateVisualToolUI />` alongside `<WeatherToolUI />` inside the
`AssistantRuntimeProvider`. Keep the existing "Compare React vs Vue / as a visual"
suggestion — it now exercises the NIM path.

### Removed: inline ` ```visual ` markdown path
Since all visuals now come from NIM, remove the ` ```visual ` registration in
`markdown-text.tsx` (the `componentsByLanguage` entry and the
`VisualArtifactHighlighter` import). The `VisualArtifact` component stays — it is
reused directly by the tool-UI. One mechanism for visuals, no dead path. (The
`VisualArtifactHighlighter` export may be dropped or left unused; prefer dropping it.)

## Configuration & secrets

- `NVIDIA_NIM_API_KEY` — required for live NIM calls; read from server env only,
  never written to a committed file.
- `NVIDIA_NIM_MODEL` — optional, default `google/diffusiongemma-26b-a4b-it`.
- Base URL: `https://integrate.api.nvidia.com/v1` (constant).
- `.env.example` documents both (blank values).
- If `NVIDIA_NIM_API_KEY` is unset, `generate_visual` returns `{ error }` and the
  model proceeds with prose only — no crash.

## Error handling

| Failure | Behaviour |
|---|---|
| Missing `NVIDIA_NIM_API_KEY` | `execute` returns `{ error }`; prose continues |
| NIM non-200 / network / timeout (~25s) | `{ error }`; tool-UI shows fallback note |
| Empty / whitespace-only output | treated as error → `{ error }` |
| Malformed/partial HTML | **not** an error; repaired + rendered in the sandbox |

## Testing

1. **Unit (no network):** `lib/nim.ts` repair logic against sample strings —
   missing leading `<`, ```html fences, leading prose, already-clean HTML.
2. **Live integration:** a script calling `generateVisualHtml` against real NIM
   (developer's key) asserting `<`-leading non-empty HTML returns within a latency
   bound.
3. **E2E headless (Playwright, existing harness):** trigger the React-vs-Vue
   suggestion, assert a `generate_visual` tool call runs and the
   `iframe[data-slot="visual-artifact"]` renders NIM's HTML; capture a screenshot.

## Non-goals

- No token-by-token streaming of the NIM HTML into the iframe (diffusion emits a fast
  burst; a single render on completion is the right fit).
- No editing, persistence, or export of artifacts.
- No multiple NIM models or per-request model selection beyond the env default.
- No change to the iframe security model (sandbox + CSP + no network stays exactly
  as-is).

## Security notes

- NIM-generated HTML is **untrusted**, identical to how OpenRouter-generated HTML was
  treated. It renders only inside the sandboxed, no-network iframe.
- The NIM API key lives in server env and is used only server-side inside `execute`.
  It is never exposed to the client and never committed.
