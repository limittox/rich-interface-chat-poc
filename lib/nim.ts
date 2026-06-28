const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NIM_MODEL = "google/diffusiongemma-26b-a4b-it";
const NIM_TIMEOUT_MS = 25_000;
const NIM_MAX_TOKENS = 3000;

// Shared by both visual providers (NIM and the OpenRouter/DeepSeek fallback) so
// they generate HTML under identical constraints.
export const VISUAL_GENERATION_SYSTEM_PROMPT = `You generate a single self-contained block of HTML and CSS to be rendered inline inside a chat message.

Strict rules:
- Output ONLY raw HTML. Start your output with a "<" character.
- No markdown, no code fences, no explanation, no commentary.
- Do not include <html>, <head>, or <body> tags; output only the content.
- Fully self-contained: inline CSS or a single <style> block. No external resources of any kind — no remote scripts, stylesheets, fonts, or images — and no network access (no fetch, XHR, WebSocket).
- Use data: URIs only if an image is essential.
- Make the layout responsive to its container width.
- If a chart is needed, draw it with inline SVG or a <canvas> plus an inline <script>. No chart libraries are available.`;

// Root tags we expect a visual to start with; used to detect a dropped leading "<".
const ROOT_TAG_START =
  /^(div|section|span|p|style|table|ul|ol|li|svg|canvas|article|main|header|footer|nav|figure|figcaption|button|h[1-6])\b/i;

export type VisualResult = { html: string } | { error: string };

/**
 * Repair common diffusion-output artifacts into clean inline HTML:
 * surrounding whitespace, wrapping ``` fences, leading prose, and a dropped
 * leading "<" on the root element. Pure and unit-testable.
 */
export function repairVisualHtml(raw: string): string {
  let html = raw.trim();
  if (html === "") return "";

  // Strip a wrapping ```html / ``` fence.
  html = html
    .replace(/^```(?:html)?[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?[ \t]*```[ \t]*$/i, "")
    .trim();

  if (html.startsWith("<")) return html;

  // Lost the leading "<" on a bare root tag (e.g. `div style="x">…`).
  if (ROOT_TAG_START.test(html)) return `<${html}`;

  // Leading prose before the markup (e.g. `Here you go: <section>…`).
  const firstAngle = html.indexOf("<");
  if (firstAngle > 0) return html.slice(firstAngle).trim();

  return "";
}

const NIM_TEXT_MAX_TOKENS = 1000;

type NimMessage = { role: "system" | "user"; content: string };

/**
 * Shared NVIDIA NIM chat-completions call. Never throws — returns { content }
 * with the raw assistant text, or { error } on any failure.
 */
async function nimChat(
  messages: NimMessage[],
  maxTokens: number,
): Promise<{ content: string } | { error: string }> {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) return { error: "NVIDIA_NIM_API_KEY is not set" };

  const model = process.env.NVIDIA_NIM_MODEL ?? DEFAULT_NIM_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NIM_TIMEOUT_MS);

  try {
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return { error: `NIM request failed: ${res.status}` };

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || raw.trim() === "") {
      return { error: "NIM returned empty output" };
    }
    return { content: raw };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timed out"
        : "network error";
    return { error: `NIM request ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the NVIDIA NIM diffusion model to generate inline visual HTML from a
 * natural-language description. Never throws — returns { error } on any failure
 * so the chat turn can continue with prose only.
 */
export async function generateVisualHtml(input: {
  description: string;
  title?: string;
}): Promise<VisualResult> {
  const userPrompt = input.title
    ? `Title: ${input.title}\n\n${input.description}`
    : input.description;

  const result = await nimChat(
    [
      { role: "system", content: VISUAL_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    NIM_MAX_TOKENS,
  );
  if ("error" in result) return result;

  const html = repairVisualHtml(result.content);
  if (html === "") return { error: "NIM returned empty output" };
  return { html };
}

/**
 * Call the NVIDIA NIM diffusion model for a plain-text answer — no visual system
 * prompt and no HTML repair. Used by the compare page's text mode. Never throws.
 */
export async function generateNimText(
  prompt: string,
): Promise<{ text: string } | { error: string }> {
  const result = await nimChat(
    [{ role: "user", content: prompt }],
    NIM_TEXT_MAX_TOKENS,
  );
  if ("error" in result) return result;
  return { text: result.content.trim() };
}
