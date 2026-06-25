"use client";

import { Thread } from "@/components/assistant-ui/thread";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WeatherToolUI } from "@/components/assistant-ui/weather-tool-ui";
import {
  AssistantRuntimeProvider,
  useAui,
  AuiProvider,
  Suggestions,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";

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
  const runtime = useChatRuntime();

  return (
    <TooltipProvider delayDuration={0}>
      <AssistantRuntimeProvider runtime={runtime}>
        {/* Registers the standalone weather card for the get_current_weather tool */}
        <WeatherToolUI />
        <div className="h-full">
          <ThreadWithSuggestions />
        </div>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}
