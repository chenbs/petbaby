import { describe, expect, it } from "vitest";

import { mentionsDrug, sanitizeAdvisory, TRIAGE_DISCLAIMER } from "@/server/health/triage";

/*
 * V2-5-12 的对抗性验证：模型**确实会**在「不要提药」的指令下提到药名，
 * 所以这一组不测「正常情况能过」，而测「各种绕法能不能穿过过滤」。
 *
 * 每条都是一次真实可能的模型输出形态。漏掉一条的后果是给用户
 * 用药提示，而宠物用药的剂量与禁忌高度依赖体重与品种
 * （猫对乙酰氨基酚致死、布洛芬对犬猫均有肾毒性）。
 */
describe("药物过滤的对抗性输入", () => {
  const attempts = [
    // 直接给药名
    "可以先服用一点阿莫西林观察",
    "涂抹一些抗真菌药膏",
    "建议使用甲硝唑",
    // 用类别绕开具体名字
    "可以考虑非甾体抗炎药",
    "先用抗组胺药控制过敏",
    "需要抗生素治疗",
    "给一点益生菌制剂",
    // 用剂量表达绕开药名
    "每天 2 次，每次 1 片",
    "按体重计算 10 毫克",
    "口服 5 ml",
    // 用动作绕开
    "可以给它吃药先缓解一下",
    "建议自行用药观察两天",
    // 中英混写
    "可以用 5mg 的剂量",
  ];

  it.each(attempts)("拦下：%s", (text) => {
    expect(mentionsDrug(text), `「${text}」穿过了药物过滤`).toBe(true);
  });

  /*
   * 过滤命中时必须整段替换，不能只删掉那一句 ——
   * 保留其余内容会让用户看到一段被掐掉一半、逻辑不完整的建议。
   */
  it.each(attempts)("命中后输出中不残留药物提示：%s", (text) => {
    const clean = sanitizeAdvisory({
      level: "urgent_24h",
      summary: text,
      relatedAreas: ["消化"],
      watchFor: ["症状加重"],
      visitPreparation: ["带上病历"],
      disclaimer: TRIAGE_DISCLAIMER,
    });
    const joined = [clean.summary, ...clean.relatedAreas, ...clean.watchFor, ...clean.visitPreparation].join(" ");
    expect(mentionsDrug(joined)).toBe(false);
    // 紧急度保留 —— 过滤掉的是「怎么处置」，不是「有多急」。
    expect(clean.level).toBe("urgent_24h");
  });

  /*
   * 误杀检查：正常的分诊与就医准备文案不能被当成药物提示。
   * 过度拦截会让所有输出都降级成通用建议，功能等于没做。
   */
  it.each([
    "建议 24 小时内就医，由执业兽医面诊确认",
    "带上疫苗与驱虫记录",
    "记下症状开始的时间与变化过程",
    "如有呕吐物异常，拍照或取样带去",
    "症状持续超过 24 小时请立即就医",
    "精神、食欲或饮水量明显下降",
    "路上保持通风与安静，不要喂食喂水",
    "说明年糕的品种、年龄与体重",
  ])("不误杀：%s", (text) => {
    expect(mentionsDrug(text), `「${text}」被误判为药物提示`).toBe(false);
  });
});
