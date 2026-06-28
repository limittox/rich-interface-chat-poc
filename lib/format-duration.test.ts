import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("shows whole milliseconds under one second", () => {
    expect(formatDuration(920)).toBe("920ms");
  });

  it("rounds sub-millisecond fractions", () => {
    expect(formatDuration(919.6)).toBe("920ms");
  });

  it("shows seconds with one decimal at or above one second", () => {
    expect(formatDuration(1234)).toBe("1.2s");
  });

  it("formats larger durations in seconds", () => {
    expect(formatDuration(15000)).toBe("15.0s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("returns a dash for negative or non-finite input", () => {
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});
