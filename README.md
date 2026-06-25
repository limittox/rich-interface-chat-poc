# rich-interface-chat-poc

A minimal chat app built on the real [`@assistant-ui/react`](https://www.assistant-ui.com)
library, streaming from **Claude** (`claude-opus-4-8`) through the Vercel AI SDK.
It includes a generative-UI demo: a weather card rendered from a
`get_current_weather` tool call instead of raw JSON.

Scaffolded from the official `assistant-ui` `with-ai-sdk-v6` example, then wired
to Claude.

## Providers

The `/api/chat` route selects its model at request time (`getModel()` in
`app/api/chat/route.ts`):

- **OpenRouter** (primary) — used when `OPENROUTER_API_KEY` is set. Routes to
  Claude via [`@openrouter/ai-sdk-provider`]; model `anthropic/claude-opus-4-8`.
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
   # OPENROUTER_MODEL=anthropic/claude-opus-4-8   # optional override

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

- **Plain chat** — type any message; the reply streams from Claude.
- **Generative UI** — click the built-in "What's the weather in Tokyo?"
  suggestion (or ask about any city). Claude calls the `get_current_weather`
  tool and the result renders as a standalone weather card (mock data), not raw
  JSON.

## How it works

- `app/api/chat/route.ts` — streaming endpoint using AI SDK `streamText` with the
  env-selected provider (`getModel()`). Exposes the `get_current_weather` tool,
  which returns a structured result `{ location, unit, temperature, description,
  humidity, windSpeed }` (mock data — swap `execute` for a real weather API).
- `components/assistant-ui/weather-tool-ui.tsx` — `WeatherToolUI`, the
  generative-UI renderer for that tool, registered with `display: "standalone"`
  so the card surfaces on its own (loading / error / result states).
- `app/page.tsx` — wires assistant-ui's `useChatRuntime` to `/api/chat` and
  mounts `WeatherToolUI`.

See `docs/superpowers/specs/2026-06-25-assistant-ui-chat-poc-design.md` for the
design and `docs/superpowers/plans/2026-06-25-assistant-ui-chat-poc.md` for the
implementation plan.

## Tech stack

Next.js (App Router) · Tailwind · shadcn · `@assistant-ui/react` +
`@assistant-ui/react-ai-sdk` · `ai@^6` · `@ai-sdk/anthropic` +
`@openrouter/ai-sdk-provider` · `zod` · TypeScript.

[`@openrouter/ai-sdk-provider`]: https://www.npmjs.com/package/@openrouter/ai-sdk-provider
