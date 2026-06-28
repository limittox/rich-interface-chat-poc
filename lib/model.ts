import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { type LanguageModel } from "ai";

// Prefer OpenRouter when its key is present; otherwise use Anthropic direct.
export function getModel(): LanguageModel {
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
