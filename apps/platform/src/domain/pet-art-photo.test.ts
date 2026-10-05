import { describe, expect, it } from "vitest";

import { buildPetArtPhotoPrompt, PET_ART_PHOTO_SCENE_IDS, petArtPhotoScenes, resolvePetArtPhotoScene } from "@/domain/pet-art-photo";

describe("宠物艺术写真", () => {
  it("三十六套造型分别规定真实布景、动作、表情且锁定宠物身份", () => {
    expect(PET_ART_PHOTO_SCENE_IDS).toHaveLength(36);
    expect(new Set(petArtPhotoScenes.map((scene) => scene.prompt)).size).toBe(36);
    for (const scene of petArtPhotoScenes) {
      const prompt = buildPetArtPhotoPrompt(scene.id);
      expect(prompt).toContain(scene.prompt);
      expect(prompt).toContain("sole pet identity reference");
      expect(prompt).toContain("expression");
      expect(prompt).toContain("photorealistic editorial pet photograph");
      // v12 的瞬间类场景自带取景（特写、俯拍等），其余沿用通用取景
      expect(prompt).toContain("framing" in scene && scene.framing ? `Framing: ${scene.framing}` : "45-65% of frame height");
      expect(prompt).toContain("No human hands");
    }
  });

  it("扩展样片的示范宠物分布固定，素净与带一件点缀的两类都有", () => {
    const counts = petArtPhotoScenes.slice(12).reduce<Record<string, number>>((all, scene) => {
      if (!("samplePet" in scene)) throw new Error("新增场景缺少样片宠物");
      all[scene.samplePet] = (all[scene.samplePet] || 0) + 1;
      return all;
    }, {});
    // 2026-10 v13：16 套改回棚拍，示范宠物 17 种（4 套时尚大片与 4 套保留的 v12 不变）
    expect(counts).toEqual({ tuxedo: 1, cream: 1, corgi: 2, british: 1, golden: 2, poodle: 1, blacklab: 1, shorthair: 1, calico: 1, persian: 1, siamese: 2, greyhound: 3, husky: 1, afghan: 2, sphynx: 2, blackcat: 1, shiba: 1 });
    const extended = petArtPhotoScenes.slice(12);
    const plain = extended.filter((scene) => /no clothing/i.test(scene.prompt));
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.length).toBeLessThan(extended.length);
  });

  it("旧 style 入参映射到写真场景；重抽保留场景", () => {
    expect(resolvePetArtPhotoScene({ style: "paper-cut" })).toBe("garden-curious");
    expect(resolvePetArtPhotoScene({ scene: "night-playful", style: "warm-film" })).toBe("night-playful");
    expect(buildPetArtPhotoPrompt("night-playful", "pet-not-like")).toContain("dark-blue theatrical studio");
  });
});
