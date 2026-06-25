import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  type JSONSchema7,
  type LanguageModel,
  streamText,
  convertToModelMessages,
  type UIMessage,
  tool,
  stepCountIs,
  zodSchema,
} from "ai";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// Prefer OpenRouter when its key is present; otherwise use Anthropic direct.
// Both route to real Claude through the Vercel AI SDK.
function getModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    return openrouter(
      process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-4-8",
    );
  }
  return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8");
}

export async function POST(req: Request) {
  const {
    messages,
    system,
    tools,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
  } = await req.json();

  const result = streamText({
    model: getModel(),
    messages: await convertToModelMessages(messages),
    ...(system ? { system } : {}),
    stopWhen: stepCountIs(10),
    tools: {
      ...frontendTools(tools ?? {}),
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
