"use client";

import { cn } from "@/lib/utils";

const OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: "Visual" },
  { value: false, label: "Text" },
];

/**
 * Segmented control for the compare page: race a generated visual (HTML) or a
 * plain-text answer. `value` is whether visuals are enabled.
 */
export function OutputModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-slot="output-mode-toggle"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="font-medium">Output</span>
      <div
        role="radiogroup"
        aria-label="Compare output mode"
        className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
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
