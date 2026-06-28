import { describe, expect, it } from "vitest";
import { repairVisualHtml } from "./nim";

describe("repairVisualHtml", () => {
  it("leaves clean HTML untouched", () => {
    expect(repairVisualHtml("<div>hi</div>")).toBe("<div>hi</div>");
  });

  it("trims surrounding whitespace", () => {
    expect(repairVisualHtml("   <div>hi</div> \n")).toBe("<div>hi</div>");
  });

  it("strips ```html code fences", () => {
    expect(repairVisualHtml("```html\n<div>hi</div>\n```")).toBe(
      "<div>hi</div>",
    );
  });

  it("strips bare ``` fences", () => {
    expect(repairVisualHtml("```\n<section>x</section>\n```")).toBe(
      "<section>x</section>",
    );
  });

  it("prepends a missing leading < on a bare root tag", () => {
    expect(repairVisualHtml('div style="x">hi</div>')).toBe(
      '<div style="x">hi</div>',
    );
  });

  it("drops leading prose before the first tag", () => {
    expect(repairVisualHtml("Here you go: <section>x</section>")).toBe(
      "<section>x</section>",
    );
  });

  it("returns empty string for empty input", () => {
    expect(repairVisualHtml("   ")).toBe("");
  });

  it("returns empty string for prose containing no tag", () => {
    expect(repairVisualHtml("Sorry, I can't generate that.")).toBe("");
  });

  it("strips a space-indented closing fence", () => {
    expect(repairVisualHtml("```html\n<div>hi</div>\n   ```")).toBe(
      "<div>hi</div>",
    );
  });
});
