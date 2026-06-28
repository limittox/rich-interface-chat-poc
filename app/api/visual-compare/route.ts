import { generateVisualHtml } from "@/lib/nim";
import { generateVisualWithModel } from "@/lib/visual";
import { getModel } from "@/lib/model";

// A single visual generation (DeepSeek autoregressive) can run well past the
// chat route's 30s; give the race endpoint more headroom.
export const maxDuration = 60;

type CompareRequest = { prompt?: string; provider?: string };

export async function POST(req: Request) {
  const { prompt, provider }: CompareRequest = await req.json();

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json({ error: "Missing prompt", elapsedMs: 0 }, {
      status: 400,
    });
  }

  const start = performance.now();
  const result =
    provider === "deepseek"
      ? await generateVisualWithModel({ description: prompt, model: getModel() })
      : await generateVisualHtml({ description: prompt });
  const elapsedMs = Math.round(performance.now() - start);

  return Response.json({ ...result, elapsedMs });
}
