# Design: Comparison mode — diffusion vs autoregressive visual-generation speed

**Date:** 2026-06-29
**Status:** Approved

## Summary

A standalone `/compare` page that sends one prompt to two models in parallel and
renders each model's generated visual side by side with a live timer, so the
speed advantage of the NVIDIA NIM diffusion model over an autoregressive model is
directly visible.

- **Left:** DeepSeek V4 Flash via OpenRouter (autoregressive).
- **Right:** DiffusionGemma 26B via NVIDIA NIM (diffusion).

Both sides perform the **same task** — generate a self-contained HTML/CSS visual
from the user's prompt — so the comparison is apples-to-apples.

## Motivation

The project's central question is whether a diffusion LLM generates UI markup
meaningfully faster than an autoregressive model. The existing NIM/DeepSeek toggle
proves each path works but makes you switch modes and compare from memory.
Comparison mode runs both at once on identical input and shows the elapsed time
for each, making the difference self-evident.

## Architecture & data flow

`/compare` is a standalone page. It does NOT use the assistant-ui thread/runtime —
there is no conversation, just a one-shot race. A single prompt box drives two
concurrent requests:

```
        prompt (one box)
            │  submit → t0 (single tick)
   ┌────────┴─────────┐   (fired concurrently, NOT Promise.all)
   ▼                  ▼
POST /api/visual-compare      POST /api/visual-compare
  { provider:"deepseek" }       { provider:"nim" }
   │                            │
generateVisualWithModel       generateVisualHtml
 (DeepSeek via OpenRouter)     (NIM diffusion)
   │  { html|error, elapsedMs } │  { html|error, elapsedMs }
   ▼                            ▼
 LEFT panel                   RIGHT panel
```

Each request resolves **independently** so the fast side (NIM) renders while the
slow side (DeepSeek) is still counting up. The user's prompt is sent verbatim as
the visual *description* to both sides (identical input). Each panel renders its
returned HTML in the existing sandboxed, no-network `VisualArtifact` iframe.

## Components & files

### New: `app/compare/page.tsx`
The split view. Owns: prompt input state, a single `t0` per submission, per-panel
status (`idle | running | done | error`), per-panel results, and a live tick
(`setInterval` ~80ms updating displayed elapsed while any panel is running).
On submit: set `t0 = performance.now()`, mark both panels running, fire both
fetches; on each resolve, record that panel's wall-clock elapsed and result.
Renders two `ComparisonPanel`s and a "← Back to chat" link.

### New: `components/comparison-panel.tsx`
One panel: model label + provider badge, the timer (live while running, frozen on
done/error), and the body — `VisualArtifact` on success or an error note. Pure
presentational; takes `{ title, subtitle, status, wallMs, serverMs, result }`.

### New: `app/api/visual-compare/route.ts`
`POST { prompt: string, provider: "deepseek" | "nim" }`. Measures the generation
call with `performance.now()` and returns plain JSON
`{ html?: string; error?: string; elapsedMs: number }`. Dispatches:
- `nim` → `generateVisualHtml({ description: prompt })`
- `deepseek` → `generateVisualWithModel({ description: prompt, model: getModel() })`
Never throws — generation failures surface as `{ error, elapsedMs }`. Reuses the
`VisualResult` contract from `lib/nim.ts`.

### New: `lib/model.ts`
Move `getModel()` out of `app/api/chat/route.ts` into a shared module so both the
chat route and the compare route use the identical provider-selection logic.
`app/api/chat/route.ts` is updated to import it (no behavior change).

### Modify: `app/page.tsx`
Add a "Compare ↗" link in the existing header bar (next to the visual-provider
toggle) pointing to `/compare`.

### Reuse (unchanged)
`components/assistant-ui/visual-artifact.tsx`, `generateVisualHtml` (NIM),
`generateVisualWithModel` (DeepSeek).

## Timing

- **Headline per panel:** wall-clock timer started at the shared `t0`, ticking
  ~every 80ms, frozen at total elapsed when that panel's response arrives. This is
  the visceral "which finished first" number and reflects real user-perceived
  latency (including the network round-trip).
- **Secondary per panel:** the server-measured model time (`elapsedMs`) shown
  small underneath, as the honest model-only number that excludes browser jitter.
- Both fetches share one `t0` fired in the same tick.

## Error handling

| Failure | Behaviour |
|---|---|
| A side returns `{ error }` | That panel freezes its timer, shows the error note; other side unaffected |
| A fetch rejects (network) | Same — caught client-side, panel shows a generic error + elapsed |
| Missing `NVIDIA_NIM_API_KEY` (nim side) | `generateVisualHtml` returns `{ error }`; panel shows it |
| Empty prompt | Submit is disabled until the prompt is non-empty |

## Testing

- **Unit:** any small elapsed-formatting helper (e.g. ms → "1.2s") gets a test.
- **Live E2E (headless, existing harness):** load `/compare`, submit a prompt,
  assert **both** panels eventually render `iframe[data-slot="visual-artifact"]`,
  read both displayed elapsed numbers, and screenshot. Expect the NIM panel's
  number to be the smaller of the two (with tolerance for variance).

## Non-goals (v1)

- No streaming the HTML token-by-token (the ticking timer carries the drama; both
  sides return complete HTML).
- No history of past comparisons.
- No model pickers — the matchup is fixed: DeepSeek (OpenRouter) vs DiffusionGemma
  (NIM). Model ids still come from existing env config (`OPENROUTER_MODEL`,
  `NVIDIA_NIM_MODEL`).
- No change to the chat page's behavior beyond adding the link.

## Security notes

- Both models' HTML output is UNTRUSTED and rendered only inside the existing
  sandboxed, no-network iframe — identical to the chat path.
- The NIM key stays server-side in `/api/visual-compare`; the page calls only our
  own endpoint, never a provider directly.
