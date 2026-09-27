import { describe, expect, it } from "vitest";

import { buildPetArtPhotoPrompt, PET_ART_PHOTO_SCENE_IDS, petArtPhotoScenes, resolvePetArtPhotoScene } from "@/domain/pet-art-photo";

describe("宠物艺术写真", () => {
  it("十二套造型分别规定真实布景、动作、表情且锁定宠物身份", () => {
    expect(PET_ART_PHOTO_SCENE_IDS).toHaveLength(12);
    expect(new Set(petArtPhotoScenes.map((scene) => scene.prompt)).size).toBe(12);
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

  it("旧 style 入参映射到写真场景；重抽保留场景", () => {
    expect(resolvePetArtPhotoScene({ style: "paper-cut" })).toBe("garden-curious");
    expect(resolvePetArtPhotoScene({ scene: "night-playful", style: "warm-film" })).toBe("night-playful");
    expect(buildPetArtPhotoPrompt("night-playful", "pet-not-like")).toContain("dark-blue theatrical studio");
  });
});
