import { describe, expect, it } from "vitest";

import { getLegalDocument, LEGAL_DOCUMENTS, LEGAL_OPERATOR } from "@/domain/legal";

const all = Object.values(LEGAL_DOCUMENTS);
const text = (id: keyof typeof LEGAL_DOCUMENTS) => LEGAL_DOCUMENTS[id].sections.flatMap((section) => section.paragraphs).join("\n");

describe("legal documents", () => {
  it("names the operator and contact in every document", () => {
    for (const document of all) {
      const body = document.sections.flatMap((section) => section.paragraphs).join("\n");
      expect(body).toContain(LEGAL_OPERATOR.phone);
      expect(body).toContain(LEGAL_OPERATOR.address);
    }
    expect(text("privacy")).toContain(LEGAL_OPERATOR.name);
  });

  it("avoids words the health red line forbids in user-visible copy", () => {
    for (const document of all) expect(JSON.stringify(document)).not.toMatch(/诊断|确诊|治愈|问诊/);
  });

  it("does not promise anything the product no longer does", () => {
    const body = all.map((document) => JSON.stringify(document)).join("\n");
    // 作品长期保存（不再按保留期清理）、会员已下线、订阅消息首发不做、没有不满意退 50%
    expect(body).not.toMatch(/保留期清理|会员|订阅消息|50%|unionid/);
  });

  it("only resolves known ids", () => {
    expect(getLegalDocument("privacy")?.title).toBe("隐私政策");
    expect(getLegalDocument("constructor")).toBeUndefined();
    expect(getLegalDocument("../x")).toBeUndefined();
  });
});
