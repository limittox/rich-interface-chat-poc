"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";

const MAX_HEIGHT = 600;
const MIN_HEIGHT = 120;
const DEBOUNCE_MS = 250;
const ARTIFACT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:;";

function buildSrcDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}" />
  <style>
    html, body { margin: 0; padding: 0; }
    * { box-sizing: border-box; }
    body {
      min-width: 0;
      padding: 12px;
      color: #0f172a;
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    img, svg, canvas, video { max-width: 100%; }
  </style>
</head>
<body>
${html}
<script>
(function () {
  function report() {
    try {
      parent.postMessage({
        type: "aui-artifact-resize",
        height: document.documentElement.scrollHeight
      }, "*");
    } catch (e) {}
  }

  try {
    new ResizeObserver(report).observe(document.documentElement);
  } catch (e) {}

  window.addEventListener("load", report);
  report();
})();
</script>
</body>
</html>`;
}

export function VisualArtifact({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [stableHtml, setStableHtml] = useState<string | null>(null);

  useEffect(() => {
    setStableHtml(null);
    const timer = window.setTimeout(() => {
      setStableHtml(html);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== "aui-artifact-resize") return;

      const nextHeight = Number(event.data.height);
      if (!Number.isFinite(nextHeight)) return;

      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, nextHeight)));
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const srcDoc = useMemo(
    () => (stableHtml == null ? null : buildSrcDoc(stableHtml)),
    [stableHtml],
  );

  if (srcDoc == null) {
    return (
      <div
        data-slot="visual-artifact-placeholder"
        className="my-3 w-full rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-sm text-muted-foreground"
      >
        Building visual...
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      data-slot="visual-artifact"
      title="Visual artifact"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="my-3 block w-full rounded-lg border border-border/70 bg-background"
      style={
        {
          height,
          maxHeight: MAX_HEIGHT,
        } satisfies CSSProperties
      }
    />
  );
}

export function VisualArtifactHighlighter({ code }: SyntaxHighlighterProps) {
  return <VisualArtifact html={code} />;
}
