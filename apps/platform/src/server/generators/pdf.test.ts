import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { svgToPdf } from "@/server/generators/pdf";

describe("svgToPdf", () => {
  it("supports Chinese brand text in the source SVG", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><text x="8" y="40">麻麻抱我</text></svg>';
    const pdf = await svgToPdf(new TextEncoder().encode(svg));

    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getCreator()).toBe("麻麻抱我");
  });
});
