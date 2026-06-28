import { generateNimText, generateVisualHtml } from "@/lib/nim";
import { generateVisualWithModel } from "@/lib/visual";
import { generateModelText } from "@/lib/text";
import { getModel } from "@/lib/model";

// A single generation (DeepSeek autoregressive) can run well past the chat
// route's 30s; give the race endpoint more headroom.
export const maxDuration = 60;

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

  const start = performance.now();
  const result =
    visuals === false
      ? provider === "deepseek"
        ? await generateModelText({ prompt, model: getModel() })
        : await generateNimText(prompt)
      : provider === "deepseek"
        ? await generateVisualWithModel({ description: prompt, model: getModel() })
        : await generateVisualHtml({ description: prompt });
  const elapsedMs = Math.round(performance.now() - start);

  return Response.json({ ...result, elapsedMs });
}
