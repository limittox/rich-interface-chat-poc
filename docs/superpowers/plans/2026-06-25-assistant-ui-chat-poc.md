# assistant-ui Chat POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Next.js chat app using the real `@assistant-ui/react` package, streaming responses from Claude via an `/api/chat` route, with a weather-card generative-UI tool demo.

**Architecture:** Scaffold the official assistant-ui Next.js starter (real shadcn-style Thread components + AI SDK runtime), then swap its default backend to Anthropic's `@ai-sdk/anthropic` provider. The frontend talks to `/api/chat` via assistant-ui's `useChatRuntime`; the route uses Vercel AI SDK `streamText` with a `get_current_weather` tool. A typed tool-UI component renders that tool call as a weather card inline in the thread.

**Tech Stack:** Next.js (App Router), Tailwind, shadcn, `@assistant-ui/react`, `@assistant-ui/react-ai-sdk`, `ai@^6`, `@ai-sdk/anthropic`, `zod`, TypeScript.

## Global Constraints

- Use the **real** `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` packages — do not hand-roll chat primitives.
- LLM provider: **`@ai-sdk/anthropic`** (Anthropic's official AI SDK provider — not an OpenAI-compatible shim). Model id: **`claude-opus-4-8`**.
- Vercel AI SDK major version: **`ai@^6`** (note `convertToModelMessages` is async in v6).
- `ANTHROPIC_API_KEY` is read from `.env.local` only. Never hardcode it; `.env.local` must be gitignored.
- Weather tool returns **mock data** — no third-party weather API/key in this POC.
- This is integration/scaffolding code with no isolated business logic; verification is **running the app and observing behavior** with the expected output stated in each task.

---

### Task 1: Scaffold the assistant-ui Next.js starter into the repo

**Files:**
- Create: entire Next.js app at repo root (`package.json`, `app/`, `components/assistant-ui/`, `tailwind.config.*`, `tsconfig.json`, etc.)
- Preserve: existing `docs/` and `.git/` at repo root.

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working Next.js app with `app/page.tsx` (wires `useChatRuntime` + `AssistantRuntimeProvider` + `<Thread />`), `app/api/chat/route.ts` (default OpenAI backend, replaced in Task 2), and `components/assistant-ui/thread.tsx`.

- [ ] **Step 1: Scaffold into a temp directory**

The CLI creates a new project folder; scaffold outside the repo to avoid clobbering `docs/` and `.git/`, then move files in.

Run:
```bash
cd /tmp && rm -rf aui-scaffold && npx -y assistant-ui@latest create aui-scaffold
```
Expected: a `/tmp/aui-scaffold` directory containing `package.json`, `app/`, `components/assistant-ui/`, `next.config.*`, `tailwind`/`postcss` config, `tsconfig.json`. If the CLI prompts interactively and cannot proceed non-interactively, fall back to `npx -y create-next-app@latest aui-scaffold --ts --tailwind --app --no-src-dir --eslint` then `cd /tmp/aui-scaffold && npx -y assistant-ui@latest init` to add the assistant-ui components.

- [ ] **Step 2: Move scaffolded files into the repo root (keeping docs/ and .git/)**

Run:
```bash
cd /tmp/aui-scaffold && \
  cp -r ./. /home/yathu/code/rich-interface-chat-poc/ && \
  rm -rf /home/yathu/code/rich-interface-chat-poc/.git
```
Note: `cp -r ./.` copies dotfiles (`.gitignore`, `.eslintrc`, etc.) too. The `rm -rf .../.git` removes the scaffold's git dir so the repo's original `.git` (already at the destination) is the one that survives — verify the repo's `.git` is intact in the next step.

- [ ] **Step 3: Verify repo integrity and install deps**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  git status && ls app components/assistant-ui && npm install
```
Expected: `git status` shows the repo on `main` with the prior commit present (the design spec under `docs/`) plus many new untracked files; `app/` and `components/assistant-ui/` exist; `npm install` completes without errors.

- [ ] **Step 4: Confirm `.env.local` is gitignored**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && grep -n "env" .gitignore
```
Expected: a line matching `.env*.local` (Next.js default). If absent, append `\.env*.local` to `.gitignore`.

- [ ] **Step 5: Verify the app builds**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build
```
Expected: build completes (it may warn about a missing API key at runtime, but the build itself should succeed). If the build fails because the default route imports `@ai-sdk/openai`, that is fine — Task 2 replaces it; you may skip straight to Task 2 and build there.

- [ ] **Step 6: Commit the scaffold**

```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  git add -A && \
  git commit -m "Scaffold assistant-ui Next.js starter"
```

---

### Task 2: Swap the backend to Claude and add the weather tool

**Files:**
- Modify/Create: `app/api/chat/route.ts`
- Create: `.env.local` (gitignored)
- Modify: `package.json` (via `npm install @ai-sdk/anthropic`, remove `@ai-sdk/openai` if present)

**Interfaces:**
- Consumes: the assistant-ui frontend from Task 1 (posts `{ messages: UIMessage[] }` to `/api/chat`).
- Produces: a streaming `POST /api/chat` backed by `anthropic("claude-opus-4-8")` exposing a `get_current_weather` tool with input `{ location: string; unit: "celsius" | "fahrenheit" }` and result `{ temperature: number; description: string; humidity: number; windSpeed: number }`. These exact arg/result shapes are consumed by the Task 3 weather card.

- [ ] **Step 1: Install the Anthropic provider, ensure AI SDK v6**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  npm install @ai-sdk/anthropic ai@^6 zod && \
  npm uninstall @ai-sdk/openai 2>/dev/null; npm ls ai @ai-sdk/anthropic
```
Expected: `ai@6.x` and `@ai-sdk/anthropic` listed. (`npm uninstall` is best-effort; ignore if `@ai-sdk/openai` was not installed.)

- [ ] **Step 2: Write the Claude-backed route with the weather tool**

Replace the contents of `app/api/chat/route.ts` with:
```ts
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, tool, zodSchema } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: anthropic("claude-opus-4-8"),
    messages: await convertToModelMessages(messages),
    tools: {
      get_current_weather: tool({
        description: "Get the current weather for a city",
        inputSchema: zodSchema(
          z.object({
            location: z.string().describe("City name, e.g. 'London'"),
            unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
          }),
        ),
        execute: async ({ location, unit }) => ({
          location,
          unit,
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
Note: `execute` echoes `location` and `unit` into the result so the card can render them even if it only reads `result`.

- [ ] **Step 3: Add the API key locally**

Create `.env.local` (replace the placeholder with the real key — ask the user for it if not provided; do NOT commit this file):
```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY_PLACEHOLDER" > .env.local
```
If `$ANTHROPIC_API_KEY_PLACEHOLDER` is not set in the environment, write the file with a literal `ANTHROPIC_API_KEY=` line and tell the user to paste their key in. Confirm it is ignored:
```bash
git check-ignore .env.local
```
Expected: prints `.env.local` (meaning it is ignored).

- [ ] **Step 4: Verify the build passes**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build
```
Expected: build succeeds with no TypeScript errors in `route.ts`.

- [ ] **Step 5: Verify plain chat streams from Claude (manual runtime check)**

Run the dev server, then exercise the route directly:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run dev
```
In a second shell, post a message in AI SDK UIMessage format:
```bash
curl -N -s -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Say hello in 3 words"}]}]}' | head -c 400
```
Expected: a streamed `text/event-stream`-style body containing token chunks of Claude's reply (not an auth error). If you get a 401/`authentication` error, the API key in `.env.local` is missing/invalid. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  git add app/api/chat/route.ts package.json package-lock.json && \
  git commit -m "Swap chat backend to Claude with weather tool"
```
(`.env.local` is intentionally not staged.)

---

### Task 3: Render the weather tool call as a card

**Files:**
- Create: `components/assistant-ui/weather-tool-ui.tsx`
- Modify: `app/page.tsx` (register the tool UI inside the runtime provider)

**Interfaces:**
- Consumes: the `get_current_weather` tool from Task 2 — args `{ location: string; unit: "celsius" | "fahrenheit" }`, result `{ temperature: number; description: string; humidity: number; windSpeed: number }`.
- Produces: a registered tool UI so assistant-ui renders the weather card inline in the thread instead of raw tool JSON.

- [ ] **Step 1: Determine the installed tool-UI registration API**

assistant-ui has shipped two registration styles; pick the one the installed version exports.

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  node -e "const a=require('@assistant-ui/react'); console.log(['makeAssistantToolUI','defineToolkit','ToolCallMessagePartComponent'].map(k=>k+':'+(k in a)).join('\n'))" 2>/dev/null; \
  grep -roE "makeAssistantToolUI|defineToolkit|ToolCallMessagePartComponent" node_modules/@assistant-ui/react/dist 2>/dev/null | sort -u | head
```
Expected: identifies whether `makeAssistantToolUI` (factory style) or `defineToolkit`/`ToolCallMessagePartComponent` (component-typing style) is available. Use that result to choose the variant in Step 2.

- [ ] **Step 2: Write the weather card component**

Create `components/assistant-ui/weather-tool-ui.tsx`.

**Variant A — if `makeAssistantToolUI` is available:**
```tsx
"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";

type WeatherArgs = { location: string; unit: "celsius" | "fahrenheit" };
type WeatherResult = {
  location: string;
  unit: "celsius" | "fahrenheit";
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
};

export const WeatherToolUI = makeAssistantToolUI<WeatherArgs, WeatherResult>({
  toolName: "get_current_weather",
  render: ({ args, status, result }) => {
    if (status.type === "running" || !result) {
      return (
        <div className="my-2 flex items-center gap-2 text-sm text-gray-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <span>Checking weather in {args.location}…</span>
        </div>
      );
    }
    if (status.type === "incomplete" && status.reason === "error") {
      return (
        <div className="my-2 text-sm text-red-500">
          Failed to get weather for {args.location}
        </div>
      );
    }
    return (
      <div className="my-2 w-full max-w-sm rounded-lg bg-blue-50 p-4">
        <h3 className="text-lg font-bold">{result.location}</h3>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <p className="text-2xl">
              {result.temperature}°{result.unit === "celsius" ? "C" : "F"}
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
  },
});
```

**Variant B — if only `ToolCallMessagePartComponent` / `defineToolkit` is available:** export a `ToolCallMessagePartComponent<WeatherArgs, WeatherResult>` named `WeatherToolUI` with the identical render body above (same JSX, same states), and register it per the installed API (e.g. via the toolkit/`assistant.tools` registration the starter uses). Resolve the exact registration call from the package's type exports found in Step 1.

- [ ] **Step 3: Register the tool UI in the app**

Modify `app/page.tsx` to render the tool UI inside the runtime provider. For Variant A, `makeAssistantToolUI` returns a component that registers itself when mounted — add it inside `<AssistantRuntimeProvider>`:
```tsx
"use client";
import { Thread } from "@/components/assistant-ui/thread";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { WeatherToolUI } from "@/components/assistant-ui/weather-tool-ui";

export default function Home() {
  const runtime = useChatRuntime();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WeatherToolUI />
      <div className="h-dvh">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
```
(If the scaffold's `page.tsx` differs in layout/wrapper, preserve its wrapper markup and only add the `WeatherToolUI` import + element. For Variant B, register per that API instead of rendering `<WeatherToolUI />`.)

- [ ] **Step 4: Verify the build passes**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run build
```
Expected: build succeeds, no type errors referencing `WeatherToolUI` or the tool arg/result types.

- [ ] **Step 5: Verify the weather card renders (manual runtime check)**

Run:
```bash
cd /home/yathu/code/rich-interface-chat-poc && npm run dev
```
Open `http://localhost:3000`, send: **"What's the weather in London?"**
Expected: Claude calls the tool; the thread shows the "Checking weather in London…" spinner state, then the blue weather card with `London`, `22°C`, `Sunny`, `Humidity: 50%`, `Wind: 12 km/h` — **not** raw tool JSON. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  git add components/assistant-ui/weather-tool-ui.tsx app/page.tsx && \
  git commit -m "Render get_current_weather tool call as a weather card"
```

---

### Task 4: Document how to run the POC

**Files:**
- Create/Modify: `README.md`

**Interfaces:**
- Consumes: the finished app from Tasks 1–3.
- Produces: setup/run instructions for a new developer.

- [ ] **Step 1: Write the README**

Create/replace `README.md`:
```markdown
# rich-interface-chat-poc

A minimal chat app built on the real [`@assistant-ui/react`](https://www.assistant-ui.com)
library, streaming from Claude (`claude-opus-4-8`) via the Vercel AI SDK
`@ai-sdk/anthropic` provider. Includes a generative-UI demo: a weather card
rendered from a `get_current_weather` tool call.

## Setup

1. Install deps: `npm install`
2. Create `.env.local` with your Anthropic key:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Run the dev server: `npm run dev`
4. Open http://localhost:3000

## Try it

- Plain chat: type any message — the reply streams from Claude.
- Generative UI: ask **"What's the weather in London?"** — the assistant
  calls the `get_current_weather` tool and the result renders as a weather
  card (mock data) instead of raw JSON.

## How it works

- `app/api/chat/route.ts` — streaming endpoint using AI SDK `streamText` +
  `anthropic("claude-opus-4-8")`, exposing the `get_current_weather` tool.
- `app/page.tsx` — wires assistant-ui's `useChatRuntime` to `/api/chat`.
- `components/assistant-ui/weather-tool-ui.tsx` — renders the tool call as a card.

See `docs/superpowers/specs/2026-06-25-assistant-ui-chat-poc-design.md` for the design.
```

- [ ] **Step 2: Commit**

```bash
cd /home/yathu/code/rich-interface-chat-poc && \
  git add README.md && \
  git commit -m "Add README with setup and usage"
```

---

## Notes for the implementer

- **Manual verification is the test strategy here** by design (Global Constraints): this POC is scaffolding + integration glue + one presentational component, with no isolated logic worth a unit harness. Each task's runtime check has a concrete expected output — treat a mismatch as a failing test and debug before moving on (use superpowers:systematic-debugging).
- **The API key is required** for the runtime checks in Tasks 2 and 3. If it is not available, complete the build-only steps and flag the streaming/card checks as blocked pending the key — do not mark the task done on build success alone.
- If the assistant-ui CLI or package versions have moved and an exact symbol/name differs from this plan, prefer the installed package's actual exports (Task 3 Step 1 shows how to discover them) over the names written here.
