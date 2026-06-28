# rich-interface-chat-poc

A minimal chat app built on the real [`@assistant-ui/react`](https://www.assistant-ui.com)
library, streaming from **DeepSeek V4 Flash** (`deepseek/deepseek-v4-flash`) through OpenRouter and Vercel AI SDK.
It includes a generative-UI demo: a weather card rendered from a
`get_current_weather` tool call instead of raw JSON.

Scaffolded from the official `assistant-ui` `with-ai-sdk-v6` example, then wired
to an env-selected model.

## Providers

The `/api/chat` route selects its model at request time (`getModel()` in
`app/api/chat/route.ts`):

- **OpenRouter** (primary) — used when `OPENROUTER_API_KEY` is set. Routes via
  [`@openrouter/ai-sdk-provider`]; model `deepseek/deepseek-v4-flash`.
- **Anthropic direct** — used when only `ANTHROPIC_API_KEY` is set. Uses
  `@ai-sdk/anthropic`; model `claude-opus-4-8`.

OpenRouter takes precedence when its key is present.

## Setup

1. Install deps:

   ```bash
   npm install
   ```

2. Provide one provider key. Either export it in your shell, or create
   `.env.local` (gitignored — see `.env.example`):

   ```sh
   # Option A (primary): OpenRouter
   OPENROUTER_API_KEY=sk-or-...
   # OPENROUTER_MODEL=deepseek/deepseek-v4-flash   # optional override

   # Option B: Anthropic direct (leave OPENROUTER_API_KEY unset)
   # ANTHROPIC_API_KEY=sk-ant-...
   # ANTHROPIC_MODEL=claude-opus-4-8              # optional override
   ```

3. Run the dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Try it

- **Plain chat** — type any message; the reply streams from the configured model.
- **Generative UI** — click the built-in "What's the weather in Tokyo?"
  suggestion (or ask about any city). The model calls the `get_current_weather`
  tool and the result renders as a standalone weather card (mock data), not raw
  JSON.
- **Visual artifacts** — ask something visual ("compare React vs Vue as
  visual", "draw a bar chart as visual"). The model emits self-contained
  HTML/CSS/JS that renders inline in a **sandboxed, no-network iframe** with
  strict CSP. Charts are drawn with canvas or inline SVG.

## How it works

- `app/api/chat/route.ts` — streaming endpoint using AI SDK `streamText` with the
  env-selected provider (`getModel()`). Exposes the `get_current_weather` tool,
  which returns a structured result `{ location, unit, temperature, description,
  humidity, windSpeed }` (mock data — swap `execute` for a real weather API).
- `components/assistant-ui/weather-tool-ui.tsx` — `WeatherToolUI`, the
  generative-UI renderer for that tool, registered with `display: "standalone"`
  so the card surfaces on its own (loading / error / result states).
- `components/assistant-ui/visual-artifact.tsx` — `VisualArtifact`, the
  sandboxed iframe renderer. `markdown-text.tsx` maps the `visual` fenced block
  to it; the artifact system prompt lives in `app/api/chat/route.ts`. See
  `docs/superpowers/specs/2026-06-25-visual-artifacts-design.md`.
- `app/page.tsx` — wires assistant-ui's `useChatRuntime` to `/api/chat` and
  mounts `WeatherToolUI`.

See `docs/superpowers/specs/2026-06-25-assistant-ui-chat-poc-design.md` for the
design and `docs/superpowers/plans/2026-06-25-assistant-ui-chat-poc.md` for the
implementation plan.

## Visual artifacts (two-model pipeline)

Ordinary answers come from the OpenRouter chat model. When a response benefits
from a custom visual, that model calls the `generate_visual` tool with a
natural-language description instead of writing HTML itself. The tool runs an
**NVIDIA NIM diffusion model** (`google/diffusiongemma-26b-a4b-it`) server-side
to generate the HTML/CSS, which is rendered in a sandboxed, no-network iframe.

Set `NVIDIA_NIM_API_KEY` (an `nvapi-` key from build.nvidia.com) in your
environment to enable visuals. Optionally override `NVIDIA_NIM_MODEL`. If the
key is absent, the app still answers in prose — visuals are skipped gracefully.

## Tech stack

Next.js (App Router) · Tailwind · shadcn · `@assistant-ui/react` +
`@assistant-ui/react-ai-sdk` · `ai@^6` · `@ai-sdk/anthropic` +
`@openrouter/ai-sdk-provider` · `zod` · TypeScript.

[`@openrouter/ai-sdk-provider`]: https://www.npmjs.com/package/@openrouter/ai-sdk-provider
