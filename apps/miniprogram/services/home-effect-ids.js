const CATEGORY_COVERS = {
  travel: "travel-alpine-expedition",
  career: "dessert-shopkeeper",
  character: "animal-sword-cat-alt",
  art: "ink-portrait"
};

const BOSS_TEMPLATE_IDS = [
  "animal-car-window-westie", "fish-chase", "character-outfit-grid",
  "animal-sword-cat-alt", "travel-glass-summer", "pet-milk-tea-shopkeeper",
  "fun-fisheye-closeup", "mini-companion", "animal-pink-scooter"
];

const BOSS_SCENE_IDS = ["window-morning", "seaside-breeze", "library-whisper", "autumn-leaves", "berry-pastry-chef", "ballet-backstage"];
const HUMAN_COVER_IDS = [31, 5, 8, 32, 7, 36, 37, 20].map((number) => "human-effect-" + String(number).padStart(2, "0"));

/** ids 可由服务端配置（GET /api/home-curation）覆盖；缺省用上面的内置清单。 */
function selectBossTemplates(entries, ids) {
  const byId = {};
  (entries || []).forEach((entry) => (entry.templates || []).forEach((template) => {
    byId[template.templateId] = Object.assign({ entryId: entry.id }, template);
  }));
  return (ids || BOSS_TEMPLATE_IDS).map((id) => byId[id]).filter(Boolean);
}

module.exports = { CATEGORY_COVERS, BOSS_TEMPLATE_IDS, BOSS_SCENE_IDS, HUMAN_COVER_IDS, selectBossTemplates };
