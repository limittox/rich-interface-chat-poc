"use client";

import { Droplets, Sun, Thermometer, Wind } from "lucide-react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

type WeatherArgs = {
  location: string;
  unit: "celsius" | "fahrenheit";
};

type WeatherResult = {
  location: string;
  unit: "celsius" | "fahrenheit";
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
};

/**
 * Generative-UI renderer for the backend `get_current_weather` tool.
 *
 * Registered with `display: "standalone"` so a weather tool call surfaces as
 * this card on its own, instead of being collapsed into the generic tool group.
 *
 * Note: `makeAssistantToolUI` is marked deprecated in favor of toolkit-entry
 * renders, but it remains the documented path for standalone generative UI on a
 * backend tool, and is the lowest-friction option for this POC. Mounting the
 * returned component (see app/page.tsx) registers the renderer.
 */
export const WeatherToolUI = makeAssistantToolUI<WeatherArgs, WeatherResult>({
  toolName: "get_current_weather",
  display: "standalone",
  render: ({ args, result, status }) => {
    const location = result?.location ?? args?.location ?? "…";

    if (status.type === "incomplete") {
      return (
        <div
          data-slot="weather-tool-error"
          className="my-2 w-full max-w-sm rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Couldn&apos;t get the weather for {location}.
        </div>
      );
    }

    if (status.type === "running" || !result) {
      return (
        <div
          data-slot="weather-tool-loading"
          className="my-2 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span
            aria-hidden
            className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent [animation-duration:0.6s]"
          />
          <span>Checking weather in {location}…</span>
        </div>
      );
    }

    const unitSymbol = result.unit === "fahrenheit" ? "°F" : "°C";

    return (
      <div
        data-slot="weather-tool-card"
        className={cn(
          "my-2 w-full max-w-sm overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm",
          "bg-gradient-to-br from-sky-50 via-sky-100 to-blue-200",
          "dark:border-sky-900/60 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950",
        )}
      >
        <div className="flex items-start justify-between gap-3 p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
              Current weather
            </p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {result.location}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {result.description}
            </p>
          </div>
          <Sun
            aria-hidden
            className="size-9 shrink-0 text-amber-500 drop-shadow-sm"
          />
        </div>

        <div className="flex items-end justify-between px-4 pb-4">
          <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
            <Thermometer
              aria-hidden
              className="size-5 text-sky-600 dark:text-sky-400"
            />
            <span className="text-3xl font-bold tabular-nums">
              {result.temperature}
              {unitSymbol}
            </span>
          </div>
          <dl className="space-y-1 text-right text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center justify-end gap-1.5">
              <Droplets aria-hidden className="size-3.5" />
              <dt className="sr-only">Humidity</dt>
              <dd className="tabular-nums">{result.humidity}% humidity</dd>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <Wind aria-hidden className="size-3.5" />
              <dt className="sr-only">Wind</dt>
              <dd className="tabular-nums">{result.windSpeed} km/h wind</dd>
            </div>
          </dl>
        </div>
      </div>
    );
  },
});
