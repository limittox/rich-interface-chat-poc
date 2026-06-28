"use client";

import { cn } from "@/lib/utils";

export type VisualProvider = "nim" | "deepseek";

const OPTIONS: { value: VisualProvider; label: string }[] = [
  { value: "nim", label: "NIM" },
  { value: "deepseek", label: "DeepSeek" },
];

/**
 * Segmented control that selects which model generates inline visuals:
 * the NVIDIA NIM diffusion model, or the OpenRouter/DeepSeek chat model itself.
 */
export function VisualProviderToggle({
  value,
  onChange,
}: {
  value: VisualProvider;
  onChange: (value: VisualProvider) => void;
}) {
  return (
    <div
      data-slot="visual-provider-toggle"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="font-medium">Visuals</span>
      <div
        role="radiogroup"
        aria-label="Visual generation model"
        className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
