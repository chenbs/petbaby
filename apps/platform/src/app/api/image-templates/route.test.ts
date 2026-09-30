import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/image-templates", () => {
  it("returns all human templates in display order with same-origin sample paths", async () => {
    const response = await GET();
    const body = await response.json();
    const human = body.data.entries.find((entry: { id: string }) => entry.id === "human");

    expect(human.title).toBe("人类转生计划");
    expect(human.templates).toHaveLength(40);
    expect(human.templates[0].templateId).toBe("human-effect-31");
    expect(human.templates[10].templateId).toBe("human-effect-40");
    expect(human.templates.every((template: { templateId: string; sampleUrl: string }) =>
      template.sampleUrl === `/api/image-templates/${template.templateId}/sample`)).toBe(true);
  });
});
