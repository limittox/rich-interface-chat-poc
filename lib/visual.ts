import { generateText, type LanguageModel } from "ai";
import {
  repairVisualHtml,
  VISUAL_GENERATION_SYSTEM_PROMPT,
  type VisualResult,
} from "./nim";

const MAX_OUTPUT_TOKENS = 3000;

/**
 * Generate inline visual HTML using a provided language model (the same
 * OpenRouter/DeepSeek model that writes the chat prose) instead of NIM. Used
 * when the visual-provider toggle is set to "deepseek". Never throws — returns
 * { error } on any failure so the chat turn can continue with prose only.
 */
export async function generateVisualWithModel(input: {
  description: string;
  title?: string;
  model: LanguageModel;
}): Promise<VisualResult> {
  const userPrompt = input.title
    ? `Title: ${input.title}\n\n${input.description}`
    : input.description;

  try {
    const { text } = await generateText({
      model: input.model,
      system: VISUAL_GENERATION_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
    });

    if (typeof text !== "string" || text.trim() === "") {
      return { error: "Model returned empty output" };
    }

    const html = repairVisualHtml(text);
    if (html === "") return { error: "Model returned no HTML" };
    return { html };
  } catch {
    return { error: "Visual generation failed" };
  }
}
