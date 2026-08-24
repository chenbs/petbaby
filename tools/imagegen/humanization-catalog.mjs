import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const HUMANIZATION_ROOT = path.join(import.meta.dirname, "out", "humanization-v1");
export const HUMANIZATION_PROMPT_VERSION = "pet-human-identity-v1";
export const HUMANIZATION_SUBJECT_MODE = "pet-human";

const output = (...parts) => path.join(HUMANIZATION_ROOT, ...parts);

export const humanizationTemplates = [
  { templateId: "human-breezy-fence", title: "晴空微风", entryId: "human", master: output("masters", "candidates", "human-breezy-fence_9x16_v01.png"), identityId: "tuxedo-cat", candidate: output("probes", "two-stage", "human-breezy-fence_tuxedo-cat_9x16_v01.png") },
  { templateId: "human-color-splash", title: "跃彩笔触", entryId: "human", master: output("masters", "candidates", "human-color-splash_9x16_v01.png"), identityId: "parrot", candidate: output("probes", "two-stage", "human-color-splash_parrot_9x16_v01.png") },
  { templateId: "human-jade-garden", title: "翡翠花园", entryId: "human", master: output("masters", "candidates", "human-jade-garden_9x16_v01.png"), identityId: "rabbit", candidate: output("probes", "two-stage", "human-jade-garden_rabbit_9x16_v01.png") },
  { templateId: "human-moonlit-fantasy", title: "月夜蝶境", entryId: "human", version: "v02", master: output("masters", "candidates", "human-moonlit-fantasy_9x16_v02.png"), identityId: "ragdoll-cat", candidate: output("probes", "two-stage", "human-moonlit-fantasy_ragdoll-cat_9x16_v01.png") },
  { templateId: "human-snow-scarf", title: "风雪回眸", entryId: "human", master: output("masters", "candidates", "human-snow-scarf_9x16_v01.png"), identityId: "husky-dog", candidate: output("probes", "two-stage", "human-snow-scarf_husky-dog_9x16_v01.png") },
  { templateId: "human-hanfu-summer", title: "盛夏花朝", entryId: "human", master: output("masters", "candidates", "human-hanfu-summer_9x16_v01.png"), identityId: "corgi-dog", candidate: output("probes", "two-stage", "human-hanfu-summer_corgi-dog_9x16_v01.png") },
  { templateId: "human-urban-collar", title: "暗影白领", entryId: "human", master: output("masters", "candidates", "human-urban-collar_9x16_v01.png"), identityId: "black-cat", candidate: output("probes", "two-stage", "human-urban-collar_black-cat_9x16_v01.png") },
  { templateId: "human-evening-blazer", title: "暖夜西装", entryId: "human", master: output("masters", "candidates", "human-evening-blazer_9x16_v01.png"), identityId: "golden-dog", candidate: output("probes", "two-stage", "human-evening-blazer_golden-dog_9x16_v01.png") },
  { templateId: "human-flower-daylight", title: "樱光白昼", entryId: "human", version: "v02", master: output("masters", "candidates", "human-flower-daylight_9x16_v02.png"), identityId: "hamster", candidate: output("probes", "two-stage", "human-flower-daylight_hamster_9x16_v01.png") },
  { templateId: "human-black-tee", title: "黑衣证件感", entryId: "human", master: output("masters", "candidates", "human-black-tee_9x16_v01.png"), identityId: "black-lab-dog", candidate: output("probes", "two-stage", "human-black-tee_black-lab-dog_9x16_v01.png") },
  { templateId: "human-sunlit-short-hair", title: "日光短发", entryId: "human", master: output("masters", "candidates", "human-sunlit-short-hair_9x16_v01.png"), identityId: "poodle-dog", candidate: output("probes", "two-stage", "human-sunlit-short-hair_poodle-dog_9x16_v01.png") },
  { templateId: "human-tailored-suit", title: "黑色裁缝", entryId: "human", master: output("masters", "candidates", "human-tailored-suit_9x16_v01.png"), identityId: "blue-british-cat", candidate: output("probes", "two-stage", "human-tailored-suit_blue-british-cat_9x16_v01.png") },
].map((item) => ({ subjectMode: HUMANIZATION_SUBJECT_MODE, status: "pending-review", orientation: "portrait", size: "720x1280", version: "v01", ...item }));

export const humanizationIdentities = [
  "black-cat",
  "blue-british-cat",
  "tuxedo-cat",
  "ragdoll-cat",
  "golden-dog",
  "husky-dog",
  "corgi-dog",
  "black-lab-dog",
  "poodle-dog",
  "rabbit",
  "parrot",
  "hamster",
].map((identityId) => ({
  identityId,
  promptVersion: HUMANIZATION_PROMPT_VERSION,
  card: output("identity-cards", `${identityId}_v01.png`),
}));

export const humanizationComparisons = [
  {
    id: "breezy-fence-tuxedo-cat",
    direct: output("probes", "comparison", "human-breezy-fence_tuxedo-cat_direct_9x16_v01.png"),
    twoStage: output("probes", "two-stage", "human-breezy-fence_tuxedo-cat_9x16_v01.png"),
    conclusion: "two-stage",
  },
];

export const rejectedHumanizationAssets = [
  {
    file: output("masters", "candidates", "human-moonlit-fantasy_9x16_v01.png"),
    reason: "safety-gate-revealing-wardrobe",
    replacement: output("masters", "candidates", "human-moonlit-fantasy_9x16_v02.png"),
  },
  {
    file: output("masters", "candidates", "human-flower-daylight_9x16_v01.png"),
    reason: "visible-watermark",
    replacement: output("masters", "candidates", "human-flower-daylight_9x16_v02.png"),
  },
];
