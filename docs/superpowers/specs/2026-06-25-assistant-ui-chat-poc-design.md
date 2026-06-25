# assistant-ui Chat POC — Design Spec

**Date:** 2026-06-25
**Status:** Approved
**Author:** Yathu Arul (with Claude)

## Goal

A runnable Next.js chat application that uses the **real `@assistant-ui/react`**
package, talking to **real Claude** via a server-side streaming `/api/chat`
route, plus **one generative-UI demo**: a weather card rendered inline from a
tool call.

This is a focused POC — not a clone of the full assistant-ui monorepo. The
intent is to learn how to use the library to chat with LLMs and to render
custom React UI from tool calls.

## Non-goals

- Cloning the assistant-ui monorepo / its 15+ packages.
- Auth, persistence, multi-thread history, or deployment hardening.
- A real third-party weather API (mock data is sufficient for the demo).

## Scope

Core chat + a single tool/generative-UI demo (weather card).

## Scaffolding approach

Use the official assistant-ui CLI to scaffold, then swap the backend to Claude:

```
npx assistant-ui@latest create rich-interface-chat-poc
```

This generates the real shadcn-style components under `components/assistant-ui/`
(Thread, Composer, Message, ActionBar, ThreadList, etc.) — the actual library
UI, not hand-rolled primitives. We then replace the default OpenAI backend with
Anthropic.

## Stack

- **Next.js (App Router)** + **Tailwind** + **shadcn** (set up by the CLI).
- `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` (runtime adapter).
- `ai@^6` (Vercel AI SDK) + **`@ai-sdk/anthropic`** + **`@openrouter/ai-sdk-provider`** + `zod`.

### Provider choice — two backends, env-selected

The POC supports **two interchangeable LLM providers**, both wired through the
Vercel AI SDK (the idiomatic fit for assistant-ui's runtime + tool-UI plumbing):

1. **OpenRouter** via `@openrouter/ai-sdk-provider` — a gateway that routes to
   Claude (and many other models). Used when `OPENROUTER_API_KEY` is set. Model
   id is namespaced: `anthropic/claude-opus-4-8` (overridable via
   `OPENROUTER_MODEL`).
2. **Anthropic direct** via `@ai-sdk/anthropic` — Anthropic's official AI SDK
   provider. Used when only `ANTHROPIC_API_KEY` is set. Model id is the bare
   `claude-opus-4-8` (overridable via `ANTHROPIC_MODEL`).

**Selection is automatic:** the route prefers OpenRouter when its key is
present, otherwise falls back to the Anthropic provider. This lets the user run
the app with whichever key they have. The primary path for this project is
OpenRouter (the user has an OpenRouter key).

Tradeoff noted: the `claude-api` skill prefers the raw `@anthropic-ai/sdk` and
cautions against OpenAI-compatible shims. OpenRouter is an OpenAI-compatible
gateway, but it's the user's explicit choice and routes to real Claude via its
dedicated AI SDK provider (not a hand-rolled shim). If we later want raw-SDK
control (adaptive thinking config, etc.), we can introduce a custom runtime.

## Backend — `app/api/chat/route.ts`

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, convertToModelMessages, tool, zodSchema } from "ai";
import type { LanguageModel, UIMessage } from "ai";
import { z } from "zod";

export const maxDuration = 30;

// Prefer OpenRouter when its key is present; otherwise use Anthropic direct.
function getModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    return openrouter(process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-4-8");
  }
  return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8");
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model: getModel(),
    messages: await convertToModelMessages(messages), // async in AI SDK v6
    tools: {
      get_current_weather: tool({
        description: "Get the current weather for a city",
        inputSchema: zodSchema(
          z.object({
            location: z.string(),
            unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
          }),
        ),
        execute: async ({ location, unit }) => ({
          temperature: 22,
          description: "Sunny",
          humidity: 50,
          windSpeed: 12,
        }),
      }),
    },
  });
  return result.toUIMessageStreamResponse();
}
```

- `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`) lives in `.env.local`
  (gitignored), never hardcoded.
- The weather `execute` returns mock data to keep the POC self-contained (no
  third-party weather API/key). Easy to swap for a real call later.

## Frontend — `app/page.tsx`

The CLI-generated page wires `useChatRuntime()` + `AssistantRuntimeProvider` +
`<Thread />`. Kept as-is:

```tsx
"use client";
import { Thread } from "@/components/assistant-ui/thread";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";

export default function Home() {
  const runtime = useChatRuntime();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
```

## Generative UI — weather card

A typed tool-UI component renders the `get_current_weather` call inline in the
thread (spinner while running, error state, then a formatted card), instead of
raw tool JSON.

Current assistant-ui docs use the `ToolCallMessagePartComponent<Args, Result>`
typing for tool UIs:

```tsx
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

type WeatherArgs = { location: string; unit: "celsius" | "fahrenheit" };
type WeatherResult = {
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
};

export const WeatherToolUI: ToolCallMessagePartComponent<
  WeatherArgs,
  WeatherResult
> = ({ args, status, result }) => {
  if (status.type === "running") {
    return (
      <div className="flex items-center gap-2">
        <Spinner />
        <span>Checking weather in {args.location}...</span>
      </div>
    );
  }
  if (status.type === "incomplete" && status.reason === "error") {
    return (
      <div className="text-red-500">
        Failed to get weather for {args.location}
      </div>
    );
  }
  return (
    <div className="weather-card rounded-lg bg-blue-50 p-4">
      <h3 className="text-lg font-bold">{args.location}</h3>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xl">
            {result.temperature}°{args.unit === "celsius" ? "C" : "F"}
          </p>
          <p className="text-gray-600">{result.description}</p>
        </div>
        <div className="text-sm">
          <p>Humidity: {result.humidity}%</p>
          <p>Wind: {result.windSpeed} km/h</p>
        </div>
      </div>
    </div>
  );
};
```

Registration follows whatever the installed `@assistant-ui/react` version
exposes — either `makeAssistantToolUI` (older) or the `defineToolkit` /
tool-registration pattern (current). The exact registration call is resolved
against the installed package version during implementation, since the two APIs
differ. The component contract above (args/status/result) is stable.

## Verification

- App builds and runs (`npm run dev`).
- A plain chat message streams a Claude response token-by-token.
- Asking "what's the weather in <city>?" triggers the tool and renders the
  weather card (running → result states), not raw JSON.

## Open items resolved during implementation

- Exact tool-UI registration API for the pinned `@assistant-ui/react` version.
- Whether the CLI scaffolds AI SDK v6 by default or needs version pinning.
