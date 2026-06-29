import { streamText } from "ai";
import { generateNimText, generateVisualHtml } from "@/lib/nim";
import { generateVisualWithModel } from "@/lib/visual";
import { getModel } from "@/lib/model";

// A single generation (DeepSeek autoregressive) can run well past the chat
// route's 30s; give the race endpoint more headroom.
export const maxDuration = 60;

const TEXT_MAX_OUTPUT_TOKENS = 1000;

type CompareRequest = {
  prompt?: string;
  provider?: string;
  // When false, generate a plain-text answer instead of a visual. Default true.
  visuals?: boolean;
};

export async function POST(req: Request) {
  const { prompt, provider, visuals = true }: CompareRequest = await req.json();

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json(
      { error: "Missing prompt", elapsedMs: 0 },
      { status: 400 },
    );
  }

  // Text mode streams as a plain-text body so the answer appears progressively.
  // DeepSeek streams token-by-token; NIM is fast and whole-shot, so it returns
  // its full text in one chunk. The client measures wall-clock + time-to-first.
  if (visuals === false) {
    if (provider === "deepseek") {
      const result = streamText({
        model: getModel(),
        prompt,
        maxOutputTokens: TEXT_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
      });
      return result.toTextStreamResponse();
    }

    const nim = await generateNimText(prompt);
    if ("error" in nim) {
      return new Response(nim.error, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(nim.text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Visual mode: complete HTML returned as JSON with a server-measured time.
  const start = performance.now();
  const result =
    provider === "deepseek"
      ? await generateVisualWithModel({ description: prompt, model: getModel() })
      : await generateVisualHtml({ description: prompt });
  const elapsedMs = Math.round(performance.now() - start);

  return Response.json({ ...result, elapsedMs });
}
