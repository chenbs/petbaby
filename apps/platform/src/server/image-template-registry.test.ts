import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  buildImageTemplatePrompt,
  getImageTemplate,
  getImageTemplateCandidateCount,
  imageTemplateEntries,
  imageTemplateSupportsReroll,
  listImageTemplates,
  listPublicImageTemplateEntries,
} from "@/server/image-template-registry";

describe("image template registry", () => {
  it("登记 11 个入口、120 个独立模板，并只公开已上线模板", () => {
    const catalog = listImageTemplates({ includePending: true });
    expect(catalog).toHaveLength(120);
    expect(listImageTemplates()).toHaveLength(116);
    expect(imageTemplateEntries).toHaveLength(11);
    expect(listPublicImageTemplateEntries()).toHaveLength(11);
    const humanEntry = listPublicImageTemplateEntries().find((entry) => entry.id === "human");
    expect(humanEntry?.title).toBe("人类转生计划");
    expect(humanEntry?.templates.map((template) => template.templateId)).toEqual([
      31, 32, 5, 8, 7, 36, 37, 20, 11, 10, 40, 15, 12, 14, 29, 30,
      33, 34, 38, 39, 1, 25, 4, 3, 18, 16, 19, 17, 21, 26, 28, 27,
      24, 13, 9, 6, 35, 2, 22, 23,
    ].map((number) => `human-effect-${String(number).padStart(2, "0")}`));
    expect(new Set(humanEntry?.templates.map((template) => template.templateId)).size).toBe(40);
    expect(listPublicImageTemplateEntries().find((entry) => entry.id === "art")?.templates.map((template) => template.templateId))
      .toEqual(["pet-art-photo", "ink-portrait", "decorative-art-portrait", "ink-silhouette", "ink-fullbody-flight", "ink-brush-avatar", "animal-watercolor-cat-closeup"]);
    expect(listImageTemplates().every((template) => template.masterStorageKey?.startsWith("samples/image-templates/"))).toBe(true);
    expect(listImageTemplates().every((template) => template.subjectMode === "pet-human"
      ? template.sampleStorageKey === template.masterStorageKey
      : template.sampleStorageKey?.startsWith("samples/image-template-previews/"))).toBe(true);
    expect(listImageTemplates().every((template) => template.subjectMode === "pet-human"
      || template.masterStorageKey !== template.sampleStorageKey)).toBe(true);
    expect(catalog.filter((template) => template.status === "pending-master")).toHaveLength(0);
    const livePetHuman = catalog.filter((template) => template.subjectMode === "pet-human" && template.status === "live");
    expect(catalog.filter((template) => template.status === "pending-review")).toHaveLength(0);
    expect(livePetHuman).toHaveLength(40);
    expect(new Set(catalog.map((template) => template.templateId)).size).toBe(catalog.length);
    expect(livePetHuman.every((template) => template.masterStorageKey?.startsWith("samples/image-templates/human-effect-") && template.sampleStorageKey === template.masterStorageKey)).toBe(true);
    expect(getImageTemplate("animal-gold-ink-fox", { includePending: true })).toBeUndefined();
    expect(getImageTemplate("animal-robot-poster", { includePending: true })).toBeUndefined();
    expect(getImageTemplate("leaping-cover", { includePending: true })).toBeUndefined();
    expect(getImageTemplate("exaggerated-expression", { includePending: true })).toBeUndefined();
    expect(getImageTemplate("animal-ink-scratch-portrait", { includePending: true })).toBeUndefined();
  });

  it("艺术写真公开为独立单图模板，不改变历史母版目录", () => {
    const template = getImageTemplate("pet-art-photo");
    expect(template).toMatchObject({ entryId: "art", subjectMode: "pet", status: "live", version: "v05", sampleStorageKey: "samples/scene-window-morning-v3-396d098a6999.jpg" });
    expect(template?.masterStorageKey).toBeUndefined();
    expect(listImageTemplates().some((item) => item.templateId === "pet-art-photo")).toBe(false);
    expect(listPublicImageTemplateEntries().find((entry) => entry.id === "art")?.templates[0]?.templateId).toBe("pet-art-photo");
    expect(getImageTemplateCandidateCount(template!)).toBe(2);
    expect(imageTemplateSupportsReroll(template!)).toBe(true);
  });

  it("宠物人化使用统一提示词生成两张且禁止重抽", () => {
    const template = getImageTemplate("human-effect-01", { includePending: true });
    const anotherTemplate = getImageTemplate("human-effect-02", { includePending: true });
    if (!template) throw new Error("human-effect-01 missing");
    if (!anotherTemplate) throw new Error("human-effect-02 missing");
    expect(template).toMatchObject({ subjectMode: "pet-human", status: "live", version: "v01" });
    expect(template.masterStorageKey).toBe("samples/image-templates/human-effect-01-a927e036d08d.webp");
    expect(template.sampleStorageKey).toBe(template.masterStorageKey);
    expect(getImageTemplate(template.templateId)).toBeDefined();
    const prompt = buildImageTemplatePrompt(template);
    expect(prompt).toContain("以图二作为主要视觉参考，参考权重约 50%");
    expect(prompt).toContain("提取图一动物主体的核心视觉特征，参考权重约 50%");
    expect(prompt).toContain("不得直接将动物的耳朵、鼻子、眼睛、嘴巴、爪子、毛发结构等动物器官原样移植到人物身上");
    expect(prompt).toContain("图二人物仍然是完整、自然、协调的人类角色");
    expect(buildImageTemplatePrompt(anotherTemplate)).toBe(prompt);
    expect(getImageTemplateCandidateCount(template)).toBe(2);
    expect(imageTemplateSupportsReroll(template)).toBe(false);
    expect(() => buildImageTemplatePrompt(template, "too-animal")).toThrow("PET_HUMAN_REROLL_NOT_SUPPORTED");
  });

  it("40 张 V2 效果图逐一匹配提示词 ID、尺寸和计划对象键", async () => {
    const effectRoot = path.resolve(process.cwd(), "../../tools/imagegen/out/pet-human-v2/effects");
    const promptCatalog = JSON.parse(readFileSync(path.resolve(process.cwd(), "src/server/pet-human-effect-prompts.json"), "utf8")) as Array<{ id: string; prompt: string }>;
    const effectFiles = readdirSync(effectRoot)
      .filter((filename) => /^\d+\.(?:png|webp)$/i.test(filename))
      .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
    expect(effectFiles).toEqual(Array.from({ length: 40 }, (_, index) => `${index + 1}.webp`));
    expect(promptCatalog).toHaveLength(40);
    for (let index = 1; index <= 40; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const templateId = `human-effect-${suffix}`;
      const source = readFileSync(path.join(effectRoot, `${index}.webp`));
      const metadata = await sharp(source).metadata();
      const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
      const template = getImageTemplate(templateId, { includePending: true });
      expect(promptCatalog[index - 1]).toMatchObject({ id: templateId });
      expect(promptCatalog[index - 1]?.prompt.trim().length).toBeGreaterThan(0);
      expect(metadata).toMatchObject({ format: "webp", width: 720, height: 1280 });
      expect(template).toMatchObject({
        templateId,
        status: "live",
        masterStorageKey: `samples/image-templates/${templateId}-${hash}.webp`,
        sampleStorageKey: `samples/image-templates/${templateId}-${hash}.webp`,
      });
    }
  });

  it("三参考提示词固定母版、主人、宠物职责且场景变更为 0%", () => {
    const template = getImageTemplate("fish-chase");
    if (!template) throw new Error("fish-chase missing");
    const prompt = buildImageTemplatePrompt(template, "pet-not-like");
    expect(prompt).toContain("Image 1 is the self-owned frozen master");
    expect(prompt).toContain("Image 2 is the owner's identity reference");
    expect(prompt).toContain("Image 3 is the pet's identity reference");
    expect(prompt).toContain("Scene-change budget is 0%");
    expect(prompt).toContain("Strengthen only the pet's identity match to Image 3");
  });

  it("新版母版方向、版本和定制提示词均已登记", () => {
    expect(getImageTemplate("epic-ruins")).toMatchObject({ orientation: "landscape", size: "1280x720", version: "v02" });
    expect(getImageTemplate("mini-companion")?.version).toBe("v04");
    expect(getImageTemplate("fish-chase")?.version).toBe("v04");
    const giantCity = getImageTemplate("animal-giant-city-companion");
    if (!giantCity) throw new Error("animal-giant-city-companion missing");
    expect(buildImageTemplatePrompt(giantCity)).toContain("directed downward toward the tiny people and cars");
    expect(buildImageTemplatePrompt(giantCity)).toContain("never toward the camera");
  });

  it("六张公开展示图晋升母版后保留各自稳定性约束", () => {
    const expected = [
      ["dessert-shopkeeper", "all surrounding strawberries"],
      ["original-magic-academy", "dark green magic-academy robe"],
      ["animal-giant-city-companion", "directed downward toward the tiny people"],
      ["animal-doodle-fisheye-chicken", "fixed decorative graphics"],
      ["animal-car-window-westie", "light green shirt"],
      ["pet-milk-tea-shopkeeper", "paper shop hat"],
    ] as const;
    for (const [templateId, promptFragment] of expected) {
      const template = getImageTemplate(templateId);
      if (!template) throw new Error(`${templateId} missing`);
      expect(template.version).toMatch(/^public-v0[12]-master-v01$/);
      expect(buildImageTemplatePrompt(template)).toContain(promptFragment);
    }
  });

  it("76 个 live 模板逐一匹配 WebP 冻结母版索引与公开样图索引", async () => {
    const referenceRoot = path.resolve(process.cwd(), "../../tools/imagegen/out/reference-v1");
    const repoRoot = path.resolve(process.cwd(), "../..");
    const masterIndex = JSON.parse(readFileSync(path.join(referenceRoot, "masters/index.json"), "utf8")) as {
      templates: Array<{ templateId: string; orientation: string; size: string; path: string; sha256: string }>;
    };
    const previewIndex = JSON.parse(readFileSync(path.join(referenceRoot, "public-previews/index.json"), "utf8")) as {
      templates: Array<{ templateId: string; path: string; sha256: string; sampleStorageKey: string }>;
    };
    const live = listImageTemplates().filter((item) => item.subjectMode !== "pet-human");
    expect(masterIndex.templates).toHaveLength(80);
    expect(previewIndex.templates).toHaveLength(80);
    const liveIds = new Set(live.map((item) => item.templateId));
    const indexedMasters = masterIndex.templates.filter((item) => liveIds.has(item.templateId));
    const indexedPreviews = previewIndex.templates.filter((item) => liveIds.has(item.templateId));
    expect(indexedMasters).toHaveLength(live.length);
    expect(indexedPreviews).toHaveLength(live.length);
    const masterFiles = readdirSync(path.join(referenceRoot, "masters"))
      .filter((filename) => /\.(?:png|webp)$/i.test(filename))
      .filter((filename) => indexedMasters.some((item) => path.basename(item.path) === filename))
      .sort();
    const previewFiles = readdirSync(path.join(referenceRoot, "public-previews"))
      .filter((filename) => /\.(?:png|webp)$/i.test(filename))
      .filter((filename) => indexedPreviews.some((item) => path.basename(item.path) === filename))
      .sort();
    expect(masterFiles).toEqual(indexedMasters.map((item) => path.basename(item.path)).sort());
    expect(previewFiles).toEqual(indexedPreviews
      .filter((item) => item.path.includes("/public-previews/"))
      .map((item) => path.basename(item.path))
      .sort());
    for (const template of live) {
      const master = masterIndex.templates.find((item) => item.templateId === template.templateId);
      const preview = previewIndex.templates.find((item) => item.templateId === template.templateId);
      expect(master, `${template.templateId} missing from master index`).toBeDefined();
      expect(preview, `${template.templateId} missing from preview index`).toBeDefined();
      expect(template).toMatchObject({ orientation: master?.orientation, size: master?.size });
      const masterBody = readFileSync(path.resolve(repoRoot, master!.path));
      const previewBody = readFileSync(path.resolve(repoRoot, preview!.path));
      const [masterMetadata, previewMetadata] = await Promise.all([
        sharp(masterBody).metadata(),
        sharp(previewBody).metadata(),
      ]);
      const [width, height] = master!.size.split("x").map(Number);
      expect(createHash("sha256").update(masterBody).digest("hex")).toBe(master?.sha256);
      expect(createHash("sha256").update(previewBody).digest("hex")).toBe(preview?.sha256);
      expect(masterMetadata).toMatchObject({ format: "webp", width, height });
      expect(previewMetadata).toMatchObject({ format: "webp", width, height });
      expect(template.masterStorageKey).toBe(`samples/image-templates/${template.templateId}-${master?.sha256.slice(0, 12)}.webp`);
      expect(template.sampleStorageKey).toBe(preview?.sampleStorageKey);
      expect(template.sampleStorageKey).toMatch(/\.webp$/);
    }
  });
});
