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
import { generateVisualHtml } from "@/lib/nim";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// Prefer OpenRouter when its key is present; otherwise use Anthropic direct.
function getModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    return openrouter(
      process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash",
    );
  }
  return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8");
}

const VISUAL_SYSTEM_PROMPT = `When a response would materially benefit from a custom visual — a styled card, a side-by-side comparison, a simple diagram, a timeline, or a simple chart — call the \`generate_visual\` tool.

Pass a clear, detailed \`description\` of exactly what the visual should show: its content, structure, and every data value to display. A separate model turns your description into rendered HTML, so be specific — it sees only your description, not the conversation. Optionally pass a short \`title\`.

Do NOT write HTML yourself, anywhere — not in the tool description and not in your prose. The visual is rendered for the user automatically once the tool returns, so do NOT add an HTML fallback, do NOT warn that it "might not render," and do NOT restate or summarize the visual's contents as a table, list, or extra prose. Keep any text around a visual to at most a brief sentence of lead-in or follow-up. Prefer normal prose and markdown for ordinary answers; only request a visual when custom layout adds real value.`;

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
    system: system
      ? `${VISUAL_SYSTEM_PROMPT}\n\n${system}`
      : VISUAL_SYSTEM_PROMPT,
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
      generate_visual: tool({
        description:
          "Render a custom visual (styled card, comparison, diagram, timeline, or simple chart) from a natural-language description. A separate model generates the HTML/CSS; do not pass HTML.",
        inputSchema: zodSchema(
          z.object({
            description: z
              .string()
              .describe(
                "Detailed description of the visual's content, structure, and all data values to display.",
              ),
            title: z
              .string()
              .optional()
              .describe("Optional short title for the visual."),
          }),
        ),
        execute: async ({ description, title }) =>
          generateVisualHtml({ description, title }),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
