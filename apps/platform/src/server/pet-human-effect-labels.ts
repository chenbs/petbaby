/*
 * 如果我是人 40 款造型的展示名与筛选标签（2026-09-30 草稿，待运营审阅）。
 *
 * 原标题是「宠物人化 01」到「宠物人化 40」，用户只能靠编号挑；这里按效果图内容起名，
 * 并给首页 / 造型页的筛选 chip 打标签。**只影响展示**：运行时提示词、母版与模板 ID 不变。
 * 改名只改这张表，不要去改 registry 里的 templateId（历史任务与作品都按 ID 关联）。
 */
export const PET_HUMAN_TAGS = ["少年感", "少女感", "古风", "校园", "酷帅", "温柔", "奇幻"] as const;
export type PetHumanTag = (typeof PET_HUMAN_TAGS)[number];

export const petHumanEffectLabels: Record<number, { title: string; tags: PetHumanTag[] }> = {
  1: { title: "金发晚礼服", tags: ["少女感", "温柔"] },
  2: { title: "湖畔蓝裙", tags: ["少女感", "温柔"] },
  3: { title: "赛道车手", tags: ["少年感", "酷帅"] },
  4: { title: "红发军装", tags: ["少年感", "酷帅"] },
  5: { title: "白衬衫少年", tags: ["少年感", "温柔", "校园"] },
  6: { title: "花丛里的你", tags: ["少年感", "温柔"] },
  7: { title: "西装学长", tags: ["少年感", "校园"] },
  8: { title: "粉发甜心", tags: ["少女感", "温柔"] },
  9: { title: "烛光夜读", tags: ["少年感", "酷帅"] },
  10: { title: "森林精灵", tags: ["奇幻", "少女感"] },
  11: { title: "暗夜猫系", tags: ["奇幻", "酷帅"] },
  12: { title: "月光银发", tags: ["奇幻", "少年感"] },
  13: { title: "白发小少爷", tags: ["少年感", "酷帅"] },
  14: { title: "樱花仙子", tags: ["奇幻", "少女感"] },
  15: { title: "汉服少女", tags: ["古风", "少女感"] },
  16: { title: "红衣古韵", tags: ["古风", "少女感"] },
  17: { title: "卷发晴天", tags: ["温柔", "少女感"] },
  18: { title: "红发狐妖", tags: ["古风", "奇幻", "少年感"] },
  19: { title: "红围巾冬日", tags: ["少年感", "温柔"] },
  20: { title: "银发贵公子", tags: ["少年感", "酷帅"] },
  21: { title: "双马尾甜妹", tags: ["少女感"] },
  22: { title: "星光粉发", tags: ["少女感", "奇幻"] },
  23: { title: "黑发剑客", tags: ["古风", "少年感", "酷帅"] },
  24: { title: "林间白发", tags: ["奇幻", "温柔"] },
  25: { title: "领带学霸", tags: ["校园", "少年感"] },
  26: { title: "金发猫耳", tags: ["少女感", "奇幻"] },
  27: { title: "银灰长发", tags: ["奇幻", "温柔"] },
  28: { title: "红发酷女孩", tags: ["少女感", "酷帅"] },
  29: { title: "黑西装", tags: ["少年感", "酷帅"] },
  30: { title: "白衬衫校园", tags: ["校园", "少年感", "温柔"] },
  31: { title: "蓝天白衣", tags: ["少年感", "温柔"] },
  32: { title: "暗夜王子", tags: ["少年感", "酷帅", "奇幻"] },
  33: { title: "捧光少年", tags: ["奇幻", "少年感"] },
  34: { title: "夏日晴空", tags: ["少年感", "温柔"] },
  35: { title: "白发花冠", tags: ["奇幻", "温柔"] },
  36: { title: "短发少女", tags: ["少女感", "温柔"] },
  37: { title: "白发精灵", tags: ["奇幻", "少年感"] },
  38: { title: "粉发黑衣", tags: ["少女感", "酷帅"] },
  39: { title: "粉色长发", tags: ["少女感", "温柔"] },
  40: { title: "黑发魔法师", tags: ["奇幻", "酷帅"] },
};

export function petHumanLabelFor(templateId: string) {
  const match = /^human-effect-(\d{2})$/.exec(templateId);
  return match ? petHumanEffectLabels[Number(match[1])] : undefined;
}
