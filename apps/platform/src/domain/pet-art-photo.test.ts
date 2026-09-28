import { describe, expect, it } from "vitest";

import { buildPetArtPhotoPrompt, PET_ART_PHOTO_SCENE_IDS, petArtPhotoScenes, resolvePetArtPhotoScene } from "@/domain/pet-art-photo";

describe("宠物艺术写真", () => {
  it("二十四套造型分别规定真实布景、动作、表情且锁定宠物身份", () => {
    expect(PET_ART_PHOTO_SCENE_IDS).toHaveLength(24);
    expect(new Set(petArtPhotoScenes.map((scene) => scene.prompt)).size).toBe(24);
    for (const scene of petArtPhotoScenes) {
      const prompt = buildPetArtPhotoPrompt(scene.id);
      expect(prompt).toContain(scene.prompt);
      expect(prompt).toContain("sole pet identity reference");
      expect(prompt).toContain("expression");
      expect(prompt).toContain("photorealistic editorial pet photograph");
      expect(prompt).toContain("45-65% of frame height");
      expect(prompt).toContain("No human hands");
    }
  });

  it("新增样片只分配金毛、泰迪和英短，每种各四套", () => {
    const counts = petArtPhotoScenes.slice(12).reduce<Record<string, number>>((all, scene) => {
      if (!("samplePet" in scene)) throw new Error("新增场景缺少样片宠物");
      all[scene.samplePet] = (all[scene.samplePet] || 0) + 1;
      return all;
    }, {});
    expect(counts).toEqual({ golden: 4, poodle: 4, british: 4 });
  });

  it("旧 style 入参映射到写真场景；重抽保留场景", () => {
    expect(resolvePetArtPhotoScene({ style: "paper-cut" })).toBe("garden-curious");
    expect(resolvePetArtPhotoScene({ scene: "night-playful", style: "warm-film" })).toBe("night-playful");
    expect(buildPetArtPhotoPrompt("night-playful", "pet-not-like")).toContain("dark-blue theatrical studio");
  });
});
