"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Toggles between light and dark themes. Until mounted, the icon is hidden to
 * avoid a hydration mismatch (the resolved theme is unknown on the server).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Gate the resolved-theme read behind `mounted` so the first client render
  // matches the server (where the theme is unknown) — avoids a hydration
  // mismatch on the title/icon. After mount, this re-renders with the real value.
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      title={
        !mounted
          ? "Toggle dark mode"
          : isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <span className="size-4" aria-hidden />
      )}
    </button>
  );
}
