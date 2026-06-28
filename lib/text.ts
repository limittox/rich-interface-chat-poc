import { generateText, type LanguageModel } from "ai";

const TEXT_MAX_OUTPUT_TOKENS = 1000;

/**
 * Generate a plain-text answer with a provided language model (the OpenRouter /
 * DeepSeek chat model). Used by the compare page's text mode. Never throws —
 * returns { error } on any failure.
 */
export async function generateModelText(input: {
  prompt: string;
  model: LanguageModel;
}): Promise<{ text: string } | { error: string }> {
  try {
    const { text } = await generateText({
      model: input.model,
      prompt: input.prompt,
      maxOutputTokens: TEXT_MAX_OUTPUT_TOKENS,
      temperature: 0.3,
    });

    if (typeof text !== "string" || text.trim() === "") {
      return { error: "Model returned empty output" };
    }
    return { text: text.trim() };
  } catch {
    return { error: "Text generation failed" };
  }
}
