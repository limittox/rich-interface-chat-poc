"use client";

import { useMemo, useRef, useState } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WeatherToolUI } from "@/components/assistant-ui/weather-tool-ui";
import { GenerateVisualToolUI } from "@/components/assistant-ui/generate-visual-tool-ui";
import {
  VisualProviderToggle,
  type VisualProvider,
} from "@/components/visual-provider-toggle";
import {
  AssistantRuntimeProvider,
  useAui,
  AuiProvider,
  Suggestions,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";

function ThreadWithSuggestions() {
  const aui = useAui({
    suggestions: Suggestions([
      {
        title: "What's the weather",
        label: "in Tokyo right now?",
        prompt: "What's the weather in Tokyo?",
      },
      {
        title: "Tell me a fun fact",
        label: "about any topic",
        prompt: "Tell me a fun fact about space.",
      },
      {
        title: "Compare React vs Vue",
        label: "as a visual",
        prompt:
          "Compare React and Vue across a few dimensions, present it as a visual.",
      },
    ]),
  });
  return (
    <AuiProvider value={aui}>
      <Thread />
    </AuiProvider>
  );
}

export default function Home() {
  const [visualProvider, setVisualProvider] = useState<VisualProvider>("nim");

  // Latest-value ref so the memoized transport reads the current toggle value
  // on every request without being rebuilt.
  const providerRef = useRef<VisualProvider>(visualProvider);
  providerRef.current = visualProvider;

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        // Inject the current toggle value as a header on each request, without
        // touching assistant-ui's body assembly (messages/system/tools).
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("x-aui-visual-provider", providerRef.current);
          return globalThis.fetch(input, { ...init, headers });
        },
      }),
    [],
  );

  const runtime = useChatRuntime({ transport });

  return (
    <TooltipProvider delayDuration={0}>
      <AssistantRuntimeProvider runtime={runtime}>
        {/* Registers the standalone weather card for the get_current_weather tool */}
        <WeatherToolUI />
        {/* Registers the standalone generated visual for the generate_visual tool */}
        <GenerateVisualToolUI />
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-end border-b border-border px-4 py-2">
            <VisualProviderToggle
              value={visualProvider}
              onChange={setVisualProvider}
            />
          </header>
          <div className="min-h-0 flex-1">
            <ThreadWithSuggestions />
          </div>
        </div>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}
